# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**CRM Provider — Twenty CRM:**
- Twenty CRM is the only registered CRM provider at present
- The connector is provider-agnostic by design; Twenty is resolved via `resolveProvider()` in `src/facade.ts` which iterates `["twenty"]` and calls `lookupCrmProvider("twenty")`
- Provider registration is performed at host boot by `registerTwentyProvider()` (supplied by `@cinatra-ai/twenty-connector`, a separate package)
- The connector itself never imports `@cinatra-ai/twenty-connector` directly — the facade calls only the abstract `CrmConnector` interface methods: `searchContacts`, `getContact`, `createContact`, `updateContact`, `findContactByEmail`, `searchAccounts`, `getAccount`, `createAccount`, `updateAccount`, `searchLists`, `getList`, `createList`, `getListMembers`, `addListMember`, `removeListMember`
- SDK/Client: `@cinatra-ai/sdk-extensions` — `CrmConnector` interface and `registerCrmProvider` / `lookupCrmProvider` registry
- Auth: Not configured in this package; credentials are held by `@cinatra-ai/twenty-connector` and passed through its provider registration

**Graph Memory — Graphiti:**
- CRM pointer rows are projected into Graphiti as episodes via the `TwentyToGraphitiAdapter` in `src/sync-adapters/twenty-to-graphiti-adapter.ts`
- The adapter calls `requireObjectsProvider().addGraphitiEpisodeForObject(...)` — the host binds this to the real Graphiti client; the connector imports only the SDK slot
- Episode bodies carry cinatra object markers (`cinatra_object_id`, `_cinatra` envelope, `[oid:<id>]` name tag) for back-mapping semantic search hits to `cinatra.objects` rows

**Apollo (enrichment metadata, indirect):**
- Not called directly. Contact and account pointer rows carry `apolloPersonId` and `apolloOrganizationId` fields (defined in schemas in `src/integration/register-object-types.ts`) stamped by upstream enrichment agents. This connector reads and passes those fields through but does not call the Apollo API.

## Data Storage

**Databases:**
- `cinatra.objects` — the host's Postgres table for CRM pointer rows. This connector writes to it via `requireObjectsProvider().saveObject(...)` (the SDK DI slot). The connector never opens a direct DB connection.
- Connection: managed by host; not configured in this package
- Client: `requireObjectsProvider()` (SDK-injected abstraction over the host's objects layer)

**File Storage:**
- Not applicable

**Caching:**
- Not applicable directly. Batch deduplication of `get` calls within one request is described in the README as a capability but is implemented by the provider (e.g., Twenty connector), not by this package.

## Authentication & Identity

**Auth Provider:**
- No direct auth provider. Actor identity (orgId, userId, platformRole) is resolved at MCP request time via `requireCrmRequestActorResolver().getActor()` (SDK DI slot bound by the host to its MCP request store / AsyncLocalStorage frame) — see `src/mcp/module.ts` `buildPointerActor()`
- For BullMQ worker paths, actor is reconstructed from `orgId`/`userId` captured at enqueue time via `buildPointerActorFromIds()` in `src/mcp/module.ts`

## Monitoring & Observability

**Error Tracking:**
- Not detected (no Sentry, Datadog, or similar SDK imports)

**Logs:**
- Structured stderr logging for pointer-write failures: `process.stderr.write(...)` in `src/mcp/module.ts`
- Terminal fallback log line tagged `[POINTER_REPAIR_FALLBACK]` with full JSON payload (type, externalId, name, orgId, userId, cause) emitted when both Postgres and Redis are unreachable at the same time

## CI/CD & Deployment

**Hosting:**
- Published as an npm package (`@cinatra-ai/crm-connector`); consumed by a cinatra host application
- `.github/` directory present — CI configuration not read (outside scope)

**CI Pipeline:**
- `.github/` directory present; contents not inspected

## Environment Configuration

**Required env vars:**
- None configured in this package directly. All runtime configuration is injected by the host via DI slot binding (`requireObjectsProvider`, `requireCrmRequestActorResolver`) before any MCP or worker operation

**Secrets location:**
- `.npmrc` file present (note existence only — not read); may contain npm registry auth token

## Webhooks & Callbacks

**Incoming:**
- Not applicable. The connector registers 15 MCP tool primitives (`crm_contact_*`, `crm_account_*`, `crm_list_*`) via `registerCrmConnectorPrimitives(server)` in `src/mcp/module.ts`, consumed by the cinatra MCP server — not HTTP webhooks

**Outgoing:**
- Not applicable. Writes to Twenty CRM are performed by the provider implementation (`@cinatra-ai/twenty-connector`), not this connector

## Background Job Queue

**Queue System — BullMQ (via host):**
- The connector enqueues `TWENTY_POINTER_REPAIR` jobs via `enqueueBackgroundJob(BACKGROUND_JOB_NAMES.TWENTY_POINTER_REPAIR, payload, { attempts: 5, backoff: { type: "exponential", delay: 30_000 } })` imported from `@/lib/background-jobs` (host alias)
- This is invoked from `enqueuePointerRepairOrLog()` in `src/mcp/module.ts` when an inline pointer write to `cinatra.objects` fails
- The BullMQ worker (host-side) calls back into `writePointerByType()` exported from `src/index.ts` to retry the pointer write with a reconstructed actor

---

*Integration audit: 2026-06-09*
