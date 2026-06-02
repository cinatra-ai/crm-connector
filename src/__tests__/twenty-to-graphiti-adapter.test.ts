// D8 — TwentyToGraphitiAdapter unit tests.
//
// Covers the adapter's behavior end-to-end with the crm facade + the host objects
// provider mocked: hydrate-from-Twenty, compose the episode
// body (cinatra recovery markers + name [oid:] tag), the terminal/error paths
// (missing external_id, deleted-in-Twenty, provider throw), and the deterministic
// externalId returned by the provider.
//
// The graphiti write mechanics — group_id derivation, the EPISODE-UUID-EMPTY
// no-uuid rule, source:"json" — moved HOST-SIDE into the objects provider
// (src/lib/register-objects-provider.ts); they are covered by its own unit test.
// Here we assert only what the ADAPTER controls: the input it passes to
// requireObjectsProvider().addGraphitiEpisodeForObject(...).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setObjectsProvider, _resetObjectsProviderForTests } from "@cinatra-ai/sdk-extensions";

// The adapter (and its facade dep) imports `server-only` at module top.
vi.mock("server-only", () => ({}));

const { addEpisodeForObjectMock, contactGetMock, accountGetMock } = vi.hoisted(() => ({
  addEpisodeForObjectMock: vi.fn(),
  contactGetMock: vi.fn(),
  accountGetMock: vi.fn(),
}));

vi.mock("../facade", () => ({
  crmFacade: {
    contact: { get: contactGetMock },
    account: { get: accountGetMock },
  },
}));

// Imported AFTER vi.mock so the adapter binds to the mocked facade.
import { twentyToGraphitiAdapter } from "../sync-adapters/twenty-to-graphiti-adapter";

function mkContactPointer(overrides: Record<string, unknown> = {}) {
  return {
    id: "obj-1",
    type: "@cinatra-ai/entity-contacts:contact",
    data: { type: "contact", external_id: "twenty-c-123", name: "Alice" },
    parentId: null,
    orgId: "org-1",
    createdAt: "2026-01-01T00:00:00Z",
    createdBy: null,
    agentId: null,
    runId: null,
    source: "agent" as const,
    classificationConfidence: null,
    exportedTo: {},
    deletedAt: null,
    ...overrides,
  };
}

function mkAccountPointer(overrides: Record<string, unknown> = {}) {
  return {
    ...mkContactPointer(),
    id: "obj-acc-1",
    type: "@cinatra-ai/entity-accounts:account",
    data: { type: "account", external_id: "twenty-a-77", name: "Acme" },
    ...overrides,
  };
}

