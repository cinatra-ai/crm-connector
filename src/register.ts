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
//
// HOST-PEER HYGIENE (host-peer-value-import ban): this serverEntry graph
// imports the SDK TYPE-ONLY and reaches only the dependency-light leaf
// modules (object-type-definitions / pointer-writer-core /
// twenty-to-graphiti-core). The objects provider and the CRM provider lookup
// arrive as VALUES through the `@cinatra-ai/host:objects-integration` host
// service in the capability registry — never via an SDK value import.

import type {
  ExtensionHostContext,
  HostObjectsIntegrationService,
  ObjectsProvider,
  CrmConnector,
} from "@cinatra-ai/sdk-extensions";
import { CRM_OBJECT_TYPE_DEFINITIONS } from "./integration/object-type-definitions";
import {
  buildPointerActorFromIds,
  writeCrmPointerWith,
  type CrmPointerPayload,
} from "./integration/pointer-writer-core";
import { makeTwentyToGraphitiAdapter } from "./sync-adapters/twenty-to-graphiti-core";

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

  // DELIBERATELY no eager registration calls here: register(ctx) is
  // registration-only (capability providers in, nothing else touched).
  //   1. required-extension-activation arms a prod-boot throw on activation
  //      failure — this body cannot perform I/O;
  //   2. the hot-update PROBE runs register(ctx) with inert registration
  //      sinks but REAL capability reads — an eager
  //      registerObjectTypes()/ensureSyncRegistrations() call would mutate
  //      the live object registries mid-probe;
  //   3. every consumer self-ensures: registerAllObjectTypes() runs the
  //      registrar loop before relying on the types, and the
  //      graphiti-projection-repair cycle runs the sync bootstrap ahead of
  //      every outbox pass.
}
