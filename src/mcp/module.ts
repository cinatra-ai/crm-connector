import "server-only";

// crm-connector MCP module. Registers the 15 cinatra-facade
// `crm_*` primitives with the cinatra MCP server. The facade resolves the
// provider, and the actual provider impls are supplied by provider extensions.

import { crmFacade } from "../facade";
import type { CrmAccount, CrmContact } from "../contract";
import { registerCrmObjectTypes } from "../integration/register-object-types";
import {
  buildPointerActorFromIds,
  writeCrmPointerWith,
} from "../integration/pointer-writer-core";
import { registerCrmObjectSyncAdapters } from "../sync-adapters/twenty-to-graphiti-adapter";

import type { ExtensionMcpToolServer } from "@cinatra-ai/sdk-extensions";
import { requireCrmRequestActorResolver, requireObjectsProvider } from "@cinatra-ai/sdk-extensions";
import { getCrmDeps } from "../deps";
import { z } from "zod";

// FROZEN queue-name contract (cinatra#172 Stage H1). The repair enqueue goes
// through the host `jobs` port (`getCrmDeps().enqueueJob`, bound from
// `ctx.jobs.enqueue` by register(ctx)) instead of a `@/lib/background-jobs`
// value import. The job NAME is a stable serialization id owned by the host's
// `BACKGROUND_JOB_NAMES.TWENTY_POINTER_REPAIR` ("twenty-pointer-repair") —
// the host's static worker dispatcher remains the single authority (an
// unrecognised name is rejected at dispatch, not at enqueue). Declared ONCE
// here (never scattered literals); changing it is a cross-repo contract
// break, same discipline as the gmail connector's "email-system-development"
// config key.
const TWENTY_POINTER_REPAIR_JOB = "twenty-pointer-repair";

// D8 — pointer-write-back. After every crm_account/contact create+update the
// handlers persist a minimal pointer row in cinatra.objects via the in-process
// `objects_save` handler. The outbox enqueue (atomic with the upsert) feeds
// the Graphiti projector, which routes the adapter-owned CRM types through
// `TwentyToGraphitiAdapter.export()` (in sync-adapters/twenty-to-graphiti-
// adapter.ts) — hydrating the full record from Twenty before composing the
// Graphiti episode. The crm-connector facade has no actor context of its own,
// so the actor is built from the host-bound CRM request-actor resolver
// (`requireCrmRequestActorResolver().getActor()`, the SDK DI slot the host wires
// to the MCP request store) — obtaining orgId/userId/platformRole from the same
// AsyncLocalStorage frame the MCP transport populates, without importing
// @cinatra-ai/mcp-server by name (SDK-only decouple).
//
// Source is stamped `"agent"` so the projector's source-gate (project only
// rows whose source is `agent` or `ui`) lets them through. Pointer-write
// failures enqueue a TWENTY_POINTER_REPAIR BullMQ job (5 attempts,
// exponential backoff) — see `enqueuePointerRepairOrLog` below for the full
// failure-policy rationale. The parent crm_*_create/update returns success
// because Twenty has already accepted the write; the BullMQ worker heals the
// pointer chain out of band.

function buildPointerActor(): Record<string, unknown> {
  const requestCtx = requireCrmRequestActorResolver().getActor();
  const orgId = requestCtx?.orgId ?? null;
  const userId = requestCtx?.userId ?? null;
  const platformRole = requestCtx?.platformRole;
  const actor: Record<string, unknown> = {
    actorType: platformRole ? "human" : "model",
    source: "agent",
    // Stamp `roles: ["member"]` so a userless model caller (ServiceAccount
    // classification) gets enough authority to pass `objects_save`'s
    // `object.create` gate. Without this, every userless pointer write
    // fails authz deterministically; with `member`, the synthetic actor
    // is bounded to the orgId scope captured here, which is the same scope
    // the parent crm_*_create/update gate already validated. See
    // buildPointerActorFromIds for the full rationale.
    roles: ["member"],
  };
  if (userId) actor.userId = userId;
  if (orgId) {
    actor.orgId = orgId;
    actor.organizationId = orgId;
  }
  if (platformRole) actor.platformRole = platformRole;
  return actor;
}

// `buildPointerActorFromIds` moved to ../integration/pointer-writer-core (a
// dependency-light leaf shared with the serverEntry activation path).

