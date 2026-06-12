// D8 — pointer-write durable-repair path.
//
// When the inline `objects_save` write fails after Twenty has already
// accepted the create/update, the helpers MUST enqueue a
// TWENTY_POINTER_REPAIR BullMQ job so the projection chain (pointer row →
// outbox → Graphiti) can heal out of band. These tests verify that
// contract on both writers (account / contact) and the no-op behavior on
// the success path.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setCrmRequestActorResolver,
  setObjectsProvider,
  _resetObjectsProviderForTests,
} from "@cinatra-ai/sdk-extensions";

vi.mock("server-only", () => ({}));

const { objectsSaveMock, enqueueMock } = vi.hoisted(() => ({
  objectsSaveMock: vi.fn(),
  enqueueMock: vi.fn(),
}));

// The objects subsystem is reached via the SDK's host-injected objects provider.
// module.ts calls `requireObjectsProvider().saveObject(...)`
// instead of `createObjectsPrimitiveHandlers().objects_save(...)` — the provider's
// `saveObject` is stubbed with `objectsSaveMock` via `setObjectsProvider` in
// `beforeEach` (no `@cinatra-ai/objects` import remains to mock).
//
// The repair enqueue goes through the connector's host-deps slot
// (`getCrmDeps().enqueueJob`, bound from `ctx.jobs.enqueue` by register(ctx)
// — cinatra#172 Stage H1), so the tests stub the deps slot via
// `registerCrmConnector({ enqueueJob: enqueueMock, … })` in `beforeEach`
// instead of `vi.mock("@/lib/background-jobs")`. The asserted job name stays
// the frozen "twenty-pointer-repair" queue-name contract.

// The CRM request-actor resolver is host-injected via the SDK DI slot.
// module.ts reads the current request identity through
// requireCrmRequestActorResolver().getActor() instead of @cinatra-ai/mcp-server's
// mcpRequestContextStorage directly. The store mock is overridable so we can
// simulate the inline-MCP-handler path (orgId present) and the BullMQ worker path
// (store empty → getActor() returns null). Bound in beforeEach.
const { mcpStoreMock } = vi.hoisted(() => ({
  mcpStoreMock: vi.fn(() => ({})),
}));
vi.mock("../facade", () => ({ crmFacade: {} }));
vi.mock("../integration/register-object-types", () => ({
  registerCrmObjectTypes: vi.fn(),
}));
vi.mock("../sync-adapters/twenty-to-graphiti-adapter", () => ({
  registerCrmObjectSyncAdapters: vi.fn(),
}));

import {
  writeAccountPointer,
  writeContactPointer,
  writePointerByType,
} from "../mcp/module";
import { registerCrmConnector, _resetCrmDepsForTests } from "../deps";

beforeEach(() => {
  objectsSaveMock.mockReset();
  enqueueMock.mockReset();
  // Bind the connector host-deps slot — `enqueueJob` captures the repair
  // enqueue; `getActor` is unused on these write paths (the pointer actor
  // comes from the CRM request-actor resolver below).
  _resetCrmDepsForTests();
  registerCrmConnector({
    getActor: async () => null,
    enqueueJob: enqueueMock,
  });
  // Default: simulate an inline MCP handler with orgId/userId populated.
  mcpStoreMock.mockReset();
  mcpStoreMock.mockReturnValue({ orgId: "org-1", userId: "user-7" });
  // Bind the host CRM request-actor resolver to the controllable store mock.
  // getActor() returns the store shape, or null when the store is empty/absent
  // (the BullMQ worker path), mirroring the real resolver's getStore() fallback.
  setCrmRequestActorResolver({ getActor: () => (mcpStoreMock() ?? null) as never });
  // Bind a stub objects provider — `saveObject` captures the pointer-write call;
  // the registration / graphiti methods are unused on these write paths.
  _resetObjectsProviderForTests();
  setObjectsProvider({
    saveObject: objectsSaveMock,
    registerObjectType: vi.fn(),
    registerSyncAdapter: vi.fn(),
    addGraphitiEpisodeForObject: vi.fn(),
  });
});

