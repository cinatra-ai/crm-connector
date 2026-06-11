// Twenty→Graphiti adapter CORE — a dependency-light LEAF module (zod + the
// SDK's erased types only; NO SDK value imports, NO facade/registry imports).
// The concrete adapter instances are built by:
//   - `./twenty-to-graphiti-adapter.ts` — the SDK-slot path (requireObjectsProvider
//     + crmFacade) used by the MCP-module/boot callers;
//   - `src/register.ts` — the serverEntry activation path, which builds the
//     SAME adapter (same id; registries are replace-by-id) from the
//     HOST-PROVIDED objects/lookup surfaces, keeping the serverEntry graph
//     free of SDK value imports (the host-peer-value-import ban).

import { z } from "zod";
import type { ObjectSyncAdapter, ObjectsProvider, StoredObject } from "@cinatra-ai/sdk-extensions";

export const TWENTY_TO_GRAPHITI_SUPPORTED_TYPES = [
  "@cinatra-ai/entity-accounts:account",
  "@cinatra-ai/entity-contacts:contact",
] as const;

type AccountOrContact = (typeof TWENTY_TO_GRAPHITI_SUPPORTED_TYPES)[number];

function isSupportedType(t: string): t is AccountOrContact {
  return (TWENTY_TO_GRAPHITI_SUPPORTED_TYPES as readonly string[]).includes(t);
}

/**
 * Compose a human-readable episode body from a hydrated CRM record. Used as
 * the Graphiti `episode_body` (JSON-encoded), so the LLM-driven entity-graph
 * extraction can pull meaningful semantic content out.
 *
 * Marker emission MUST match the generic projector
 * (packages/objects/src/graphiti-projector.ts):
 *   - `cinatra_object_id` top-level: most reliable probe, drives Graphiti
 *     0.28.2's "bare-UUID Object node" extraction (handlers.ts:198 probe #4).
 *   - `_cinatra: { objectId, version, type, runId, agentId }`: nested fallback
 *     probe (handlers.ts:198 probe #2 via `node.cinatra_object_id`).
 *   - `[oid:<id>]` tag in episode name: future-proof tag if Graphiti propagates
 *     name verbatim (handlers.ts:198 probe #3 OID_RE).
 * Without these markers, semantic search hits on CRM episodes cannot be
 * hydrated back to the canonical `cinatra.objects` row and CRM data becomes
 * invisible to object-grounded LLM workflows.
 */
function composeEpisodeBody(
  type: AccountOrContact,
  object: StoredObject,
  hydrated: Record<string, unknown>,
): { name: string; body: string } {
  // Adapter envelope omits `version` (the generic projector emits it from
  // `row.version`, but the adapter receives the lighter StoredObject shape
  // which has no version field). The recovery chain only needs `objectId`
  // (handlers.ts:198 extractObjectIds) — `version` is provenance, not a
  // recovery key — so the absence is harmless for back-mapping.
  const cinatraEnvelope = {
    cinatra_object_id: object.id,
    _cinatra: {
      objectId: object.id,
      type: object.type,
      runId: object.runId,
      agentId: object.agentId,
    },
  };
  if (type === "@cinatra-ai/entity-accounts:account") {
    const displayName =
      typeof hydrated.name === "string" && hydrated.name ? hydrated.name : "(unnamed account)";
    return {
      name: `${displayName} [oid:${object.id}]`,
      body: JSON.stringify({
        kind: "crm_account",
        name: displayName,
        domain: hydrated.domainName ?? null,
        inLists: hydrated.inLists ?? [],
        apolloOrganizationId: hydrated.apolloOrganizationId ?? null,
        ...cinatraEnvelope,
      }),
    };
  }
  // contact
  const displayName =
    typeof hydrated.name === "string" && hydrated.name ? hydrated.name : "(unnamed contact)";
  return {
    name: `${displayName} [oid:${object.id}]`,
    body: JSON.stringify({
      kind: "crm_contact",
      name: displayName,
      email: hydrated.email ?? null,
      title: hydrated.title ?? null,
      accountId: hydrated.accountId ?? null,
      linkedinUrl: hydrated.linkedinUrl ?? null,
      inLists: hydrated.inLists ?? [],
      apolloPersonId: hydrated.apolloPersonId ?? null,
      ...cinatraEnvelope,
    }),
  };
}