/**
 * D8 — write a single CRM pointer row by discriminator. Idempotent on the
 * Twenty external_id via the object-type's identityKey (the pointer rows'
 * identity post-cutover is `external_id`, see register-object-types.ts). The
 * worker handler in src/lib/background-jobs.ts (case TWENTY_POINTER_REPAIR)
 * calls this with `{ ..., orgId, userId }` so the actor can be reconstructed
 * outside the MCP ALS frame; inline callers omit the actor and fall back to
 * `buildPointerActor()` which reads via the host-bound CRM request-actor resolver.
 */
export async function writePointerByType(payload: {
  type: "account" | "contact";
  externalId: string;
  name: string;
  orgId?: string | null;
  userId?: string | null;
}): Promise<void> {
  // Pick the actor source explicitly. When orgId/userId are present
  // (BullMQ worker rehydration path), the synthetic builder is the
  // authoritative source — DON'T fall through to the request-actor resolver
  // because in the worker process getActor() returns null (no MCP request frame)
  // and orgId would be null even though the caller knew it at enqueue time.
  const explicitActor =
    payload.orgId !== undefined || payload.userId !== undefined
      ? buildPointerActorFromIds({
          orgId: payload.orgId ?? null,
          userId: payload.userId ?? null,
        })
      : null;
  // The actor-scoped objects_save pointer write via the host objects provider
  // (the SDK `requireObjectsProvider()` slot — the host binds the real
  // `createObjectsPrimitiveHandlers().objects_save`, preserving the ALS frame so
  // the inline request path resolves actor/run/projectContext; the worker path
  // passes an explicit actor with orgId/userId). The typeHint mapping +
  // register-types-before-write ordering live in the shared pointer-writer
  // core (also used by the serverEntry capability path).
  await writeCrmPointerWith(
    requireObjectsProvider(),
    payload,
    explicitActor ?? buildPointerActor(),
  );
}

/**
 * D8 — pointer-write failure policy:
 *
 * The historical "log + swallow" lost the create→pointer→Graphiti chain
 * forever on any transient failure (DB, authz, Redis); since CRM create-only
 * records have no natural retry trigger, the Twenty record became invisible
 * to cinatra-side searches and to Graphiti. The current policy:
 *
 *   1. Capture orgId+userId from the MCP request store BEFORE enqueueing —
 *      the BullMQ worker process has no MCP ALS frame and would otherwise
 *      rehydrate an actor without orgId, deterministically failing
 *      `objects_save`'s "actor.orgId is null" guard on every retry.
 *   2. Enqueue a durable TWENTY_POINTER_REPAIR job (5 attempts, exponential
 *      backoff) carrying { type, externalId, name, orgId, userId }.
 *   3. The BullMQ worker handler (src/lib/background-jobs.ts) calls
 *      `writePointerByType(payload)` which uses the supplied orgId/userId to
 *      rebuild a valid actor.
 *
 * Both-fail terminal branch (Postgres AND Redis unreachable at the same
 * moment):
 *   - Twenty already accepted the canonical write; we MUST not bounce a
 *     known-good mutation back to the caller, so the parent handler returns
 *     success with Twenty's externalId.
 *   - We emit a structured `[POINTER_REPAIR_FALLBACK]` stderr line carrying
 *     the full repair payload as JSON, so log-aggregator queries
 *     (`grep POINTER_REPAIR_FALLBACK` against captured stderr) recover every
 *     stranded pointer. This IS the durability backstop — in any production
 *     environment, stderr lines from a Node worker are persistent
 *     (container logs, journald, CloudWatch/Datadog, etc.) even when the
 *     local Postgres/Redis pair is degraded.
 */
async function enqueuePointerRepairOrLog(payload: {
  type: "account" | "contact";
  externalId: string;
  name: string;
  cause: unknown;
}): Promise<void> {
  const causeMessage =
    payload.cause instanceof Error ? payload.cause.message : String(payload.cause);
  // Capture the actor identity at the moment of failure — the inline writer
  // still has access to the MCP request store (via the host-bound resolver), but
  // the worker won't.
  const requestCtx = requireCrmRequestActorResolver().getActor();
  const orgId = requestCtx?.orgId ?? null;
  const userId = requestCtx?.userId ?? null;
  process.stderr.write(
    `[crm-connector] ${payload.type} pointer-write failed (external_id=${payload.externalId}, orgId=${orgId ?? "null"}): ${causeMessage}; enqueueing TWENTY_POINTER_REPAIR\n`,
  );
  try {
    await getCrmDeps().enqueueJob(
      TWENTY_POINTER_REPAIR_JOB,
      {
        type: payload.type,
        externalId: payload.externalId,
        name: payload.name,
        orgId,
        userId,
      },
      {
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
      },
    );
  } catch (enqueueErr) {
    const fallback = {
      kind: "POINTER_REPAIR_FALLBACK",
      timestamp: new Date().toISOString(),
      type: payload.type,
      externalId: payload.externalId,
      name: payload.name,
      orgId,
      userId,
      inlineCause: causeMessage,
      enqueueCause:
        enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
    };
    process.stderr.write(`[POINTER_REPAIR_FALLBACK] ${JSON.stringify(fallback)}\n`);
  }
}