describe("TwentyToGraphitiAdapter", () => {
  beforeEach(() => {
    addEpisodeForObjectMock.mockReset();
    // The host provider derives a deterministic group-id + episode UUID; the stub
    // mirrors that derivation so the adapter's externalId pass-through is testable.
    addEpisodeForObjectMock.mockImplementation(
      (input: { objectId: string; orgId: string | null }) => {
        const group = input.orgId ? `cinatra-org-${input.orgId}` : "cinatra-default";
        return Promise.resolve({ episodeUuid: `uuid:${input.objectId}:${group}` });
      },
    );
    contactGetMock.mockReset();
    accountGetMock.mockReset();
    _resetObjectsProviderForTests();
    setObjectsProvider({
      addGraphitiEpisodeForObject: addEpisodeForObjectMock,
      registerObjectType: vi.fn(),
      registerSyncAdapter: vi.fn(),
      saveObject: vi.fn(),
    });
  });

  it("declares the expected adapter metadata", () => {
    expect(twentyToGraphitiAdapter.id).toBe("twenty-to-graphiti");
    expect(twentyToGraphitiAdapter.targetSystem).toBe("graphiti");
    expect(twentyToGraphitiAdapter.supportedTypes).toEqual([
      "@cinatra-ai/entity-accounts:account",
      "@cinatra-ai/entity-contacts:contact",
    ]);
  });

  it("hydrates a contact via crmFacade + projects via the objects provider", async () => {
    contactGetMock.mockResolvedValue({
      id: "twenty-c-123",
      name: "Alice",
      email: "alice@example.com",
      title: "PM",
      accountId: "acc-7",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await twentyToGraphitiAdapter.export(mkContactPointer() as any, {});

    expect(contactGetMock).toHaveBeenCalledWith({ id: "twenty-c-123" });
    expect(addEpisodeForObjectMock).toHaveBeenCalledOnce();
    const call = addEpisodeForObjectMock.mock.calls[0]![0] as Record<string, unknown>;
    // The adapter passes the row identity + the composed body + provenance; the
    // HOST provider derives group_id + the no-uuid episode (covered by its test).
    expect(call.objectId).toBe("obj-1");
    expect(call.orgId).toBe("org-1");
    expect(call.sourceDescription).toBe("cinatra @cinatra-ai/entity-contacts:contact");
    expect(call.referenceTime).toBe("2026-01-01T00:00:00Z");
    expect(JSON.parse(call.episodeBody as string)).toMatchObject({
      kind: "crm_contact",
      name: "Alice",
      email: "alice@example.com",
      title: "PM",
      accountId: "acc-7",
    });
    expect(result.ok).toBe(true);
    // externalId is the provider's returned episode UUID (passed through verbatim).
    expect(result.externalId).toBe("uuid:obj-1:cinatra-org-org-1");
  });

  it("hydrates an account via crmFacade.account.get for account-typed pointers", async () => {
    accountGetMock.mockResolvedValue({
      id: "twenty-a-77",
      name: "Acme",
      domainName: "acme.com",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await twentyToGraphitiAdapter.export(mkAccountPointer() as any, {});

    expect(accountGetMock).toHaveBeenCalledWith({ id: "twenty-a-77" });
    expect(contactGetMock).not.toHaveBeenCalled();
    const call = addEpisodeForObjectMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(JSON.parse(call.episodeBody as string)).toMatchObject({
      kind: "crm_account",
      name: "Acme",
      domain: "acme.com",
    });
    expect(result.ok).toBe(true);
  });

  it("returns terminal ok when the pointer row has no external_id (no projection)", async () => {
    const noExt = mkContactPointer({ data: { type: "contact", name: "Alice" } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await twentyToGraphitiAdapter.export(noExt as any, {});

    expect(contactGetMock).not.toHaveBeenCalled();
    expect(addEpisodeForObjectMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.externalId).toBeUndefined();
  });

  it("returns terminal ok when the Twenty record is gone (facade returns null)", async () => {
    contactGetMock.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await twentyToGraphitiAdapter.export(mkContactPointer() as any, {});

    expect(contactGetMock).toHaveBeenCalledOnce();
    expect(addEpisodeForObjectMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("returns ok:false with the error message when the provider projection throws", async () => {
    contactGetMock.mockResolvedValue({ id: "twenty-c-123", name: "Alice" });
    addEpisodeForObjectMock.mockRejectedValueOnce(new Error("Graphiti unreachable"));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await twentyToGraphitiAdapter.export(mkContactPointer() as any, {});

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Graphiti unreachable/);
  });

  it("returns terminal ok for an unsupported type (defensive — projector should not route here)", async () => {
    const wrongType = mkContactPointer({ type: "@cinatra-ai/blog:post" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await twentyToGraphitiAdapter.export(wrongType as any, {});

    expect(addEpisodeForObjectMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("H2 — episode body carries cinatra_object_id + _cinatra envelope; name has [oid:<id>] tag", async () => {
    // The CRM episode MUST emit the same recovery markers as the generic projector
    // (handlers.ts:198 extractObjectIds), otherwise semantic-search hits cannot be
    // hydrated back to the canonical cinatra.objects row.
    contactGetMock.mockResolvedValue({
      id: "twenty-c-123",
      name: "Alice",
      email: "alice@example.com",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await twentyToGraphitiAdapter.export(mkContactPointer() as any, {});

    const call = addEpisodeForObjectMock.mock.calls[0]![0] as Record<string, unknown>;
    const body = JSON.parse(call.episodeBody as string) as Record<string, unknown>;
    expect(body.cinatra_object_id).toBe("obj-1");
    expect(body._cinatra).toMatchObject({
      objectId: "obj-1",
      type: "@cinatra-ai/entity-contacts:contact",
      runId: null,
      agentId: null,
    });
    // Tag in name — handlers.ts probe #3 (OID_RE).
    expect(call.name).toBe("Alice [oid:obj-1]");
  });

  it("passes orgId:null through to the provider (which derives the cinatra-default group)", async () => {
    contactGetMock.mockResolvedValue({ id: "twenty-c-123", name: "Alice" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await twentyToGraphitiAdapter.export(mkContactPointer({ orgId: null }) as any, {});

    const call = addEpisodeForObjectMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.orgId).toBeNull();
    // The stubbed provider derives the default group; the adapter passes it through.
    expect(result.externalId).toBe("uuid:obj-1:cinatra-default");
  });
});