/** The injected dependencies of a Twenty→Graphiti adapter instance. */
export type TwentyToGraphitiAdapterDeps = {
  /** Project the composed episode (the host objects provider's method). */
  addGraphitiEpisodeForObject: ObjectsProvider["addGraphitiEpisodeForObject"];
  /** Hydrate the full account record from Twenty (null = record gone). */
  getAccount(id: string): Promise<unknown | null>;
  /** Hydrate the full contact record from Twenty (null = record gone). */
  getContact(id: string): Promise<unknown | null>;
};

/**
 * Build the Twenty→Graphiti sync adapter from injected dependencies. The two
 * build sites (SDK-slot path; serverEntry capability path) produce adapters
 * with the SAME id, and every registry involved is replace-by-id — so double
 * registration is a no-op override, never a duplicate.
 */
export function makeTwentyToGraphitiAdapter(
  deps: TwentyToGraphitiAdapterDeps,
): ObjectSyncAdapter<Record<string, never>> {
  return {
    id: "twenty-to-graphiti",
    targetSystem: "graphiti",
    displayName: "Twenty CRM → Graphiti",
    supportedTypes: [...TWENTY_TO_GRAPHITI_SUPPORTED_TYPES],
    configSchema: z.object({}),

    async export(object: StoredObject): Promise<{ ok: boolean; externalId?: string; error?: string }> {
      if (!isSupportedType(object.type)) {
        // Defensive — the projector should only route supported types here;
        // returning ok keeps the outbox terminal for an accidental route.
        return { ok: true };
      }
      // The Twenty id lives on the pointer row's data as `external_id`. Without
      // it the adapter has nothing to hydrate from, so we return ok (terminal)
      // rather than retry forever.
      const externalId =
        typeof object.data.external_id === "string" && object.data.external_id.trim()
          ? object.data.external_id.trim()
          : null;
      if (!externalId) {
        return { ok: true, error: "pointer row has no external_id; skipping projection" };
      }

      try {
        // Hydrate the full record from Twenty via the injected reader.
        const hydrated =
          object.type === "@cinatra-ai/entity-accounts:account"
            ? await deps.getAccount(externalId)
            : await deps.getContact(externalId);

        // Record gone from Twenty (deleted via Twenty UI) — terminal no-op.
        // The next reconcile pass can prune the dangling pointer if needed.
        if (!hydrated) {
          return { ok: true, error: "Twenty record no longer exists; skipping projection" };
        }

        const { name, body } = composeEpisodeBody(
          object.type,
          object,
          hydrated as unknown as Record<string, unknown>,
        );

        // Project the episode via the injected objects surface. The host derives
        // the deterministic org group-id + a stable episode UUID and creates the
        // episode WITHOUT a `uuid` param — Graphiti 0.28.2 interprets `uuid` on
        // add_memory as "re-process an existing node" and fails MATCH-by-uuid for
        // new episodes (EPISODE-UUID-EMPTY, see graphiti-projector.ts). The returned
        // UUID is the adapter's externalId — the projector calls markProjected with
        // it for Postgres bookkeeping + future delete attempts.
        const { episodeUuid } = await deps.addGraphitiEpisodeForObject({
          objectId: object.id,
          orgId: object.orgId,
          name,
          episodeBody: body,
          sourceDescription: `cinatra ${object.type}`,
          referenceTime: object.createdAt,
        });

        return { ok: true, externalId: episodeUuid };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
