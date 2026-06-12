// The crm-connector's `register(ctx)` server entry.
//
// Lazy/guarded host-access cutover: the host no longer value-imports this
// package — its consumers resolve the CRM integration surfaces from the
// capability registry at call time:
//
//   - `object-type-registrar`: the host's registerAllObjectTypes() invokes
//     every registered registrar, so the CRM object types (account / contact /
//     list) register without the host naming this package. Every consumption
//     site invokes the loop BEFORE relying on the types, so no eager
//     activation-time registration is needed (and none happens: a hot-update
//     PROBE runs this register against an inert recorder but with REAL
//     capability READS — an eager call here would mutate live registries
//     mid-probe).
//   - `crm-sync-bootstrap`: the host's graphiti-projection-repair cycle
//     re-ensures the Twenty→Graphiti object-sync adapter is registered before
//     EACH outbox pass (the ensure runs inside the same cycle, ahead of
//     processProjectionOutbox), so pending rows across a restart are routable
//     from the first cycle. Replace-by-id idempotent everywhere.
//   - `crm-pointer-writer`: the host's twenty-pointer-repair job writes CRM
//     pointer rows through this impl. The impl owns the
//     register-types-before-write ordering (the objects_save classifier
//     fast-path) via the shared pointer-writer core.
//   - `crm-list-reader`: the provider-agnostic LIST READ surface (cinatra#151
//     Stage 4) — the host's agent-builder list picker resolves it at call
//     time instead of value-importing this package's `crmFacade` export.
//     Deliberately NARROW (least privilege): exactly the read member the host
//     consumes today; mutation members stay off the capability surface.
//
// Transport-DI deps binding (cinatra#172 Stage H1): this entry ALSO binds the
// connector's host-deps slot (`./deps`) by adapting the GRANTED
// `ctx.authSession` + `ctx.jobs` ports — the find-contact "use server" action
// and the MCP pointer-repair enqueue resolve them via `getCrmDeps()` from
// separately-compiled bundles (server actions cannot close over ctx). Both
// adapters are LAZY closures (no port is touched at registration time —
// registration-only, no I/O), and the binding is PROBE-GATED: only a REAL
// activation may (re)bind the process-global slot, because the hot-update
// probe's `ctx.jobs` is a no-op that would silently drop pointer-repair
// durability if captured (see the binding-site comment in register()).
//
// HOST-PEER HYGIENE (host-peer-value-import ban): this serverEntry graph
// imports the SDK TYPE-ONLY and reaches only the dependency-light leaf
// modules (object-type-definitions / pointer-writer-core /
// twenty-to-graphiti-core / deps). The objects provider and the CRM provider
// lookup arrive as VALUES through the `@cinatra-ai/host:objects-integration`
// host service in the capability registry — never via an SDK value import.

import type {
  ExtensionHostContext,
  HostObjectsIntegrationService,
  ObjectsProvider,
  CrmConnector,
} from "@cinatra-ai/sdk-extensions";
import { registerCrmConnector } from "./deps";
import { CRM_OBJECT_TYPE_DEFINITIONS } from "./integration/object-type-definitions";
import {
  buildPointerActorFromIds,
  writeCrmPointerWith,
  type CrmPointerPayload,
} from "./integration/pointer-writer-core";
import { makeTwentyToGraphitiAdapter } from "./sync-adapters/twenty-to-graphiti-core";
import type { CrmList } from "./contract";

const PACKAGE_NAME = "@cinatra-ai/crm-connector";

function hostObjectsIntegration(ctx: ExtensionHostContext): HostObjectsIntegrationService | null {
  const provider = ctx.capabilities.resolveProviders("@cinatra-ai/host:objects-integration")[0];
  return (provider?.impl as HostObjectsIntegrationService | undefined) ?? null;
}

