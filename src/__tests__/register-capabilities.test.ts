// serverEntry `register(ctx)` — capability registration tests.
//
// The lazy/guarded host-access cutover: the host resolves
// `object-type-registrar` / `crm-sync-bootstrap` / `crm-pointer-writer` /
// `crm-list-reader` capability providers instead of value-importing this
// package. register(ctx)
// must be REGISTRATION-ONLY (no I/O — required-extension-activation arms a
// prod-boot throw on activation failure), take every host value through the
// `@cinatra-ai/host:objects-integration` service (host-peer-value-import ban:
// no SDK value import in this graph), and degrade to no-ops while the host
// surface is unwired.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import { register } from "../register";
import { CRM_OBJECT_TYPE_DEFINITIONS } from "../integration/object-type-definitions";
import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";

type Registered = Map<string, { packageName: string; impl: unknown }[]>;

function makeCtx(hostServiceImpl: unknown | null) {
  const registered: Registered = new Map();
  const ctx = {
    capabilities: {
      registerProvider: (capability: string, provider: { packageName: string; impl: unknown }) => {
        const list = registered.get(capability) ?? [];
        list.push(provider);
        registered.set(capability, list);
      },
      resolveProviders: (capability: string) =>
        capability === "@cinatra-ai/host:objects-integration" && hostServiceImpl
          ? [{ packageName: "@cinatra-ai/host", impl: hostServiceImpl }]
          : [],
    },
  } as unknown as ExtensionHostContext;
  return { ctx, registered };
}

