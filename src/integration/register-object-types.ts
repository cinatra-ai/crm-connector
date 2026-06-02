import "server-only";

// Register object types via the SDK's host-injected objects provider
// (`requireObjectsProvider()`) — the host binds it to the real `objectTypeRegistry`
// at boot (src/lib/register-objects-provider.ts), so this connector imports ONLY
// `@cinatra-ai/sdk-extensions`, never `@cinatra-ai/objects`.
// `ObjectTypeDefinition` is the SDK's parallel-copy contract; it is erased at
// runtime.
import { requireObjectsProvider, getObjectsProviderOrNull } from "@cinatra-ai/sdk-extensions";
import type { ObjectTypeDefinition } from "@cinatra-ai/sdk-extensions";
import { z } from "zod";

// CRM object-type registration for the provider-agnostic CRM facade.
//
// cinatra holds lightweight POINTER rows in `cinatra.objects` for the three
// CRM types (account / contact / list); Twenty CRM owns the canonical
// records and the editing UI (reached programmatically via the `crm_*` MCP
// facade — there is no cinatra-side browse). The substrate must still know
// each type's schema / identityKey / crudPolicy so it can classify the
// pointer rows the facade writes. This registration was previously split
// across the retired entity-accounts / entity-contacts / lists
// deprecation-stub packages; it now lives with the connector that owns the
// CRM surface.
//
// The type-ID strings MUST stay byte-identical: they are persisted in
// `cinatra.objects.type`, referenced by the cutover script's CRM_TYPE_IDS, the
// taxonomy, retention policy, audit gates, seeds, and tests.

// Browse/detail UI deeplinks to Twenty, so the per-row/card/detail renderer
// slots are never invoked. The registry requires the slots; they resolve to a
// null-rendering stub.
const RetiredCrmRenderer = () => null;

function registerAccountObjectType(): void {
  requireObjectsProvider().registerObjectType({
    type: "@cinatra-ai/entity-accounts:account",
    category: "profile",
    identityKey: (data) => {
      const d = data as Record<string, unknown>;
      // D8: pointer rows carry the Twenty id in `external_id` and that is
      // the only stable identity post-cutover. Name is a last-resort fallback
      // for the rare case a row reaches the substrate without external_id
      // (shouldn't happen via the crm_account_* handlers — the pointer write
      // always sets external_id from the Twenty record's id).
      const externalId =
        typeof d.external_id === "string" && d.external_id.trim() ? d.external_id.trim() : null;
      if (externalId) return externalId;
      return typeof d.name === "string" && d.name.trim() ? d.name.trim().toLowerCase() : null;
    },
    // Minimal pointer-row shape. cinatra holds only the bare identity +
    // discovery metadata; the canonical record lives in Twenty and the
    // crm_account_* facade reads heavy fields on demand. Legacy enrichment
    // fields (website, websiteHost, accountId, startupId, draftCount,
    // relatedContactCount) were dropped — they were specific to the retired
    // entity-accounts agent flow, no row in cinatra.objects carries them
    // after the cutover, and no live writer produces them.
    schema: z.object({
      // D8: `id` is the substrate row id (assigned by objects_save at write
      // time, NOT a domain field on the pointer). Pointer writes only carry
      // `{ type, external_id, name }`; legacy callers may still inline an
      // explicit id, so accept it as optional.
      id: z.string().optional(),
      name: z.string(),
      type: z.literal("account"),
      // Twenty CRM id — the substrate's identity key when present.
      external_id: z.string().optional(),
      // Optional discovery / enrichment hints that survive on the pointer.
      // Twenty-sourced writes (D8) leave these unset; the host-side
      // discovery agents may populate them before the Twenty round-trip.
      companyEmail: z.string().optional(),
      country: z.string().optional(),
      city: z.string().optional(),
      enrichmentStatus: z.string().optional(),
      agentCampaignName: z.string().optional(),
      agentCampaignPath: z.string().optional(),
      latestGithubStars: z.number().optional(),
      defaultProperties: z.record(z.string(), z.unknown()).optional(),
      customProperties: z.record(z.string(), z.unknown()).optional(),
    }),
    lifecycle: {
      sources: ["agent", "user", "import"],
      mutableBy: ["agent", "user"],
    },
    renderers: {
      listRow: RetiredCrmRenderer,
      card: RetiredCrmRenderer,
      detail: RetiredCrmRenderer,
    },
    // Accounts dedupe by `websiteHost` (see identityKey). Existing → UPDATE in
    // place; new → CREATE. `name` is required (without it the row is
    // unsurfaceable). `createdAt`/`id`/`startupId`/`accountId` are NEVER
    // overwritten.
    crudPolicy: {
      onMatch: "update",
      onNoMatch: "create",
      requiredFields: ["name"],
      preserveOnUpdate: ["id", "createdAt", "startupId", "accountId"],
      hitlConfidenceThreshold: 0.7,
    },
  });
}

