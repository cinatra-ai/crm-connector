// Host-deps slot binding — cinatra#172 Stage H1 (slot-timing hardening).
//
// The P1 ctx-port adoption: register(ctx) adapts the GRANTED `ctx.authSession`
// + `ctx.jobs` host ports into the connector's globalThis deps slot. These
// tests pin the slot-timing properties every deps slot must hold:
//
//   1. register(ctx) POPULATES the slot before any separately-compiled
//      consumer (the find-contact "use server" action, the MCP pointer-repair
//      enqueue) resolves it — and the adapters defer every ctx port access to
//      call time (registration touches no port).
//   2. An UNREGISTERED slot fails LOUD with a message naming the package and
//      the missing registration step (never a silent fallback).
//   3. A REAL re-activation REPLACES (always-bind for real activations — a
//      hot-update digest swap re-binds fresh resolvers).
//   4. The hot-update PROBE never binds: the probe's registration sinks are
//      INERT recorders while capability READS stay REAL (the documented
//      contract in the host's createExtensionProbeHostContext), so the
//      provider instance register(ctx) just registered is NOT visible to
//      resolveProviders — register(ctx) must leave the process-global slot
//      alone (a probe `ctx.jobs.enqueue` is a no-op; capturing it would
//      silently drop pointer-repair durability, and an aborted probe never
//      re-runs the live digest's register to heal the binding).
//
// Plus the consumer-side contract: the find-contact action's actor gate maps
// `getActor() === null` to its typed "Not authenticated." envelope WITHOUT
// touching the CRM facade.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { findByEmailMock } = vi.hoisted(() => ({
  findByEmailMock: vi.fn(),
}));
vi.mock("../facade", () => ({
  crmFacade: { contact: { findByEmail: findByEmailMock } },
}));

import { register } from "../register";
import {
  getCrmDeps,
  registerCrmConnector,
  _resetCrmDepsForTests,
} from "../deps";
import { findContactByEmailAction } from "../chat-widgets/find-contact-action";
import type { ExtensionHostContext } from "@cinatra-ai/sdk-extensions";

type ProviderRecord = { packageName: string; impl: unknown };

/**
 * A ctx whose capabilities surface mirrors the REAL host registry contract:
 * `registerProvider` stores the provider BY REFERENCE and `resolveProviders`
 * returns the stored records (mode "real"), or — mirroring the hot-update
 * PROBE contract — `registerProvider` records into an inert recorder while
 * `resolveProviders` answers from the (separate) live registry the probe
 * reads through (mode "probe").
 */
function makeCtx(mode: "real" | "probe", liveRegistry?: Map<string, ProviderRecord[]>) {
  const registry = liveRegistry ?? new Map<string, ProviderRecord[]>();
  const probeRecorder: Array<{ capability: string; provider: ProviderRecord }> = [];
  const getActorMock = vi.fn(async () => ({
    userId: "user-1",
    organizationId: "org-1",
    orgRole: "member",
  }));
  const enqueueMock = vi.fn(async () => ({ id: "job-1" }));
  const probeEnqueueNoop = vi.fn(async () => ({ id: "probe-noop" }));
  let authSessionPortReads = 0;
  let jobsPortReads = 0;
  const ctx = {
    capabilities: {
      registerProvider: (capability: string, provider: ProviderRecord) => {
        if (mode === "probe") {
          probeRecorder.push({ capability, provider });
          return;
        }
        const list = registry.get(capability) ?? [];
        registry.set(capability, [...list.filter((p) => p.packageName !== provider.packageName), provider]);
      },
      resolveProviders: (capability: string) => registry.get(capability) ?? [],
    },
    get authSession() {
      authSessionPortReads += 1;
      return { getActor: getActorMock, requireOrganizationId: vi.fn() };
    },
    get jobs() {
      jobsPortReads += 1;
      return {
        enqueue: mode === "probe" ? probeEnqueueNoop : enqueueMock,
        registerWorker: vi.fn(),
      };
    },
  };
  return {
    ctx: ctx as unknown as ExtensionHostContext,
    registry,
    getActorMock,
    enqueueMock,
    probeEnqueueNoop,
    portReads: () => ({ authSession: authSessionPortReads, jobs: jobsPortReads }),
  };
}

function formDataWithEmail(email: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetCrmDepsForTests();
});

