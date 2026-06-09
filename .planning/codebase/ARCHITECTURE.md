<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│              MCP Server / BullMQ Worker (host app)               │
│  calls registerCrmConnectorPrimitives(server) at boot            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ crm_* MCP tool calls
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   MCP Module Layer                               │
│  `src/mcp/module.ts`  — 15 crm_* primitives (zod-validated)     │
│  writeContactPointer / writeAccountPointer — pointer write-back  │
└──────────┬────────────────────────────────────────┬─────────────┘
           │ delegates CRUD                         │ on create/update
           ▼                                        ▼
┌────────────────────────┐          ┌───────────────────────────────┐
│   Facade Layer         │          │  Pointer Write-back           │
│  `src/facade.ts`       │          │  writePointerByType()         │
│  crmFacade.contact.*   │          │  → requireObjectsProvider()   │
│  crmFacade.account.*   │          │    .saveObject(...)           │
│  crmFacade.list.*      │          │  on failure → BullMQ repair   │
└──────────┬─────────────┘          └───────────────────────────────┘
           │ lookupCrmProvider()
           ▼
┌─────────────────────────────────────────────────────────────────┐
│              Provider Registry (SDK-anchored)                    │
│  `src/registry.ts` re-exports from @cinatra-ai/sdk-extensions   │
│  globalThis Symbol — shared between connector + provider exts   │
└──────────┬──────────────────────────────────────────────────────┘
           │ CrmConnector interface
           ▼
┌─────────────────────────────────────────────────────────────────┐
│            CRM Provider (e.g. twenty-connector)                  │
│  Registered externally; not in this repo                        │
└─────────────────────────────────────────────────────────────────┘

Async write-back / Graphiti projection pipeline:
  objects_save (host) → graphiti_projection_outbox
    → processProjectionOutbox (BullMQ worker)
      → TwentyToGraphitiAdapter.export() [`src/sync-adapters/twenty-to-graphiti-adapter.ts`]
        → crmFacade.account/contact.get() to hydrate full record
          → requireObjectsProvider().addGraphitiEpisodeForObject()
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Public API | Re-exports all public types and functions | `src/index.ts` |
| Contract | Re-exports CRM types from `@cinatra-ai/sdk-extensions` | `src/contract.ts` |
| Registry | Re-exports provider register/lookup from SDK (globalThis-anchored) | `src/registry.ts` |
| Facade | Provider-agnostic facade; routes CRUD ops to the active provider | `src/facade.ts` |
| MCP Module | Registers 15 `crm_*` MCP tool primitives with zod validation; handles pointer write-back | `src/mcp/module.ts` |
| Object Type Registration | Registers account/contact/list object types in SDK's object-type registry | `src/integration/register-object-types.ts` |
| Sync Adapter | Projects CRM pointer rows into Graphiti via episode export | `src/sync-adapters/twenty-to-graphiti-adapter.ts` |
| Chat Widget | Read-only contact-finder widget for chat UI | `src/chat-widgets/crm-contact-finder.tsx` |
| Find Contact Action | Server action backing the contact-finder widget | `src/chat-widgets/find-contact-action.ts` |
| Widget Registry | Exports widget manifest + definitions for host mounting | `src/widgets/index.ts` |
| UI Components | Reusable Radix/Tailwind UI primitives for widgets | `src/components/ui/` |
| Lib Utils | Tailwind `cn()` helper | `src/lib/utils.ts` |

## Pattern Overview

**Overall:** Provider-Agnostic Connector with Facade + Registry Pattern

**Key Characteristics:**
- The connector owns the MCP surface (tool registration) and the provider-agnostic contract; actual CRM operations are delegated to externally registered providers (e.g. `twenty-connector`).
- All types and the provider registry are anchored in `@cinatra-ai/sdk-extensions` (via globalThis Symbol), enabling zero circular imports between connector and provider extensions.
- Pointer write-back on every create/update ensures a `cinatra.objects` shadow row exists for Graphiti projection and object-grounded LLM workflows.
- Both the MCP-server boot path and the BullMQ worker boot path must call the same registration functions (`registerCrmObjectTypes`, `registerCrmObjectSyncAdapters`) — both paths are idempotent.

## Layers

**Contract Layer:**
- Purpose: Provider-agnostic CRM types (`CrmContact`, `CrmAccount`, `CrmList`, `CrmListMembership`, `CrmConnector`)
- Location: `src/contract.ts` (re-exports from `@cinatra-ai/sdk-extensions`)
- Contains: TypeScript type-only re-exports
- Depends on: `@cinatra-ai/sdk-extensions`
- Used by: Facade, MCP module, sync adapter

**Registry Layer:**
- Purpose: Runtime provider map keyed by provider ID
- Location: `src/registry.ts` (re-exports from `@cinatra-ai/sdk-extensions`)
- Contains: `registerCrmProvider`, `lookupCrmProvider`, `listCrmProviders`
- Depends on: `@cinatra-ai/sdk-extensions` (globalThis Symbol anchor)
- Used by: Facade

