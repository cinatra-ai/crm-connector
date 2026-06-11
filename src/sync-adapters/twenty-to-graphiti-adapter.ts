import "server-only";

import { requireObjectsProvider, getObjectsProviderOrNull } from "@cinatra-ai/sdk-extensions";
import type { ObjectSyncAdapter } from "@cinatra-ai/sdk-extensions";
import { crmFacade } from "../facade";
import { makeTwentyToGraphitiAdapter } from "./twenty-to-graphiti-core";

// D8 — TwentyToGraphitiAdapter
//
// Projects cinatra-side CRM pointer rows (account/contact) into Graphiti as
// append-only episodes. The pointer row in `cinatra.objects` carries only
// minimal metadata; the adapter hydrates the full record from Twenty via the
// provider-agnostic `crm_*` facade before composing the Graphiti episode, so
// Graphiti receives semantically meaningful content (name, email, domain,
// title, account relation, etc.) rather than just an opaque id+name.
//
// The composition logic + adapter factory live in the dependency-light leaf
// `./twenty-to-graphiti-core.ts` (shared with the serverEntry activation
// path, which builds the same adapter from the host-provided objects/lookup
// surfaces). THIS module is the SDK-slot build site: it injects the
// `requireObjectsProvider()` projection method and the `crmFacade` hydration
// readers.
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
// Registration: `registerCrmObjectSyncAdapters()` (below) is called from
// `createCrmModule()` (MCP-server boot via mcp-server.ts); the serverEntry
// activation path registers the equivalent adapter at activation, and the
// host's graphiti-projection-repair cycle re-ensures registration through the
// `crm-sync-bootstrap` capability. Every path is replace-by-id idempotent.

export const twentyToGraphitiAdapter: ObjectSyncAdapter<Record<string, never>> =
  makeTwentyToGraphitiAdapter({
    addGraphitiEpisodeForObject: (input) =>
      requireObjectsProvider().addGraphitiEpisodeForObject(input),
    getAccount: (id) => crmFacade.account.get({ id }),
    getContact: (id) => crmFacade.contact.get({ id }),
  });

/**
 * Idempotent registration of the Twenty→Graphiti sync adapter into the
 * shared in-process object-sync-adapter registry. Safe to call from the
 * MCP-server boot path (`createCrmModule()`) and any re-ensure caller — the
 * registry's `register()` is replace-by-id, so the second caller is a no-op.
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
  // The provider's `registerSyncAdapter` is replace-by-id, so every caller
  // after the first is a no-op override of the same id.
  requireObjectsProvider().registerSyncAdapter(twentyToGraphitiAdapter);
}
