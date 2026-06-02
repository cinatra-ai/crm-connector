# @cinatra-ai/crm-connector

Provider-agnostic CRM facade for cinatra. Exposes 15 `crm_*` MCP primitives (contacts/accounts/lists) that resolve to whichever CRM provider is registered for an instance.

## Works with

- `@cinatra-ai/twenty-connector` (the only provider currently)

## Capabilities

- ✓ Provider-agnostic verbs — agents call `crm_contact_*` / `crm_account_*` / `crm_list_*` regardless of CRM
- ✓ Pointer-row coupling — writes update `cinatra.objects` pointer + the CRM in one handler
- ✓ Batch hydration — `get` calls within one request dedup at the wire
- ✓ cinatra-shaped types — provider-specific shapes (Twenty's `Person`, HubSpot's `Contact`) collapse to cinatra's `contact` shape at the facade
