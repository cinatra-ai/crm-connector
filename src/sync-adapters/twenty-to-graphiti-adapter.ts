import "server-only";

import { z } from "zod";
import { requireObjectsProvider, getObjectsProviderOrNull } from "@cinatra-ai/sdk-extensions";
import type { ObjectSyncAdapter, StoredObject } from "@cinatra-ai/sdk-extensions";
import { crmFacade } from "../facade";

// D8 — TwentyToGraphitiAdapter
//
// Projects cinatra-side CRM pointer rows (account/contact) into Graphiti as
// append-only episodes. The pointer row in `cinatra.objects` carries only
// minimal metadata; the adapter hydrates the full record from Twenty via the
// provider-agnostic `crm_*` facade before composing the Graphiti episode, so
// Graphiti receives semantically meaningful content (name, email, domain,
// title, account relation, etc.) rather than just an opaque id+name.
//
// Wiring:
//   * Pointer rows are written by the crm_*_create/update MCP handlers in
//     `extensions/cinatra-ai/crm-connector/src/mcp/module.ts`. The write
//     enqueues a row to `graphiti_projection_outbox` via the standard
//     `upsertObjectAndEnqueue` path inside `objects_save`.
//   * The projector (`packages/objects/src/graphiti-projector.ts`) reads the
//     outbox, sees an adapter-owned type, and routes the row HERE instead of
//     the generic projection. We reuse the projector's durable retry/outbox
//     bookkeeping rather than dispatching at save time (no double-project).
//   * Source-gate: the projector only invokes the adapter for rows with
//     `source ∈ {agent, ui}` (cinatra-originated); Twenty-pulled reads are
//     not projected here (D8 doctrine: Graphiti indexes data ORIGINATED in
//     cinatra, not data pulled from external systems).
//
// Registration: `registerCrmObjectSyncAdapters()` (this module's sibling) is
// called from BOTH `createCrmModule()` (MCP-server boot via mcp-server.ts)
// and the BullMQ worker boot (`src/lib/background-jobs.ts`) — the worker
// imports `graphiti-projector` directly and needs the adapter registry
// populated before `processProjectionOutbox()` runs.

const SUPPORTED_TYPES = [
  "@cinatra-ai/entity-accounts:account",
  "@cinatra-ai/entity-contacts:contact",
] as const;

type AccountOrContact = (typeof SUPPORTED_TYPES)[number];

function isSupportedType(t: string): t is AccountOrContact {
  return (SUPPORTED_TYPES as readonly string[]).includes(t);
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

export const twentyToGraphitiAdapter: ObjectSyncAdapter<Record<string, never>> = {
  id: "twenty-to-graphiti",
  targetSystem: "graphiti",
  displayName: "Twenty CRM → Graphiti",
  supportedTypes: [...SUPPORTED_TYPES],
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
      // Hydrate the full record from Twenty via the provider-agnostic facade.
      const hydrated =
        object.type === "@cinatra-ai/entity-accounts:account"
          ? await crmFacade.account.get({ id: externalId })
          : await crmFacade.contact.get({ id: externalId });

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

      // Project the episode via the host objects provider (the SDK DI slot the
      // host binds to the graphiti client at boot). The host derives the
      // deterministic org group-id + a stable episode UUID and creates the
      // episode WITHOUT a `uuid` param — Graphiti 0.28.2 interprets `uuid` on
      // add_memory as "re-process an existing node" and fails MATCH-by-uuid for
      // new episodes (EPISODE-UUID-EMPTY, see graphiti-projector.ts). The returned
      // UUID is the adapter's externalId — the projector calls markProjected with
      // it for Postgres bookkeeping + future delete attempts.
      const { episodeUuid } = await requireObjectsProvider().addGraphitiEpisodeForObject({
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

/**
 * Idempotent registration of the Twenty→Graphiti sync adapter into the
 * shared in-process object-sync-adapter registry. Safe to call from both
 * the MCP-server boot path (`createCrmModule()`) and the BullMQ worker boot
 * (`src/lib/background-jobs.ts`) — the registry's `register()` is
 * replace-by-id, so the second caller is a no-op.
 *
 * Registers via the host objects provider (the SDK `requireObjectsProvider()`
 * slot the host binds to `objectSyncAdapterRegistry` at boot). Kept as a
 * dedicated function (not a top-level side-effect) so callers can sequence
 * registration deterministically relative to other boot steps (e.g. CRM provider
 * registration must precede any projection that hydrates via the facade).
 */
export function registerCrmObjectSyncAdapters(): void {
  // Skip when the host objects provider isn't wired (e.g. `next build` page-data
  // collection — the binder runs from instrumentation, absent at build); the
  // registry is discarded there. At runtime boot + worker boot it IS bound.
  if (!getObjectsProviderOrNull()) return;
  // The provider's `registerSyncAdapter` is replace-by-id, so calling this from
  // both the MCP-server boot path (createCrmModule) and the BullMQ worker boot
  // (src/lib/background-jobs.ts) is safe — the second caller is a no-op
  // override of the same id.
  requireObjectsProvider().registerSyncAdapter(twentyToGraphitiAdapter);
}