describe("register(ctx) — host-deps slot binding (cinatra#172 Stage H1)", () => {
  it("binds the slot at REAL activation WITHOUT touching the grant-gated ports (lazy adapters)", async () => {
    const { ctx, getActorMock, enqueueMock, portReads } = makeCtx("real");
    register(ctx);
    // Registration-only: neither `ctx.authSession` nor `ctx.jobs` was read —
    // the hot-update probe and prod-boot arming both rely on this.
    expect(portReads()).toEqual({ authSession: 0, jobs: 0 });

    // Call time: the adapters forward to the live ports.
    await expect(getCrmDeps().getActor()).resolves.toEqual({
      userId: "user-1",
      organizationId: "org-1",
      orgRole: "member",
    });
    expect(getActorMock).toHaveBeenCalledOnce();

    await expect(
      getCrmDeps().enqueueJob(
        "twenty-pointer-repair",
        { type: "account", externalId: "a-1", name: "Acme" },
        { attempts: 5 },
      ),
    ).resolves.toEqual({ id: "job-1" });
    expect(enqueueMock).toHaveBeenCalledWith(
      "twenty-pointer-repair",
      { type: "account", externalId: "a-1", name: "Acme" },
      { attempts: 5 },
    );
    expect(portReads().authSession).toBeGreaterThan(0);
    expect(portReads().jobs).toBeGreaterThan(0);
  });

  it("a REAL re-activation REPLACES a pre-bound slot (always-bind — hot-update digest swaps re-bind fresh resolvers)", async () => {
    const sentinel = vi.fn(async () => null);
    registerCrmConnector({ getActor: sentinel, enqueueJob: vi.fn() });
    const { ctx, getActorMock } = makeCtx("real");
    register(ctx);
    await getCrmDeps().getActor();
    expect(getActorMock).toHaveBeenCalledOnce();
    expect(sentinel).not.toHaveBeenCalled();
  });

  it("fails LOUD on an unregistered slot, naming the package and the registration step", () => {
    expect(() => getCrmDeps()).toThrow(
      /@cinatra-ai\/crm-connector: host runtime deps not registered/,
    );
    expect(() => getCrmDeps()).toThrow(/serverEntry register\(ctx\)/);
    expect(() => getCrmDeps()).toThrow(/registerCrmConnector\(stubDeps\)/);
  });

  it("the hot-update PROBE does NOT bind an empty slot (inert registration sink => our impl never live-visible)", () => {
    const { ctx } = makeCtx("probe");
    register(ctx);
    // The slot must still be unregistered: a probe binding would capture the
    // probe's no-op jobs port into the process-global slot.
    expect(() => getCrmDeps()).toThrow(/host runtime deps not registered/);
  });

  it("the hot-update PROBE leaves an existing LIVE binding untouched (aborted probes must not poison durability)", async () => {
    // The live digest's binding (a real activation happened earlier).
    const live = makeCtx("real");
    register(live.ctx);

    // A NEW digest's probe runs in the same process: its recorder swallows the
    // new registrations, resolveProviders still answers with the LIVE digest's
    // provider instances (reads stay real), and its ctx.jobs is a no-op.
    const probe = makeCtx("probe", live.registry);
    register(probe.ctx);

    // The slot still forwards to the LIVE ports — not the probe no-op.
    await getCrmDeps().enqueueJob("twenty-pointer-repair", { x: 1 });
    expect(live.enqueueMock).toHaveBeenCalledWith("twenty-pointer-repair", { x: 1 }, undefined);
    expect(probe.probeEnqueueNoop).not.toHaveBeenCalled();
  });
});

describe("findContactByEmailAction — deps-slot actor gate", () => {
  it("maps getActor() === null to the typed 'Not authenticated.' envelope WITHOUT calling the facade", async () => {
    registerCrmConnector({
      getActor: async () => null,
      enqueueJob: vi.fn(),
    });
    const result = await findContactByEmailAction(formDataWithEmail("a@b.co"));
    expect(result).toEqual({ status: "error", message: "Not authenticated." });
    expect(findByEmailMock).not.toHaveBeenCalled();
  });

  it("proceeds to the facade lookup for an authenticated actor (slot bound by register(ctx))", async () => {
    const { ctx } = makeCtx("real");
    register(ctx);
    findByEmailMock.mockResolvedValueOnce({
      id: "c-1",
      name: "Alice",
      email: "a@b.co",
      title: "CEO",
      accountId: "acc-1",
    });
    const result = await findContactByEmailAction(formDataWithEmail("a@b.co"));
    expect(result).toEqual({
      status: "found",
      contactId: "c-1",
      name: "Alice",
      email: "a@b.co",
      title: "CEO",
      accountId: "acc-1",
    });
    expect(findByEmailMock).toHaveBeenCalledWith({ email: "a@b.co" });
  });
});
