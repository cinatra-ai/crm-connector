// CRM pointer-write CORE — a dependency-light LEAF module (SDK types only; NO
// SDK value imports), shared by:
//   - `mcp/module.ts` (`writePointerByType`) — inline + worker writes through
//     the SDK `requireObjectsProvider()` slot;
//   - `src/register.ts` — the serverEntry activation path, which registers a
//     `crm-pointer-writer` capability whose impl writes through the
//     HOST-PROVIDED objects surface (the host-peer-value-import ban keeps the
//     serverEntry graph free of SDK value imports).

import type { ObjectsProvider } from "@cinatra-ai/sdk-extensions";
import { CRM_OBJECT_TYPE_DEFINITIONS } from "./object-type-definitions";

export type CrmPointerPayload = {
  type: "account" | "contact";
  externalId: string;
  name: string;
  orgId?: string | null;
  userId?: string | null;
};

/**
 * Build a synthetic pointer actor from explicit orgId/userId. The BullMQ
 * worker has no MCP request store (the ALS frame is process-local to the
 * inline MCP handler), so it cannot use `mcpRequestContextStorage.getStore()`
 * to recover the actor — instead the inline writer captures orgId+userId at
 * enqueue time and the worker rehydrates an equivalent actor via this helper.
 *
 * The payload MUST carry orgId/userId so the worker handler can mint an
 * actor with a valid orgId (otherwise objects_save rejects on entry).
 *
 * The actor MUST stamp `roles: ["member"]` so `deriveRoleHints` lifts it
 * to `orgRole: "member"`. Without an explicit role, a userless caller
 * resolves to `ServiceAccount` (which has only agent.execute + run.read —
 * NOT object.create) and every pointer-write retry fails authz
 * deterministically. The pointer write is a server-internal data-shadow
 * action that always succeeds inside the orgId scope the caller already
 * proved access to via the parent crm_*_create/update gate, so granting
 * the synthetic actor `member` is consistent with the parent operation's
 * scope and does NOT escalate privileges across orgs (the kernel's
 * cross-org guard still fires because the resource's org_id must match
 * the actor's organizationId).
 */
export function buildPointerActorFromIds(input: {
  orgId: string | null;
  userId: string | null;
}): Record<string, unknown> {
  const actor: Record<string, unknown> = {
    actorType: "model",
    source: "agent",
    // `roles: ["member"]` is the narrow grant — see doctrine above.
    // `deriveRoleHints` picks the highest role from this list (it tolerates
    // session-attributed callers who may also carry org_admin / org_owner
    // — those would already be present in the actor's role bag from the
    // session-lineage path, but for pointer-write specifically we always
    // grant the floor of `member` so the userless case never falls
    // through to the no-object.create ServiceAccount path).
    roles: ["member"],
  };
  if (input.userId) actor.userId = input.userId;
  if (input.orgId) {
    // The MCP-bridge legacy shape uses `orgId`; the kernel bridge reads
    // either `organizationId` or `orgId` for the cross-org guard, so stamp
    // both for resilience against either side of the read.
    actor.orgId = input.orgId;
    actor.organizationId = input.orgId;
  }
  return actor;
}

/** Map the pointer discriminator to the persisted substrate type id. */
export function crmPointerTypeHint(type: "account" | "contact"): string {
  return type === "account"
    ? "@cinatra-ai/entity-accounts:account"
    : "@cinatra-ai/entity-contacts:contact";
}

/**
 * Write a single CRM pointer row through the GIVEN objects provider with the
 * GIVEN actor. Registers the CRM object types first (replace-by-id) so the
 * `objects_save` classifier fast-path (`objectTypeRegistry.resolve(typeHint)`)
 * hits the static entry — the register-before-write ordering is owned here,
 * never by the caller.
 */
export async function writeCrmPointerWith(
  provider: ObjectsProvider,
  payload: CrmPointerPayload,
  actor: Record<string, unknown>,
): Promise<void> {
  for (const definition of CRM_OBJECT_TYPE_DEFINITIONS) {
    provider.registerObjectType(definition);
  }
  await provider.saveObject({
    typeHint: crmPointerTypeHint(payload.type),
    rawData: {
      type: payload.type,
      external_id: payload.externalId,
      name: payload.name,
    },
    actor,
    mode: "agentic",
  });
}
