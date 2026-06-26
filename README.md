# CRM Connector

Provider-agnostic CRM facade for Cinatra. Exposes 15 `crm_*` MCP tools (contacts, accounts, lists) that route to the registered CRM provider, so agents write CRM-agnostic code regardless of which CRM backend is installed.

**Purpose.** Agents call `crm_contact_*`, `crm_account_*`, and `crm_list_*` without coupling to a specific CRM. The connector normalises provider shapes into Cinatra's shared types and keeps `cinatra.objects` pointer rows in sync after each write.

**Install.** Add this connector via the marketplace. A CRM provider extension (such as Twenty CRM) must also be installed; without one, the connector returns a descriptive error on first call. No connector-level configuration is required — CRM credentials are managed by the provider extension.

**Usage.** The 15 `crm_*` tools include `crm_contact_search { query }`, `crm_contact_create { name, email?, title?, accountId? }`, `crm_account_search { query }`, and `crm_list_search { query, objectType? }`. Create and update calls write both the provider record and a `cinatra.objects` pointer row; failures are retried via a durable background job (up to 5 attempts, exponential backoff).

**API contract.** Contacts: `id, name, email, title, accountId`. Accounts: `id, name, domainName`. Lists: `id, slug, name, objectType` (`contact` | `account`). Shapes live in `@cinatra-ai/sdk-extensions`.

**Development.** Run `pnpm install && pnpm test`. Run `node extension-kind-gate.mjs` to validate before a pull request. Source is in `src/`; server entry is `src/register.ts`.

**Troubleshooting.** "No CRM provider registered" — activate a provider extension on the instance. Pointer-repair failures log to stderr as `[POINTER_REPAIR_FALLBACK]` JSON for manual replay.

## Works with

- Twenty CRM connector (`@cinatra-ai/twenty-connector`) — the only provider currently supported

## Capabilities

- Provider-agnostic verbs — agents call `crm_contact_*` / `crm_account_*` / `crm_list_*` regardless of CRM backend
- Pointer-row coupling — writes update `cinatra.objects` pointer and the CRM provider in one handler
- Cinatra-shaped types — provider shapes collapse to Cinatra's shared `contact` / `account` / `list` types at the facade
- Durable pointer repair — failed pointer writes retried via BullMQ with exponential backoff and a structured stderr fallback
- Provider-swap ready — the facade indirection allows adding new CRM providers without changing the agent call-sites