**Facade Layer:**
- Purpose: Provider-agnostic CRUD surface; resolves active provider and delegates
- Location: `src/facade.ts`
- Contains: `crmFacade` object with `contact`, `account`, `list` namespaces
- Depends on: Registry, Contract
- Used by: MCP module, sync adapter

**MCP Module Layer:**
- Purpose: Registers `crm_*` MCP tools; handles pointer write-back and repair enqueueing
- Location: `src/mcp/module.ts`
- Contains: 15 tool registrations, `writePointerByType`, `createCrmModule`, actor builders
- Depends on: Facade, Contract, Object type registration, sync adapter, `@cinatra-ai/sdk-extensions`, host's `@/lib/background-jobs`
- Used by: Host MCP server boot, BullMQ worker boot (for `writePointerByType`)

**Object Type Registration Layer:**
- Purpose: Registers account/contact/list object types in the host's object-type registry
- Location: `src/integration/register-object-types.ts`
- Contains: `registerCrmObjectTypes` (idempotent)
- Depends on: `@cinatra-ai/sdk-extensions` (`requireObjectsProvider`)
- Used by: MCP module (`createCrmModule`), host worker boot

**Sync Adapter Layer:**
- Purpose: Projects CRM pointer rows into Graphiti as episodes
- Location: `src/sync-adapters/twenty-to-graphiti-adapter.ts`
- Contains: `twentyToGraphitiAdapter` (ObjectSyncAdapter), `registerCrmObjectSyncAdapters`
- Depends on: Facade (to hydrate full record from Twenty), `@cinatra-ai/sdk-extensions`
- Used by: MCP module (`createCrmModule`), BullMQ worker boot

**Chat Widget Layer:**
- Purpose: Read-only contact-finder UI widget for mounting in the host chat app
- Location: `src/chat-widgets/`, `src/widgets/`
- Contains: `CrmContactFinderWidget`, `find-contact-action.ts`, widget manifest
- Depends on: `@cinatra-ai/sdk-ui`, Facade (read-only; mutations not exposed through chat token)
- Used by: Host app widget registry

## Data Flow

### CRM Mutation (create/update) — inline path

1. LLM calls `crm_contact_create` / `crm_account_create` MCP tool (`src/mcp/module.ts`)
2. MCP handler validates input with zod, calls `crmFacade.contact.create(...)` (`src/facade.ts`)
3. Facade calls `resolveProvider()`, delegates to the registered CRM provider (e.g. Twenty)
4. On success, MCP handler calls `writeContactPointer(result)` → `writePointerByType(...)` → `requireObjectsProvider().saveObject(...)` which upserts a pointer row in `cinatra.objects` and enqueues to `graphiti_projection_outbox`
5. Handler returns success with the CRM record; pointer write failure triggers `enqueuePointerRepairOrLog` (BullMQ job `TWENTY_POINTER_REPAIR`, 5 attempts exponential backoff)

### Graphiti Projection — async path

1. BullMQ worker `processProjectionOutbox` reads from `graphiti_projection_outbox`
2. Projector sees adapter-owned type (`@cinatra-ai/entity-accounts:account` or `@cinatra-ai/entity-contacts:contact`)
3. Projector routes to `TwentyToGraphitiAdapter.export(object)` (`src/sync-adapters/twenty-to-graphiti-adapter.ts`)
4. Adapter reads `object.data.external_id`, calls `crmFacade.account/contact.get({ id: externalId })` to hydrate from Twenty
5. `composeEpisodeBody` builds a JSON episode body with `cinatra_object_id` marker for back-mapping
6. Adapter calls `requireObjectsProvider().addGraphitiEpisodeForObject(...)` to write episode into Graphiti
7. Projector calls `markProjected` with returned `episodeUuid`

### Read-only contact lookup (chat widget)

1. User submits email in `CrmContactFinderWidget` (`src/chat-widgets/crm-contact-finder.tsx`)
2. Widget calls `find-contact-action.ts` server action
3. Action calls `crmFacade.contact.findByEmail(...)` via facade
4. Result rendered in widget; no write-back triggered

**State Management:**
- No local state; all CRM state lives canonically in the external CRM provider (Twenty).
- Cinatra side holds only lightweight pointer rows in `cinatra.objects` (shadow identity for Graphiti).
- Provider registry anchored on `globalThis` Symbol in `@cinatra-ai/sdk-extensions`.

## Key Abstractions

**`CrmConnector` interface:**
- Purpose: Contract that any CRM provider must implement (`searchContacts`, `getContact`, `createContact`, `updateContact`, `findContactByEmail`, plus account and list equivalents)
- Location: Defined in `@cinatra-ai/sdk-extensions`, re-exported via `src/contract.ts`
- Pattern: Strategy pattern — providers register themselves; facade resolves at call time