// Exported for unit tests only (test/mocks the failure-enqueue path
// end-to-end). Not part of the public package API; importers outside the
// in-process MCP handler chain should call the `crm_*` MCP primitives.
export async function writeAccountPointer(account: CrmAccount): Promise<void> {
  try {
    await writePointerByType({
      type: "account",
      externalId: account.id,
      name: account.name,
    });
  } catch (err) {
    await enqueuePointerRepairOrLog({
      type: "account",
      externalId: account.id,
      name: account.name,
      cause: err,
    });
  }
}

// Exported for unit tests only — see writeAccountPointer note above.
export async function writeContactPointer(contact: CrmContact): Promise<void> {
  try {
    await writePointerByType({
      type: "contact",
      externalId: contact.id,
      name: contact.name,
    });
  } catch (err) {
    await enqueuePointerRepairOrLog({
      type: "contact",
      externalId: contact.id,
      name: contact.name,
      cause: err,
    });
  }
}

const ContactIdSchema = z.object({ id: z.string().min(1) });
const ContactCreateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  title: z.string().optional().nullable(),
  accountId: z.string().optional().nullable(),
  inLists: z.array(z.string()).optional(),
  apolloPersonId: z.string().optional().nullable(),
  enrichmentStatus: z.string().optional().nullable(),
  linkedinUrl: z.string().optional().nullable(),
  twitterHandle: z.string().optional().nullable(),
});
const ContactUpdateSchema = z.object({
  id: z.string().min(1),
  patch: ContactCreateSchema.partial(),
});
const SearchSchema = z.object({
  query: z.string(),
  limit: z.number().int().positive().max(100).optional(),
});
const FindByEmailSchema = z.object({ email: z.string().email() });

const AccountIdSchema = z.object({ id: z.string().min(1) });
const AccountCreateSchema = z.object({
  name: z.string().min(1),
  domainName: z.string().optional().nullable(),
  inLists: z.array(z.string()).optional(),
  apolloOrganizationId: z.string().optional().nullable(),
});
const AccountUpdateSchema = z.object({
  id: z.string().min(1),
  patch: AccountCreateSchema.partial(),
});

const ListIdSchema = z.object({ id: z.string().min(1) });
const ListCreateSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  objectType: z.enum(["contact", "account"]),
});
const ListSearchSchema = z.object({
  query: z.string(),
  objectType: z.enum(["contact", "account"]).optional(),
});
const ListMembersGetSchema = z.object({
  listId: z.string().min(1),
  limit: z.number().int().positive().max(500).optional(),
});
const ListMembershipSchema = z.object({
  listId: z.string().min(1),
  objectId: z.string().min(1),
  objectType: z.enum(["contact", "account"]),
});

function jsonResult<T>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value as unknown as Record<string, unknown>,
  };
}

