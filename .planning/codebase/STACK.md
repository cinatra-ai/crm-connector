# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- TypeScript — all source files under `src/` (`.ts` and `.tsx`)

**Secondary:**
- TSX — React UI components under `src/components/ui/` and `src/chat-widgets/`

## Runtime

**Environment:**
- Node.js (ESM module system; `"type": "module"` in `package.json`)
- Target: ES2023 (`tsconfig.json` `"target": "ES2023"`)

**Package Manager:**
- npm (`.npmrc` present; lockfile presence not confirmed — repo may rely on parent workspace)

## Frameworks

**Core:**
- No application framework — this is a library/connector package published as `@cinatra-ai/crm-connector`

**UI / Component:**
- React 19 (peer dependency `react ^19.2.3`, `react-dom ^19.2.3`) — used in chat widgets and UI components
- Radix UI `^1.4.3` — headless UI primitives for `src/components/ui/`
- `class-variance-authority ^0.7.1` — variant-based className composition (`src/lib/utils.ts`)
- `tailwind-merge ^3.5.0` — Tailwind class merging utility

**Validation:**
- Zod `^4.4.3` — all MCP tool input schemas in `src/mcp/module.ts`, object type schemas in `src/integration/register-object-types.ts`, and adapter config schema in `src/sync-adapters/twenty-to-graphiti-adapter.ts`

**Testing:**
- Vitest `^4.1.6` — configured in `vitest.config.ts`; runs all `src/**/*.test.ts` files in Node environment

**Build/Dev:**
- TypeScript compiler (`tsc`) — `tsconfig.json` targets `outDir: dist`, `moduleResolution: bundler`, `jsx: react-jsx`

## Key Dependencies

**Critical:**
- `@cinatra-ai/sdk-extensions` (peer, optional) — provides `CrmConnector`, `CrmContact`, `CrmAccount`, `CrmList`, `CrmListMembership` contract types; `ExtensionMcpToolServer`; DI slots `requireObjectsProvider`, `getObjectsProviderOrNull`, `requireCrmRequestActorResolver`; CRM provider registry (`registerCrmProvider`, `lookupCrmProvider`); `ObjectSyncAdapter`, `StoredObject` types. The connector re-exports from this package via `src/contract.ts` and `src/registry.ts`.
- `@cinatra-ai/sdk-ui` (peer, optional) — UI SDK; used transitively by chat widgets
- `zod ^4.4.3` — runtime schema validation for all 15 MCP tool inputs and all three CRM object-type schemas
- `server-only` `0.0.1` — import guard on `src/facade.ts`, `src/mcp/module.ts`, `src/sync-adapters/twenty-to-graphiti-adapter.ts`, and `src/integration/register-object-types.ts` to prevent accidental client-side bundling

**Infrastructure:**
- `clsx ^2.1.1` — className utility used in UI components
- `radix-ui ^1.4.3` — low-level accessible component primitives
- `class-variance-authority ^0.7.1` — variant styling helper

## Configuration

**Environment:**
- No `.env` file read by this package directly; environment-specific values (org/user context, CRM provider credentials) are injected at runtime via the host's DI slots (`requireObjectsProvider`, `requireCrmRequestActorResolver`)
- `.npmrc` present (note existence only — not read)

**Build:**
- `tsconfig.json` — standalone config (no monorepo extends); `strict: true`, `noImplicitAny: false`, `isolatedModules: true`, `verbatimModuleSyntax: true`
- `vitest.config.ts` — test runner config

**Package Manifest:**
- `package.json` — `cinatra.apiVersion: cinatra.ai/v1`, `cinatra.kind: connector` metadata field signals this is a cinatra connector extension

## Platform Requirements

**Development:**
- Node.js with ESM support
- TypeScript toolchain

**Production:**
- Consumed as a library by a cinatra host application (Next.js or standalone Node.js worker)
- Requires host to bind `requireObjectsProvider()` and `requireCrmRequestActorResolver()` DI slots at boot before any CRM operation
- `server-only` guard enforces server-side-only execution (Next.js or Node.js server context)

---

*Stack analysis: 2026-06-09*
