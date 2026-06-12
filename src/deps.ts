// ---------------------------------------------------------------------------
// @cinatra-ai/crm-connector — host dependency injection singleton.
//
// Host dependency injection keeps the crm connector decoupled from
// host-internal modules (`@/lib/auth-session`, `@/lib/background-jobs`).
// Direct `@/` imports anchor the package to the host's src/ tree and prevent
// the package from running from `extensions/cinatra-ai/crm-connector/`; `@/`
// resolves to `src/` only inside the host.
//
// The fix (cinatra#172 Stage H1 — the P1 ctx-port adoption): the connector's
// own serverEntry `register(ctx)` adapts the GRANTED `ctx.authSession` and
// `ctx.jobs` host ports into this slot at activation. Runtime callers resolve
// the injected impls via `getCrmDeps()` on every call:
//
//   - `getActor()` — the actor summary across cookie / MCP / worker / A2A
//     contexts (`ctx.authSession.getActor()`). The find-contact server action
//     null-checks it as its auth gate (an unauthenticated caller gets the
//     action's typed `{ status: "error" }` envelope, never a Twenty call).
//   - `enqueueJob(jobName, payload, opts)` — durable background-job enqueue
//     (`ctx.jobs.enqueue`); the host's static dispatcher (`BACKGROUND_JOB_NAMES`
//     worker switch) owns the name — an unrecognised name is rejected at
//     DISPATCH time, so the literal must stay in lockstep with the host.
//
// Test compatibility: tests that exercise the action / pointer-repair paths
// call `registerCrmConnector(stubDeps)` in setup and
// `_resetCrmDepsForTests()` between describe blocks.
// ---------------------------------------------------------------------------

/** The actor summary the host `authSession` port resolves (structural copy of
 *  the SDK `HostAuthSessionPort.getActor()` result — inlined so this module
 *  compiles against any host without an SDK import). `null` = genuinely
 *  unauthenticated (no cookie / MCP / worker / A2A actor). */
export type CrmActorSummary = {
  userId: string | null;
  organizationId: string | null;
  orgRole: string | null;
} | null;

/**
 * The narrow surface of the host that the crm connector needs at runtime:
 * actor resolution (the auth gate) + background-job enqueue (pointer repair).
 */
export interface CrmConnectorDeps {
  /** Resolve the current actor across cookie / MCP / worker / A2A contexts.
   *  Non-throwing: resolves `null` when no trusted context carries an actor. */
  getActor: () => Promise<CrmActorSummary>;

  /** Enqueue a durable background job on the host queue. `jobName` must be a
   *  host-recognised name (see TWENTY_POINTER_REPAIR_JOB in mcp/module.ts). */
  enqueueJob: (
    jobName: string,
    payload: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ) => Promise<{ id: string }>;
}

// Anchor the deps slot on `globalThis` via a namespaced+versioned Symbol so the
// activation-time registration (the connector's serverEntry `register(ctx)`,
// loaded in the instrumentation compilation) and the runtime callers — which
// live in SEPARATELY-COMPILED Next.js bundles that never import the registrar
// (the find-contact "use server" action, the MCP handler bundle, the BullMQ
// worker bundle) — resolve the SAME slot. A module-local binding would leave
// those bundles' instance unregistered → getCrmDeps() would throw. (Same
// cross-compilation reason as the gmail/anthropic/wordpress-mcp deps slots.)
const CRM_DEPS_KEY = Symbol.for("@cinatra-ai/crm-connector:host-deps/v1");
type DepsHolder = { [k: symbol]: CrmConnectorDeps | null | undefined };
const _holder = globalThis as unknown as DepsHolder;

/**
 * Wire the host's runtime dependencies into the crm connector. Called once at
 * activation (the connector's serverEntry `register(ctx)`).
 *
 * Re-calling replaces the previous wiring — tests can use this to swap in
 * stubs between `describe` blocks.
 */
export function registerCrmConnector(deps: CrmConnectorDeps): void {
  _holder[CRM_DEPS_KEY] = deps;
}

/**
 * Resolve injected host deps. Throws loud if `registerCrmConnector` has not
 * been called — preferred over silent fallback because a missing registration
 * is always a boot-wiring bug.
 */
export function getCrmDeps(): CrmConnectorDeps {
  const deps = _holder[CRM_DEPS_KEY];
  if (!deps) {
    throw new Error(
      "@cinatra-ai/crm-connector: host runtime deps not registered. " +
        "The connector's serverEntry register(ctx) binds them at activation " +
        "(tests: call registerCrmConnector(stubDeps) in setup).",
    );
  }
  return deps;
}

/**
 * @internal Only for tests — clear deps so a fresh registration is required.
 */
export function _resetCrmDepsForTests(): void {
  _holder[CRM_DEPS_KEY] = null;
}