export function registerCrmConnectorPrimitives(server: ExtensionMcpToolServer): void {
  // --------- Contacts (5 primitives) ---------
  server.registerTool(
    "crm_contact_search",
    {
      title: "crm_contact_search",
      description: "Search CRM contacts by free-text query. Provider-agnostic facade.",
      inputSchema: SearchSchema,
    },
    async (raw) => jsonResult(await crmFacade.contact.search(SearchSchema.parse(raw))),
  );
  server.registerTool(
    "crm_contact_get",
    {
      title: "crm_contact_get",
      description: "Get a CRM contact by id.",
      inputSchema: ContactIdSchema,
    },
    async (raw) => jsonResult(await crmFacade.contact.get(ContactIdSchema.parse(raw))),
  );
  server.registerTool(
    "crm_contact_create",
    {
      title: "crm_contact_create",
      description:
        "Create a CRM contact. Writes both the provider record and the cinatra.objects pointer row in one handler.",
      inputSchema: ContactCreateSchema,
    },
    async (raw) => {
      const result = await crmFacade.contact.create(ContactCreateSchema.parse(raw));
      await writeContactPointer(result);
      return jsonResult(result);
    },
  );
  server.registerTool(
    "crm_contact_update",
    {
      title: "crm_contact_update",
      description: "Update a CRM contact by id.",
      inputSchema: ContactUpdateSchema,
    },
    async (raw) => {
      const result = await crmFacade.contact.update(ContactUpdateSchema.parse(raw));
      await writeContactPointer(result);
      return jsonResult(result);
    },
  );
  server.registerTool(
    "crm_contact_find_by_email",
    {
      title: "crm_contact_find_by_email",
      description: "Find a CRM contact by email address.",
      inputSchema: FindByEmailSchema,
    },
    async (raw) => jsonResult(await crmFacade.contact.findByEmail(FindByEmailSchema.parse(raw))),
  );

  // --------- Accounts (4 primitives) ---------
  server.registerTool(
    "crm_account_search",
    {
      title: "crm_account_search",
      description: "Search CRM accounts by free-text query.",
      inputSchema: SearchSchema,
    },
    async (raw) => jsonResult(await crmFacade.account.search(SearchSchema.parse(raw))),
  );
  server.registerTool(
    "crm_account_get",
    {
      title: "crm_account_get",
      description: "Get a CRM account by id.",
      inputSchema: AccountIdSchema,
    },
    async (raw) => jsonResult(await crmFacade.account.get(AccountIdSchema.parse(raw))),
  );
  server.registerTool(
    "crm_account_create",
    {
      title: "crm_account_create",
      description: "Create a CRM account.",
      inputSchema: AccountCreateSchema,
    },
    async (raw) => {
      const result = await crmFacade.account.create(AccountCreateSchema.parse(raw));
      await writeAccountPointer(result);
      return jsonResult(result);
    },
  );
  server.registerTool(
    "crm_account_update",
    {
      title: "crm_account_update",
      description: "Update a CRM account by id.",
      inputSchema: AccountUpdateSchema,
    },
    async (raw) => {
      const result = await crmFacade.account.update(AccountUpdateSchema.parse(raw));
      await writeAccountPointer(result);
      return jsonResult(result);
    },
  );

  // --------- Lists (6 primitives) ---------
  server.registerTool(
    "crm_list_search",
    {
      title: "crm_list_search",
      description: "Search CRM lists (Twenty Views, HubSpot Lists, etc.). Provider-agnostic.",
      inputSchema: ListSearchSchema,
    },
    async (raw) => jsonResult(await crmFacade.list.search(ListSearchSchema.parse(raw))),
  );
  server.registerTool(
    "crm_list_get",
    {
      title: "crm_list_get",
      description: "Get a CRM list by id.",
      inputSchema: ListIdSchema,
    },
    async (raw) => jsonResult(await crmFacade.list.get(ListIdSchema.parse(raw))),
  );
  server.registerTool(
    "crm_list_create",
    {
      title: "crm_list_create",
      description: "Create a CRM list (Twenty View filtered on the inLists slug).",
      inputSchema: ListCreateSchema,
    },
    async (raw) => jsonResult(await crmFacade.list.create(ListCreateSchema.parse(raw))),
  );
  server.registerTool(
    "crm_list_members_get",
    {
      title: "crm_list_members_get",
      description: "List the contact + account ids belonging to a CRM list.",
      inputSchema: ListMembersGetSchema,
    },
    async (raw) => jsonResult(await crmFacade.list.membersGet(ListMembersGetSchema.parse(raw))),
  );
  server.registerTool(
    "crm_list_member_add",
    {
      title: "crm_list_member_add",
      description: "Add a contact or account to a CRM list (patches the member's inLists array).",
      inputSchema: ListMembershipSchema,
    },
    async (raw) => {
      await crmFacade.list.memberAdd(ListMembershipSchema.parse(raw));
      return jsonResult({ ok: true });
    },
  );
  server.registerTool(
    "crm_list_member_remove",
    {
      title: "crm_list_member_remove",
      description: "Remove a contact or account from a CRM list.",
      inputSchema: ListMembershipSchema,
    },
    async (raw) => {
      await crmFacade.list.memberRemove(ListMembershipSchema.parse(raw));
      return jsonResult({ ok: true });
    },
  );
}

// Factory matching the connector convention used by src/lib/mcp-server.ts.
// Registers the CRM object types (account / contact / list) AND the
// TwentyToGraphitiAdapter at construction. The MCP-server boot path runs this
// when building the modules list; the BullMQ worker also calls
// registerCrmObjectSyncAdapters() at its own boot so the projector (which the
// worker imports directly from @cinatra-ai/objects/graphiti-projector) can
// route adapter-owned CRM types to the adapter. Both registrations are
// idempotent (replace-by-id).
export function createCrmModule() {
  registerCrmObjectTypes();
  registerCrmObjectSyncAdapters();
  return {
    registerCapabilities: registerCrmConnectorPrimitives,
  };
}