export function register(ctx: ExtensionHostContext): void {
  const svc = () => hostObjectsIntegration(ctx);
  const objectsProvider = (): ObjectsProvider | null => svc()?.getObjectsProvider() ?? null;

  // Single-provider resolution chain (mirrors the facade's resolveProvider):
  // today every CRM op resolves to "twenty" — the only registered provider.
  const lookupProvider = (): CrmConnector | null =>
    (svc()?.lookupCrmProvider("twenty") as CrmConnector | null) ?? null;

  const registerObjectTypes = (): void => {
    const provider = objectsProvider();
    if (!provider) return; // build-time / unwired host — registry discarded there.
    for (const definition of CRM_OBJECT_TYPE_DEFINITIONS) {
      provider.registerObjectType(definition);
    }
  };

  const ensureSyncRegistrations = (): void => {
    const provider = objectsProvider();
    if (!provider) return;
    provider.registerSyncAdapter(
      makeTwentyToGraphitiAdapter({
        addGraphitiEpisodeForObject: (input) => {
          const p = objectsProvider();
          if (!p) {
            throw new Error(`${PACKAGE_NAME}: host objects surface is not wired`);
          }
          return p.addGraphitiEpisodeForObject(input);
        },
        getAccount: async (id) => {
          const crm = lookupProvider();
          if (!crm) {
            throw new Error(`${PACKAGE_NAME}: no CRM provider registered (twenty inactive?)`);
          }
          return crm.getAccount({ id });
        },
        getContact: async (id) => {
          const crm = lookupProvider();
          if (!crm) {
            throw new Error(`${PACKAGE_NAME}: no CRM provider registered (twenty inactive?)`);
          }
          return crm.getContact({ id });
        },
      }),
    );
  };

  ctx.capabilities.registerProvider("object-type-registrar", {
    packageName: PACKAGE_NAME,
    impl: { registerObjectTypes },
  });

  ctx.capabilities.registerProvider("crm-sync-bootstrap", {
    packageName: PACKAGE_NAME,
    impl: { ensureSyncRegistrations },
  });

  ctx.capabilities.registerProvider("crm-pointer-writer", {
    packageName: PACKAGE_NAME,
    impl: {
      writePointer: async (payload: CrmPointerPayload) => {
        const provider = objectsProvider();
        if (!provider) {
          throw new Error(`${PACKAGE_NAME}: host objects surface is not wired`);
        }
        await writeCrmPointerWith(
          provider,
          payload,
          buildPointerActorFromIds({
            orgId: payload.orgId ?? null,
            userId: payload.userId ?? null,
          }),
        );
      },
    },
  });

  // The provider-agnostic CRM LIST READ surface (cinatra#151 Stage 4): the
  // host's agent-builder list picker resolves `crm-list-reader` from the
  // capability registry instead of value-importing this package's `crmFacade`
  // export. Deliberately NARROW (least privilege — the getNangoClient/
  // shellTools precedent): exactly the read member the host consumes;
  // mutation members are NOT exposed through the capability registry.
  // Resolution policy mirrors facade.ts:resolveProvider (single-provider
  // "twenty" today) via the host objects-integration service's lookup (a
  // VALUE arriving through ctx.capabilities — SDK imports stay type-only);
  // a missing provider throws descriptively — never a silent empty result
  // (the HOST consumer owns its degraded-to-empty policy).
  const listReaderImpl = {
    searchLists: async (input: {
      query: string;
      objectType?: "contact" | "account";
    }): Promise<CrmList[]> => {
      const provider = lookupProvider();
      if (!provider) {
        throw new Error(
          `${PACKAGE_NAME}: no CRM provider registered (twenty inactive?). ` +
            `Activate a CRM provider extension before using the crm-list-reader capability.`,
        );
      }
      return provider.searchLists(input);
    },
  };
  ctx.capabilities.registerProvider("crm-list-reader", {
    packageName: PACKAGE_NAME,
    impl: listReaderImpl,
  });

  // Host-deps slot binding (cinatra#172 Stage H1) — REAL activations only,
  // never the hot-update PROBE. The probe contract (extension-host-context.ts
  // createExtensionProbeHostContext): registration sinks are INERT recorders
  // while capability READS stay REAL, and `ctx.jobs.enqueue` is a probe no-op.
  // The deps slot is PROCESS-GLOBAL (`Symbol.for` on globalThis, shared with
  // the live digest's separately-compiled callers), so binding it from a probe
  // ctx would capture the probe's no-op jobs port — the pointer-repair enqueue
  // would silently drop durability, and an aborted probe would leave the
  // poisoned binding behind (the old digest's register is not re-run on probe
  // rejection). Detection rides the documented contract itself: the provider
  // instance registered ABOVE is visible to `resolveProviders` iff the
  // registration sink was the REAL registry (the registry stores providers
  // by reference; the probe recorder swallows them) — so bind iff OUR
  // `listReaderImpl` instance is live. A probe therefore leaves any existing
  // live binding untouched, and the new digest's REAL activation (after the
  // probe passes and the old digest is torn down) re-binds fresh resolvers.
  // The adapter closures still defer every port access to call time
  // (registration-only: no `ctx.authSession` / `ctx.jobs` read happens here).
  const liveRegistered = ctx.capabilities
    .resolveProviders("crm-list-reader")
    .some((provider) => provider.impl === listReaderImpl);
  if (liveRegistered) {
    registerCrmConnector({
      getActor: () => ctx.authSession.getActor(),
      enqueueJob: (jobName, payload, opts) => ctx.jobs.enqueue(jobName, payload, opts),
    });
  }

  // DELIBERATELY no eager registration calls here: register(ctx) is
  // registration-only (capability providers in, nothing else touched).
  //   1. required-extension-activation arms a prod-boot throw on activation
  //      failure — this body cannot perform I/O;
  //   2. the hot-update PROBE runs register(ctx) with inert registration
  //      sinks but REAL capability reads — an eager
  //      registerObjectTypes()/ensureSyncRegistrations() call would mutate
  //      the live object registries mid-probe (and the deps-slot binding
  //      above is probe-gated for the same live-state reason);
  //   3. every consumer self-ensures: registerAllObjectTypes() runs the
  //      registrar loop before relying on the types, and the
  //      graphiti-projection-repair cycle runs the sync bootstrap ahead of
  //      every outbox pass.
}
