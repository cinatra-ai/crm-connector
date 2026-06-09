# Coding Conventions

**Analysis Date:** 2026-06-09

## Naming Patterns

**Files:**
- TypeScript source files use kebab-case: `twenty-to-graphiti-adapter.ts`, `crm-contact-finder.tsx`, `find-contact-action.ts`
- Test files use the pattern `<subject>.test.ts` placed under `src/__tests__/`
- React component files use `.tsx` extension; server-only logic uses `.ts`

**Functions:**
- Exported functions use camelCase: `registerCrmProvider`, `lookupCrmProvider`, `writePointerByType`, `buildPointerActor`
- Boolean helpers use verb-first naming: `isSupportedType`, `isValidEmail`
- Private helpers (not exported) also use camelCase: `resolveProvider`, `enqueuePointerRepairOrLog`

**Variables:**
- `camelCase` throughout; constants use `SCREAMING_SNAKE_CASE` for names that are genuine constants: `SUPPORTED_TYPES`, `BACKGROUND_JOB_NAMES`

**Types / Interfaces:**
- PascalCase for types and interfaces: `CrmConnector`, `CrmContact`, `CrmAccount`, `ContactFinderResult`, `AccountOrContact`
- Discriminated unions use a `status` or `type` discriminant field with string literal values: `"found"`, `"not_found"`, `"error"`

**React Components:**
- PascalCase exported component functions: `CrmContactFinderWidget`

## Code Style

**Formatting:**
- No Prettier or Biome config file detected in the repo root; formatting follows the host monorepo's conventions (project is extracted from a monorepo)
- Indentation: 2 spaces (consistent across all files inspected)
- Trailing commas used in multi-line object/array literals

**Linting:**
- No local ESLint config file; the codebase relies on the host monorepo's ESLint rules
- `eslint-disable-next-line @typescript-eslint/no-explicit-any` is used inline where `any` casts are unavoidable (test files casting mock inputs)
- `noImplicitAny: false` is set in `tsconfig.json`, so implicit `any` is permitted but explicit casts are preferred and annotated

**TypeScript:**
- `strict: true` with `noImplicitAny: false` — strict null checks, strict function types, etc., but implicit `any` is allowed
- `verbatimModuleSyntax: true` — `import type` must be used for type-only imports (`import type { CrmConnector } from "./contract"`)
- `isolatedModules: true` — each file must be independently compilable

## Import Organization

**Order (observed pattern):**
1. Node built-ins: `import { readFileSync } from "node:fs"`
2. Side-effect-only imports (directives): `import "server-only"`
3. External packages: `import { z } from "zod"`, `import { vi, describe } from "vitest"`
4. SDK / peer packages: `import { requireObjectsProvider } from "@cinatra-ai/sdk-extensions"`
5. Internal relative imports: `import { crmFacade } from "../facade"`, `import { cn } from "../../lib/utils"`

**Path Aliases:**
- `@/` alias used for host-app imports (e.g., `@/lib/auth-session`, `@/lib/background-jobs`). These are resolved by the host app's tsconfig; they are NOT resolvable inside the standalone package sandbox.
- Internal imports use relative paths (`../facade`, `../contract`, `../../lib/utils`)

## Server / Client Directives

**Server-only modules:**
- Files that must not be bundled client-side begin with `import "server-only"` (from the `server-only` npm package): `src/facade.ts`, `src/sync-adapters/twenty-to-graphiti-adapter.ts`, `src/mcp/module.ts`, `src/chat-widgets/find-contact-action.ts`
- Server Actions also declare `"use server"` as the first line before any imports

**Client components:**
- React client components declare `"use client"` as the very first line: `src/chat-widgets/crm-contact-finder.tsx`

## Error Handling

**Patterns:**
- Server actions wrap the entire body in `try/catch` and return a typed discriminated union (`ContactFinderResult`) rather than throwing — errors surface as `{ status: "error", message: string }` payloads
- Async adapter methods (`export`) return `{ ok: boolean; externalId?: string; error?: string }` rather than throwing, so the projector can handle failures without a try/catch
- Infrastructure failures (DB write fails, Redis unavailable) fall back to structured `stderr` logging with a `[POINTER_REPAIR_FALLBACK]` prefix plus a JSON payload — the contract is: never let a known-good external write bounce back to the caller
- `throw new Error(...)` is used for programming errors and boot-time misconfiguration (e.g., no CRM provider registered in `src/facade.ts`)

## Logging

**Framework:** `process.stderr.write` for structured fallback lines (no logger library detected)

**Patterns:**
- Structured log lines use a `[TAG]` prefix followed by a JSON payload: `[POINTER_REPAIR_FALLBACK] {...}`
- Regular debug/info logging: not observed in the package; deferred to the host app

## Comments

**When to Comment:**
- Module-level block comments document the architectural rationale, wiring, and cross-cutting concerns in detail (see `src/sync-adapters/twenty-to-graphiti-adapter.ts`, `src/mcp/module.ts`)
- Inline comments explain non-obvious invariants, authz constraints, and cross-repo marker contracts
- `// D8 —` prefix is used for comments that belong to a named design doc or architectural decision (`D8` = Twenty→Graphiti sync adapter)

**JSDoc / TSDoc:**
- JSDoc is used selectively for exported functions that compose complex inputs: `/** ... */` block on `composeEpisodeBody` in the adapter
- Not used uniformly across all exports

## Function Design

**Size:** Functions are kept small and focused; large flows are split across named helpers (`buildPointerActor`, `buildPointerActorFromIds`, `enqueuePointerRepairOrLog`)

**Parameters:** Single object parameter preferred for non-trivial inputs; primitive arguments used for simple lookups (`lookupCrmProvider("twenty")`)

**Return Values:**
- Async functions return `Promise<T>` with explicit types
- Error states encoded in return type (discriminated union or `{ ok, error }`) rather than thrown exceptions for recoverable errors

## Module Design

**Exports:**
- `src/index.ts` is the single barrel that re-exports the public surface
- Internal re-exports use thin pass-through files to preserve import paths during monorepo extraction: `src/registry.ts` and `src/contract.ts` both re-export from `@cinatra-ai/sdk-extensions` so internal modules continue importing `./registry` and `./contract` unchanged

**Barrel Files:**
- One top-level barrel (`src/index.ts`); UI components exported via `src/widgets/index.ts`
- Sub-directories do NOT have their own barrel files; imports use direct relative paths

## UI / Styling

**Component Source:**
- shadcn/ui primitives are vendored locally under `src/components/ui/` (not imported from the host app's `@/components/ui/`)
- All Tailwind classes must use semantic design tokens; raw color classes like `bg-white`, `text-gray-*`, `text-slate-*` are prohibited
- No raw `<input>` JSX — always use `<InputGroupInput>` from `src/components/ui/input-group.tsx`
- No emojis in source code

---

*Convention analysis: 2026-06-09*
