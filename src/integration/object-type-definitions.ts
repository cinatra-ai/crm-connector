// CRM object-type DEFINITIONS — a dependency-light LEAF module (zod + the
// SDK's erased types only; NO SDK value imports). Kept leaf so the connector's
// `serverEntry` graph (src/register.ts) can register these definitions through
// the host-provided objects surface WITHOUT value-importing a host peer (the
// host-peer-value-import ban): `register(ctx)` takes the objects provider via
// the capability registry; `integration/register-object-types.ts` keeps the
// SDK-slot path for the MCP-module/boot callers.
//
// The type-ID strings MUST stay byte-identical: they are persisted in
// `cinatra.objects.type`, referenced by the cutover script's CRM_TYPE_IDS, the
// taxonomy, retention policy, audit gates, seeds, and tests.

import { z } from "zod";
import type { ObjectTypeDefinition } from "@cinatra-ai/sdk-extensions";

// Browse/detail UI deeplinks to Twenty, so the per-row/card/detail renderer
// slots are never invoked. The registry requires the slots; they resolve to a
// null-rendering stub.
const RetiredCrmRenderer = () => null;
const StubRenderer = () => null;

const accountObjectType: ObjectTypeDefinition = {
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
};

const contactObjectType: ObjectTypeDefinition = {
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
};

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

const listObjectType: ObjectTypeDefinition = {
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
};

/**
 * All three CRM object-type definitions (account / contact / list), in
 * registration order. Registration is replace-by-id wherever they are
 * registered, so both registration paths (serverEntry activation via the
 * host-provided objects surface; SDK-slot path via registerCrmObjectTypes)
 * may run in any order.
 */
export const CRM_OBJECT_TYPE_DEFINITIONS: ObjectTypeDefinition[] = [
  accountObjectType,
  contactObjectType,
  listObjectType,
];