function makeObjectsProvider() {
  return {
    registerObjectType: vi.fn(),
    registerSyncAdapter: vi.fn(),
    addGraphitiEpisodeForObject: vi.fn(async () => ({ episodeUuid: "ep-1" })),
    saveObject: vi.fn(async (_req: unknown) => ({
      objectId: "obj-1",
      type: "@cinatra-ai/entity-accounts:account",
      isNew: true,
      wasMerged: false,
      confidence: 1,
      changeSetId: "cs-1",
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("register(ctx)", () => {
  it("registers the four capabilities and is REGISTRATION-ONLY (no registry mutation, no I/O at activation — probe-safe)", () => {
    const provider = makeObjectsProvider();
    const { ctx, registered } = makeCtx({
      getObjectsProvider: () => provider,
      lookupCrmProvider: () => null,
    });
    register(ctx);

    expect([...registered.keys()].sort()).toEqual([
      "crm-list-reader",
      "crm-pointer-writer",
      "crm-sync-bootstrap",
      "object-type-registrar",
    ]);
    // Probe-safety contract: the hot-update probe runs register(ctx) with
    // inert registration sinks but REAL capability reads — register(ctx) must
    // therefore NOT touch the live objects surface at activation.
    expect(provider.registerObjectType).not.toHaveBeenCalled();
    expect(provider.registerSyncAdapter).not.toHaveBeenCalled();
    expect(provider.saveObject).not.toHaveBeenCalled();
    expect(provider.addGraphitiEpisodeForObject).not.toHaveBeenCalled();
  });

  it("the object-type-registrar impl registers all definitions when invoked by the host loop", () => {
    const provider = makeObjectsProvider();
    const { ctx, registered } = makeCtx({
      getObjectsProvider: () => provider,
      lookupCrmProvider: () => null,
    });
    register(ctx);
    const registrar = registered.get("object-type-registrar")?.[0]?.impl as {
      registerObjectTypes(): void;
    };
    registrar.registerObjectTypes();
    expect(provider.registerObjectType).toHaveBeenCalledTimes(CRM_OBJECT_TYPE_DEFINITIONS.length);
  });

  it("the crm-sync-bootstrap impl registers the twenty-to-graphiti adapter when invoked by the repair cycle", () => {
    const provider = makeObjectsProvider();
    const { ctx, registered } = makeCtx({
      getObjectsProvider: () => provider,
      lookupCrmProvider: () => null,
    });
    register(ctx);
    const bootstrap = registered.get("crm-sync-bootstrap")?.[0]?.impl as {
      ensureSyncRegistrations(): void;
    };
    bootstrap.ensureSyncRegistrations();
    expect(provider.registerSyncAdapter).toHaveBeenCalledTimes(1);
    const adapter = provider.registerSyncAdapter.mock.calls[0]?.[0] as { id?: string };
    expect(adapter?.id).toBe("twenty-to-graphiti");
  });

  it("degrades to no-op registration while the host objects surface is unwired (never throws at activation)", () => {
    const { ctx, registered } = makeCtx(null);
    expect(() => register(ctx)).not.toThrow();
    // Capabilities still registered (they degrade per call); eager calls no-op.
    expect([...registered.keys()].sort()).toEqual([
      "crm-list-reader",
      "crm-pointer-writer",
      "crm-sync-bootstrap",
      "object-type-registrar",
    ]);
  });

  it("the crm-list-reader impl delegates searchLists to the host-resolved provider at call time", async () => {
    const provider = makeObjectsProvider();
    const searchLists = vi.fn(async () => [
      { id: "v1", name: "Contacts A", objectType: "contact" },
    ]);
    const { ctx, registered } = makeCtx({
      getObjectsProvider: () => provider,
      lookupCrmProvider: (id: string) => (id === "twenty" ? { searchLists } : null),
    });
    register(ctx);
    const reader = registered.get("crm-list-reader")?.[0]?.impl as {
      searchLists(input: { query: string; objectType?: "contact" | "account" }): Promise<unknown[]>;
    };
    const lists = await reader.searchLists({ query: "", objectType: "contact" });
    expect(searchLists).toHaveBeenCalledWith({ query: "", objectType: "contact" });
    expect(lists).toEqual([{ id: "v1", name: "Contacts A", objectType: "contact" }]);
  });

  it("the crm-list-reader impl FAILS LOUD when no CRM provider is registered (the host consumer owns degraded-to-empty)", async () => {
    const { ctx, registered } = makeCtx({
      getObjectsProvider: () => null,
      lookupCrmProvider: () => null,
    });
    register(ctx);
    const reader = registered.get("crm-list-reader")?.[0]?.impl as {
      searchLists(input: { query: string }): Promise<unknown[]>;
    };
    await expect(reader.searchLists({ query: "" })).rejects.toThrow(
      /no CRM provider registered/,
    );
  });

  it("the crm-list-reader surface exposes ONLY the read member (least privilege — no mutation members)", () => {
    const provider = makeObjectsProvider();
    const { ctx, registered } = makeCtx({
      getObjectsProvider: () => provider,
      lookupCrmProvider: () => null,
    });
    register(ctx);
    const impl = registered.get("crm-list-reader")?.[0]?.impl as Record<string, unknown>;
    expect(Object.keys(impl).sort()).toEqual(["searchLists"]);
  });

  it("the pointer-writer impl registers types before saving and mints the synthetic member actor", async () => {
    const provider = makeObjectsProvider();
    const calls: string[] = [];
    provider.registerObjectType.mockImplementation(() => calls.push("registerType"));
    provider.saveObject.mockImplementation(async (req: unknown) => {
      calls.push("save");
      const r = req as { typeHint: string; actor: Record<string, unknown>; rawData: unknown };
      expect(r.typeHint).toBe("@cinatra-ai/entity-contacts:contact");
      expect(r.rawData).toEqual({ type: "contact", external_id: "tw-9", name: "Ada" });
      expect(r.actor.orgId).toBe("org-1");
      expect(r.actor.organizationId).toBe("org-1");
      expect(r.actor.userId).toBe("user-1");
      expect(r.actor.roles).toEqual(["member"]);
      return {
        objectId: "obj-2",
        type: r.typeHint,
        isNew: true,
        wasMerged: false,
        confidence: 1,
        changeSetId: "cs-2",
      };
    });
    const { ctx, registered } = makeCtx({
      getObjectsProvider: () => provider,
      lookupCrmProvider: () => null,
    });
    register(ctx);
    const writer = registered.get("crm-pointer-writer")?.[0]?.impl as {
      writePointer(p: unknown): Promise<void>;
    };
    await writer.writePointer({
      type: "contact",
      externalId: "tw-9",
      name: "Ada",
      orgId: "org-1",
      userId: "user-1",
    });
    expect(calls.filter((c) => c === "registerType").length).toBe(
      CRM_OBJECT_TYPE_DEFINITIONS.length, // register-types-before-write, owned by the impl
    );
    expect(calls[calls.length - 1]).toBe("save");
  });

  it("the sync-bootstrap adapter hydrates through the host CRM lookup at call time", async () => {
    const provider = makeObjectsProvider();
    const getContact = vi.fn(async () => ({ name: "Ada", email: "ada@example.com" }));
    const { ctx, registered } = makeCtx({
      getObjectsProvider: () => provider,
      lookupCrmProvider: (id: string) => (id === "twenty" ? { getContact, getAccount: vi.fn() } : null),
    });
    register(ctx);
    const bootstrap = registered.get("crm-sync-bootstrap")?.[0]?.impl as {
      ensureSyncRegistrations(): void;
    };
    bootstrap.ensureSyncRegistrations();
    const adapter = provider.registerSyncAdapter.mock.calls[0]?.[0] as {
      export(o: unknown): Promise<{ ok: boolean; externalId?: string }>;
    };
    const result = await adapter.export({
      id: "obj-3",
      type: "@cinatra-ai/entity-contacts:contact",
      data: { external_id: "tw-3" },
      orgId: "org-1",
      createdAt: "2026-06-11T00:00:00Z",
      runId: null,
      agentId: null,
    });
    expect(getContact).toHaveBeenCalledWith({ id: "tw-3" });
    expect(provider.addGraphitiEpisodeForObject).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.externalId).toBe("ep-1");
  });
});