describe("pointer-write durable repair", () => {
  it("success path: writePointerByType calls objects_save once with the right shape and does NOT enqueue", async () => {
    objectsSaveMock.mockResolvedValueOnce(undefined);
    await writePointerByType({ type: "account", externalId: "twenty-a-1", name: "Acme" });
    expect(objectsSaveMock).toHaveBeenCalledOnce();
    const call = objectsSaveMock.mock.calls[0]![0];
    expect(call).toMatchObject({
      typeHint: "@cinatra-ai/entity-accounts:account",
      rawData: { type: "account", external_id: "twenty-a-1", name: "Acme" },
    });
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("contact success path uses the contact typeHint", async () => {
    objectsSaveMock.mockResolvedValueOnce(undefined);
    await writePointerByType({ type: "contact", externalId: "twenty-c-2", name: "Alice" });
    const call = objectsSaveMock.mock.calls[0]![0];
    expect(call.typeHint).toBe("@cinatra-ai/entity-contacts:contact");
  });

  it("account failure path enqueues TWENTY_POINTER_REPAIR with attempts/backoff + captured orgId/userId", async () => {
    objectsSaveMock.mockRejectedValueOnce(new Error("DB transient"));
    enqueueMock.mockResolvedValueOnce(undefined);

    await writeAccountPointer({
      id: "twenty-a-77",
      name: "Acme",
    } as never);

    expect(enqueueMock).toHaveBeenCalledOnce();
    const [jobName, payload, options] = enqueueMock.mock.calls[0]!;
    expect(jobName).toBe("twenty-pointer-repair");
    // orgId/userId MUST be captured at enqueue time so the BullMQ worker
    // can rehydrate a valid actor — the worker process has no MCP request
    // store, so without these the synthesised actor would have orgId=null
    // and every retry would fail objects_save's authz gate deterministically.
    expect(payload).toEqual({
      type: "account",
      externalId: "twenty-a-77",
      name: "Acme",
      orgId: "org-1",
      userId: "user-7",
    });
    expect(options).toMatchObject({
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
    });
  });

  it("contact failure path enqueues TWENTY_POINTER_REPAIR with contact discriminator", async () => {
    objectsSaveMock.mockRejectedValueOnce(new Error("authz denied"));
    enqueueMock.mockResolvedValueOnce(undefined);

    await writeContactPointer({
      id: "twenty-c-99",
      name: "Bob",
    } as never);

    expect(enqueueMock).toHaveBeenCalledOnce();
    expect(enqueueMock.mock.calls[0]![1]).toEqual({
      type: "contact",
      externalId: "twenty-c-99",
      name: "Bob",
      orgId: "org-1",
      userId: "user-7",
    });
  });

  it("synthetic actor stamps roles:['member'] so userless callers pass object.create authz", async () => {
    // `actorType: "model"` without an explicit role resolves to
    // ServiceAccount via buildActorContextFromPrimitive + deriveRoleHints.
    // ServiceAccount has only { agent.execute, run.read } — no
    // object.create. Without the explicit `roles: ["member"]` stamp,
    // every pointer-write retry would fail the objects_save authz gate
    // forever, losing the Twenty record from cinatra/Graphiti.
    //
    // The fix: stamp roles:["member"] on the synthetic actor so
    // deriveRoleHints lifts it to orgRole:"member", which has object.create.
    // Bounded to the captured orgId, so no cross-org leak.
    mcpStoreMock.mockReturnValueOnce(undefined as never);
    objectsSaveMock.mockResolvedValueOnce(undefined);

    await writePointerByType({
      type: "account",
      externalId: "twenty-a-77",
      name: "Acme",
      orgId: "org-1",
      userId: null,
    });

    const actor = objectsSaveMock.mock.calls[0]![0].actor;
    expect(actor.roles).toEqual(["member"]);
    expect(actor.orgId).toBe("org-1");
    // Stamp both `orgId` (legacy MCP shape) and `organizationId` (kernel
    // bridge shape) — deriveRoleHints reads either, but be defensive.
    expect(actor.organizationId).toBe("org-1");
  });

  it("inline buildPointerActor (success path with mcpRequestContextStorage frame) also stamps roles:['member']", async () => {
    // The inline path has the same authz vulnerability — a chat session
    // with a userId but no explicit role hints would land as a HumanUser
    // with no orgRole, which the kernel can() also denies for object.create.
    // Stamping roles:["member"] on the inline actor ensures parity with the
    // worker-rehydration path.
    mcpStoreMock.mockReturnValueOnce({ orgId: "org-9", userId: "user-42" });
    objectsSaveMock.mockResolvedValueOnce(undefined);

    await writePointerByType({
      type: "contact",
      externalId: "twenty-c-1",
      name: "Charlie",
      // Note: no orgId/userId in payload → uses mcpRequestContextStorage path
    });

    const actor = objectsSaveMock.mock.calls[0]![0].actor;
    expect(actor.roles).toEqual(["member"]);
    expect(actor.orgId).toBe("org-9");
    expect(actor.userId).toBe("user-42");
  });

  it("worker rehydration: explicit orgId/userId in payload synthesises actor, bypassing empty mcpRequestContextStorage", async () => {
    // Simulate the BullMQ worker process: mcpRequestContextStorage.getStore()
    // returns nothing because the worker is a different process from the
    // inline MCP handler. In r1, the worker would call writePointerByType
    // with only { type, externalId, name } and the resulting actor would
    // have orgId === null → objects_save rejects on the orgId guard.
    // The fix: the worker passes the orgId/userId captured at enqueue time;
    // writePointerByType synthesises the actor from those instead of the
    // empty store.
    mcpStoreMock.mockReturnValueOnce(undefined as never);
    objectsSaveMock.mockResolvedValueOnce(undefined);

    await writePointerByType({
      type: "account",
      externalId: "twenty-a-77",
      name: "Acme",
      orgId: "org-1",
      userId: "user-7",
    });

    expect(objectsSaveMock).toHaveBeenCalledOnce();
    const actor = objectsSaveMock.mock.calls[0]![0].actor;
    expect(actor.orgId).toBe("org-1");
    expect(actor.userId).toBe("user-7");
    // The synthetic actor stamps source:"agent" so the projector source-gate
    // still admits the pointer row through to Graphiti.
    expect(actor.source).toBe("agent");
  });

  it("worker rehydration with null userId still produces an actor with orgId (the only required field)", async () => {
    mcpStoreMock.mockReturnValueOnce(undefined as never);
    objectsSaveMock.mockResolvedValueOnce(undefined);

    await writePointerByType({
      type: "contact",
      externalId: "twenty-c-99",
      name: "Bob",
      orgId: "org-1",
      userId: null,
    });

    const actor = objectsSaveMock.mock.calls[0]![0].actor;
    expect(actor.orgId).toBe("org-1");
    expect(actor.userId).toBeUndefined();
    expect(actor.actorType).toBe("model");
  });

  it("cold-worker regression: registerCrmObjectTypes is exported from the package barrel for the BullMQ worker to call before writePointerByType", async () => {
    // A BullMQ worker that boots without going
    // through createCrmModule() has no CRM types registered. When the
    // worker dispatches TWENTY_POINTER_REPAIR and calls writePointerByType,
    // objects_save's classifier fast-path
    // (`objectTypeRegistry.resolve(typeHint)`) would miss and fall through
    // to LLM classification — potentially failing without an LLM provider
    // or misclassifying the minimal pointer row. The worker handler in
    // src/lib/background-jobs.ts (TWENTY_POINTER_REPAIR case) MUST
    // dynamic-import + call `registerCrmObjectTypes` before invoking
    // `writePointerByType`. This test guards the barrel export contract.
    const barrel = await import("../index");
    expect(typeof barrel.registerCrmObjectTypes).toBe("function");
    // Idempotent — calling twice is safe (replace-by-id on the registry).
    expect(() => barrel.registerCrmObjectTypes()).not.toThrow();
    expect(() => barrel.registerCrmObjectTypes()).not.toThrow();
  });

  it("does NOT throw when both objects_save AND the repair enqueue fail, and emits a structured POINTER_REPAIR_FALLBACK stderr line for log-aggregator durability", async () => {
    objectsSaveMock.mockRejectedValueOnce(new Error("DB transient"));
    enqueueMock.mockRejectedValueOnce(new Error("Redis unreachable"));

    const stderrChunks: string[] = [];
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        stderrChunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
        return true;
      });

    try {
      // The contract: the parent crm_*_create/update must not bounce a
      // known-good Twenty mutation back to the caller.
      await expect(
        writeAccountPointer({ id: "twenty-a-x", name: "Lost" } as never),
      ).resolves.toBeUndefined();

      // The structured fallback line is the durability backstop when
      // BullMQ enqueue itself fails (Redis unreachable). It MUST carry
      // the full repair payload so an operator can drain a log-aggregator
      // query and replay missing pointers manually.
      const fallbackLine = stderrChunks.find((line) =>
        line.startsWith("[POINTER_REPAIR_FALLBACK]"),
      );
      expect(fallbackLine).toBeDefined();
      const json = JSON.parse(fallbackLine!.replace("[POINTER_REPAIR_FALLBACK] ", ""));
      expect(json).toMatchObject({
        kind: "POINTER_REPAIR_FALLBACK",
        type: "account",
        externalId: "twenty-a-x",
        name: "Lost",
        orgId: "org-1",
        userId: "user-7",
        inlineCause: "DB transient",
        enqueueCause: "Redis unreachable",
      });
      expect(typeof json.timestamp).toBe("string");
    } finally {
      writeSpy.mockRestore();
    }
  });
});