**`crmFacade`:**
- Purpose: Single stable call site for all CRM operations regardless of provider
- Location: `src/facade.ts`
- Pattern: Facade pattern; currently single-provider (resolves to "twenty"), but structured for multi-provider resolution by `instanceId`

**`twentyToGraphitiAdapter`:**
- Purpose: `ObjectSyncAdapter` that bridges CRM pointer rows to Graphiti episodes
- Location: `src/sync-adapters/twenty-to-graphiti-adapter.ts`
- Pattern: Adapter pattern; conforms to `ObjectSyncAdapter<Record<string, never>>` interface

**Pointer Write-back:**
- Purpose: After every CRM create/update, write a minimal pointer row to `cinatra.objects` so Graphiti projection and object-grounded workflows can reference the record
- Location: `writePointerByType` in `src/mcp/module.ts`
- Pattern: Post-write side effect with durable repair queue fallback

## Entry Points

**Public Package API:**
- Location: `src/index.ts`
- Triggers: Imported by host app, MCP server, BullMQ worker
- Responsibilities: Exports types, registry helpers, facade, MCP primitives registrar, object type/sync adapter registrars

**MCP Server Boot:**
- Location: `createCrmModule()` in `src/mcp/module.ts`
- Triggers: Called by host `src/lib/mcp-server.ts` at boot
- Responsibilities: Calls `registerCrmObjectTypes()`, `registerCrmObjectSyncAdapters()`, returns `{ registerCapabilities }` for tool registration

**BullMQ Worker Boot:**
- Location: Host's `src/lib/background-jobs.ts` (external to this repo)
- Triggers: Worker process start
- Responsibilities: Must call `registerCrmObjectTypes()` and `registerCrmObjectSyncAdapters()` before `processProjectionOutbox` runs

**Chat Widget Entry:**
- Location: `src/widgets/index.ts`
- Triggers: Imported by host via `@cinatra-ai/crm-connector/widgets`
- Responsibilities: Exports widget manifest and `CrmContactFinderWidget`

## Architectural Constraints

- **Server-only:** `src/facade.ts`, `src/mcp/module.ts`, `src/integration/register-object-types.ts`, `src/sync-adapters/twenty-to-graphiti-adapter.ts` all import `"server-only"` — they cannot be bundled into client code.
- **Global state:** Provider registry is a globalThis Symbol Map anchored in `@cinatra-ai/sdk-extensions`. Object-type and sync-adapter registries are also host-injected via `requireObjectsProvider()`.
- **Circular imports:** None — contract and registry re-export from SDK only; provider extensions import from SDK, not from this package.
- **Boot order:** Provider registration (external) must precede any facade call. `registerCrmObjectTypes` and `registerCrmObjectSyncAdapters` must precede `processProjectionOutbox` in the worker process.
- **No MCP ALS frame in worker:** The BullMQ worker has no MCP request AsyncLocalStorage frame; actor identity must be explicitly captured at enqueue time and passed via job payload.

## Anti-Patterns

### Calling `crmFacade` before provider registration

**What happens:** `resolveProvider()` iterates the hardcoded `["twenty"]` list; if no provider is registered, it throws `[crm-connector] no CRM provider registered`.
**Why it's wrong:** Causes runtime failures on any CRM tool call.
**Do this instead:** Ensure the host calls `registerTwentyProvider()` (via `src/lib/register-crm-providers.ts`) before any route or job invokes facade methods.

### Importing `@cinatra-ai/objects` directly from the connector

**What happens:** Would create a direct dependency on the host-internal objects package, breaking the SDK-only decouple.
**Why it's wrong:** The connector must import ONLY `@cinatra-ai/sdk-extensions`; the host binds the real provider at boot via `requireObjectsProvider()`.
**Do this instead:** Use `requireObjectsProvider()` from `@cinatra-ai/sdk-extensions` for all object registry and save operations.

## Error Handling

**Strategy:** Inline pointer write errors are caught and escalated to a durable BullMQ repair job; CRM provider errors propagate to the MCP caller. Projection errors return `{ ok: false, error }` to the outbox for retry.

**Patterns:**
- `writeContactPointer` / `writeAccountPointer`: try/catch → `enqueuePointerRepairOrLog` with 5-attempt exponential backoff
- `enqueuePointerRepairOrLog`: if BullMQ enqueue also fails, writes `[POINTER_REPAIR_FALLBACK]` JSON to `process.stderr` as a durability backstop
- `TwentyToGraphitiAdapter.export()`: try/catch → `{ ok: false, error }` allowing projector outbox retry

## Cross-Cutting Concerns

**Logging:** `process.stderr.write` for pointer-write failures; no structured logging library.
**Validation:** Zod schemas on all MCP tool inputs; object-type schemas registered in SDK object-type registry.
**Authentication:** Actor identity resolved via `requireCrmRequestActorResolver().getActor()` (host-injected SDK DI slot); actor stamped with `roles: ["member"]` for pointer writes.

---

*Architecture analysis: 2026-06-09*