function registerContactObjectType(): void {
  requireObjectsProvider().registerObjectType({
    type: "@cinatra-ai/entity-contacts:contact",
    category: "profile",
    identityKey: (data) => {
      const d = data as Record<string, unknown>;
      // D8: prefer the Twenty id (external_id) on cinatra pointer rows.
      // Fall back to the legacy email / linkedinUrl / apolloPersonId cascade
      // for non-Twenty-sourced rows.
      const externalId =
        typeof d.external_id === "string" && d.external_id.trim() ? d.external_id.trim() : null;
      if (externalId) return externalId;
      if (typeof d.email === "string" && d.email.trim()) {
        return d.email.trim().toLowerCase();
      }
      if (typeof d.linkedinUrl === "string" && d.linkedinUrl.trim()) {
        return d.linkedinUrl.trim().toLowerCase();
      }
      const externalIds = d.externalIds as Record<string, unknown> | undefined;
      if (
        externalIds &&
        typeof externalIds.apolloPersonId === "string" &&
        externalIds.apolloPersonId.trim()
      ) {
        return externalIds.apolloPersonId.trim().toLowerCase();
      }
      return null;
    },
    // Minimal pointer-row shape. cinatra holds only the bare identity +
    // discovery metadata; the canonical record lives in Twenty and the
    // crm_contact_* facade reads heavy fields on demand. Legacy fields
    // (accountId, startupId, draftCount) were dropped — they were specific
    // to the retired entity-contacts agent flow, no row in cinatra.objects
    // carries them after the cutover, and no live writer produces
    // them. The contact→account relation lives canonically in Twenty
    // (CrmContact.accountId is hydrated via crm_contact_get), so no
    // substrate-side `relations` declaration is needed on the pointer.
    schema: z.object({
      // D8: same rationale as account — substrate row id is assigned by
      // objects_save, not provided by the pointer writer. Accept optionally
      // for legacy callers that inline an explicit id.
      id: z.string().optional(),
      name: z.string(),
      type: z.literal("contact"),
      // Twenty CRM id — the substrate's identity key when present.
      external_id: z.string().optional(),
      // Optional discovery / enrichment hints that survive on the pointer.
      title: z.string().optional(),
      email: z.string().optional(),
      linkedinUrl: z.string().optional(),
      twitterUrl: z.string().optional(),
      githubUrl: z.string().optional(),
      facebookUrl: z.string().optional(),
      accountName: z.string().optional(),
      accountPath: z.string().optional(),
      agentCampaignName: z.string().optional(),
      agentCampaignPath: z.string().optional(),
      isManual: z.boolean().optional(),
      defaultProperties: z.record(z.string(), z.unknown()).optional(),
      customProperties: z.record(z.string(), z.unknown()).optional(),
      externalIds: z.record(z.string(), z.string()).optional(),
      ownerUserId: z.string().optional(),
      teamId: z.string().optional(),
    }),
    lifecycle: {
      sources: ["agent", "user", "import"],
      mutableBy: ["agent", "user"],
    },
    renderers: {
      listRow: RetiredCrmRenderer,
      card: RetiredCrmRenderer,
      detail: RetiredCrmRenderer,
    },
    // Contacts dedupe by `email | linkedinUrl | apolloPersonId`. Existing match
    // → MERGE (contacts accumulate detail across enrichment passes; a naive
    // UPDATE would lose prior signals). `email` is the minimum viable identity.
    // `createdAt`/`startupId`/`accountId` are NEVER overwritten.
    crudPolicy: {
      onMatch: "merge",
      onNoMatch: "create",
      mergeableFields: ["customProperties", "externalIds", "defaultProperties"],
      requiredFields: ["email"],
      preserveOnUpdate: ["id", "createdAt", "startupId", "accountId"],
    },
  });
}

// Member-ref schemas for the list object type (inlined from the retired lists
// package's mcp/schemas.ts so the type registration carries no dependency on
// the deleted package).
const memberRefSchema = z.object({
  objectType: z.enum([
    "@cinatra-ai/entity-accounts:account",
    "@cinatra-ai/entity-contacts:contact",
  ]),
  objectId: z.string().min(1),
});
const memberTypeSchema = z.enum(["account", "contact", "mixed"]);

const StubRenderer = () => null;

function registerListObjectType(): void {
  requireObjectsProvider().registerObjectType({
    type: "@cinatra-ai/lists:list",
    category: "project",
    // No identity key: lists are operator-curated containers; two operators
    // creating "Q4 prospects" in the same org should each get distinct rows.
    // The objects layer falls back to UUID identity when this returns null.
    identityKey: () => null,
    schema: z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      description: z.string().optional(),
      memberType: memberTypeSchema,
      membership: z.object({
        kind: z.literal("static"),
        memberRefs: z.array(memberRefSchema),
      }),
      sourceAgentRuns: z.array(z.string()).optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
      ownerUserId: z.string().optional(),
      teamId: z.string().optional(),
      orgId: z.string().optional(),
    }) as unknown as ObjectTypeDefinition["schema"],
    lifecycle: {
      sources: ["agent", "user", "import"],
      mutableBy: ["agent", "user"],
    },
    renderers: {
      listRow: StubRenderer,
      card: StubRenderer,
      detail: StubRenderer,
    },
  });
}

/**
 * Register all three CRM object types (account / contact / list) so the
 * substrate can classify the pointer rows the CRM facade writes. Idempotent —
 * the host objects provider's `registerObjectType` is replace-by-id, so calling
 * this more than once (boot module + host registry warmer) is safe.
 */
export function registerCrmObjectTypes(): void {
  // The host objects provider isn't wired during `next build` page-data collection
  // (the binder runs from instrumentation, which doesn't execute at build) — skip;
  // the build-process registry is discarded anyway. At runtime boot + worker boot
  // the provider IS bound (Next.js runs instrumentation.register() before any route
  // handler / worker), so this registers the types where it matters.
  if (!getObjectsProviderOrNull()) return;
  registerAccountObjectType();
  registerContactObjectType();
  registerListObjectType();
}
