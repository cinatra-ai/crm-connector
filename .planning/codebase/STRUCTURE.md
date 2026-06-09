# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
crm-connector/
├── src/
│   ├── index.ts                        # Public package entry point
│   ├── contract.ts                     # Re-exports CRM types from @cinatra-ai/sdk-extensions
│   ├── registry.ts                     # Re-exports provider registry from @cinatra-ai/sdk-extensions
│   ├── facade.ts                       # Provider-agnostic crmFacade (server-only)
│   ├── mcp/
│   │   └── module.ts                   # 15 crm_* MCP tools + pointer write-back + createCrmModule()
│   ├── integration/
│   │   └── register-object-types.ts    # registerCrmObjectTypes() for account/contact/list
│   ├── sync-adapters/
│   │   └── twenty-to-graphiti-adapter.ts  # TwentyToGraphitiAdapter + registerCrmObjectSyncAdapters()
│   ├── chat-widgets/
│   │   ├── crm-contact-finder.tsx      # CrmContactFinderWidget React component
│   │   └── find-contact-action.ts      # Server action for contact finder widget
│   ├── widgets/
│   │   └── index.ts                    # Widget manifest + crmConnectorWidgets array
│   ├── components/
│   │   └── ui/
│   │       ├── button.tsx              # Radix/Tailwind button primitive
│   │       ├── field.tsx               # Form field wrapper
│   │       ├── input-group.tsx         # Input group layout
│   │       ├── input.tsx               # Text input primitive
│   │       ├── label.tsx               # Form label primitive
│   │       ├── separator.tsx           # Visual separator
│   │       └── textarea.tsx            # Textarea primitive
│   ├── lib/
│   │   └── utils.ts                    # Tailwind cn() utility (clsx + tailwind-merge)
│   └── __tests__/
│       ├── contract-shape.test.ts      # Type-level contract shape tests
│       ├── crm-contact-finder.test.ts  # Widget/action tests
│       ├── pointer-write-repair.test.ts # Pointer write-back + repair job tests
│       └── twenty-to-graphiti-adapter.test.ts  # Sync adapter tests
├── package.json                        # Package manifest (ESM, cinatra connector kind)
├── tsconfig.json                       # TypeScript config
├── vitest.config.ts                    # Vitest test runner config
├── .npmrc                              # npm registry config
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                      # CI workflow
│   │   └── release.yml                 # Release workflow
└── LICENSE                             # Apache-2.0
```

## Directory Purposes

**`src/`:**
- Purpose: All source code; ESM TypeScript, no compiled output committed
- Contains: Connector logic, MCP registration, UI widgets, test files

**`src/mcp/`:**
- Purpose: MCP tool surface — the only layer that touches `ExtensionMcpToolServer`
- Contains: 15 `crm_*` tool registrations, pointer write-back helpers, `createCrmModule` factory
- Key files: `src/mcp/module.ts`

**`src/integration/`:**
- Purpose: SDK integration bootstrap — registers CRM object types in the host object-type registry
- Contains: `registerCrmObjectTypes()` covering account, contact, and list
- Key files: `src/integration/register-object-types.ts`

**`src/sync-adapters/`:**
- Purpose: Outbox-driven async projection — bridges pointer rows to Graphiti episodes
- Contains: `twentyToGraphitiAdapter`, `registerCrmObjectSyncAdapters`
- Key files: `src/sync-adapters/twenty-to-graphiti-adapter.ts`

**`src/chat-widgets/`:**
- Purpose: React server-component widgets surfaced in the host chat UI
- Contains: Read-only contact finder widget and its backing server action
- Key files: `src/chat-widgets/crm-contact-finder.tsx`, `src/chat-widgets/find-contact-action.ts`

**`src/widgets/`:**
- Purpose: Widget manifest and registry — consumed by host via `@cinatra-ai/crm-connector/widgets`
- Key files: `src/widgets/index.ts`

**`src/components/ui/`:**
- Purpose: Reusable Radix/Tailwind UI primitives used by chat widgets
- Contains: button, field, input-group, input, label, separator, textarea
- Generated: No — hand-authored primitives

**`src/lib/`:**
- Purpose: Shared utilities
- Key files: `src/lib/utils.ts` (exports `cn`)

**`src/__tests__/`:**
- Purpose: All unit/integration tests co-located under `src/`
- Key files: `pointer-write-repair.test.ts`, `twenty-to-graphiti-adapter.test.ts`, `crm-contact-finder.test.ts`, `contract-shape.test.ts`

## Key File Locations

**Entry Points:**
- `src/index.ts`: Public package API — types, registry helpers, facade, MCP primitives, object type/sync adapter registrars
- `src/widgets/index.ts`: Widget-specific entry point (`@cinatra-ai/crm-connector/widgets`)

**Configuration:**
- `package.json`: Package metadata; `"cinatra": { "kind": "connector" }` manifest
- `tsconfig.json`: TypeScript settings
- `vitest.config.ts`: Test runner config

**Core Logic:**
- `src/facade.ts`: Provider-agnostic CRM facade
- `src/mcp/module.ts`: MCP tool registration + pointer write-back
- `src/integration/register-object-types.ts`: Object type bootstrap
- `src/sync-adapters/twenty-to-graphiti-adapter.ts`: Graphiti projection adapter

**Testing:**
- `src/__tests__/`: All tests, co-located under `src/`

## Naming Conventions

**Files:**
- Kebab-case: `crm-contact-finder.tsx`, `find-contact-action.ts`, `register-object-types.ts`, `twenty-to-graphiti-adapter.ts`
- Descriptive noun phrases indicating domain and purpose

**Directories:**
- Kebab-case: `chat-widgets/`, `sync-adapters/`, `components/ui/`

**Exports:**
- Camel-case functions: `registerCrmProvider`, `crmFacade`, `createCrmModule`, `writePointerByType`
- Pascal-case React components: `CrmContactFinderWidget`
- Camel-case constants: `twentyToGraphitiAdapter`, `crmConnectorWidgets`, `crmContactFinderManifest`

## Where to Add New Code

**New CRM entity type (e.g. deal):**
- Add registration: `src/integration/register-object-types.ts` — add `registerDealObjectType()` inside `registerCrmObjectTypes()`
- Add facade methods: `src/facade.ts` — extend `crmFacade` with a `deal` namespace
- Add MCP tools: `src/mcp/module.ts` — add zod schemas + `server.registerTool(...)` calls inside `registerCrmConnectorPrimitives`
- Add pointer write-back: `src/mcp/module.ts` — add `writeDealPointer` following the `writeContactPointer` pattern
- Export from public API: `src/index.ts`

**New CRM provider (not twenty):**
- Implement `CrmConnector` interface (from `@cinatra-ai/sdk-extensions`)
- Call `registerCrmProvider(id, impl)` at host boot
- Update `resolveProvider()` in `src/facade.ts` to include the new provider ID in the resolution list

**New chat widget:**
- Add React component to `src/chat-widgets/`
- Add server action to `src/chat-widgets/` if needed
- Register in `src/widgets/index.ts` under `crmConnectorWidgets`
- Add UI primitives to `src/components/ui/` if new primitives are required

**New utility:**
- Shared helpers: `src/lib/utils.ts`

**New tests:**
- `src/__tests__/` — file named `<feature>.test.ts`

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents
- Generated: Yes (by gsd-map-codebase)
- Committed: Yes

**`.github/workflows/`:**
- Purpose: CI and release automation
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-06-09*
