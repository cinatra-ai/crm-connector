# Testing Patterns

**Analysis Date:** 2026-06-09

## Test Framework

**Runner:**
- Vitest 4.x
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`, `toEqual`, `toMatchObject`, `toHaveBeenCalledOnce`, `toHaveBeenCalledWith`, `toBeUndefined`, `toBe`, `toMatch`, `not.toMatch`, etc.)

**Run Commands:**
```bash
npm test        # Run all tests (vitest run — no watch)
```

No watch mode or coverage commands are configured in `package.json`; `vitest run` is the only script.

## Test File Organization

**Location:**
- All tests live under `src/__tests__/` (NOT co-located with source files)

**Naming:**
- `<subject>.test.ts` — no `.spec.ts` files used
- Examples: `twenty-to-graphiti-adapter.test.ts`, `contract-shape.test.ts`, `pointer-write-repair.test.ts`, `crm-contact-finder.test.ts`

**Structure:**
```
src/
└── __tests__/
    ├── contract-shape.test.ts          # Registry register/lookup contract
    ├── crm-contact-finder.test.ts      # Widget + server action source-text contract
    ├── pointer-write-repair.test.ts    # Durable repair path (BullMQ enqueue fallback)
    └── twenty-to-graphiti-adapter.test.ts  # Adapter export() end-to-end behavior
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Subject — scenario group", () => {
  beforeEach(() => {
    // reset mocks and re-wire DI slots
  });

  it("plain-English description of the invariant being pinned", async () => {
    // arrange → act → assert
  });
});
```

**Patterns:**
- `beforeEach` is used for mock reset + DI re-wiring (registry resets, `setObjectsProvider`, `setCrmRequestActorResolver`, `_resetObjectsProviderForTests`)
- No `afterEach` / `afterAll` teardown observed
- Assertions are grouped logically within a single `it` block when they describe a single invariant (e.g., asserting both `ok` and `externalId` in the same test)
- Test descriptions follow a plain-English sentence style: `"hydrates a contact via crmFacade + projects via the objects provider"`

## Mocking

**Framework:** Vitest's built-in `vi.mock`, `vi.fn`, `vi.hoisted`, `vi.spyOn`

**Patterns:**

`vi.hoisted` is required when mock factory functions must reference variables that are used inside `vi.mock` callbacks (avoids temporal dead zone):
```typescript
const { addEpisodeForObjectMock, contactGetMock } = vi.hoisted(() => ({
  addEpisodeForObjectMock: vi.fn(),
  contactGetMock: vi.fn(),
}));

vi.mock("../facade", () => ({
  crmFacade: {
    contact: { get: contactGetMock },
    account: { get: accountGetMock },
  },
}));
```

`server-only` is always mocked to a no-op so modules with `import "server-only"` load in the Node test environment:
```typescript
vi.mock("server-only", () => ({}));
```

DI slots (SDK provider injection) are reset and re-wired in `beforeEach` rather than relying on module-level state:
```typescript
beforeEach(() => {
  _resetObjectsProviderForTests();
  setObjectsProvider({ saveObject: objectsSaveMock, ... });
  setCrmRequestActorResolver({ getActor: () => mcpStoreMock() });
});
```

Mock implementations use `.mockResolvedValue`, `.mockRejectedValueOnce`, `.mockImplementation` — never plain return value assignment:
```typescript
contactGetMock.mockResolvedValue({ id: "twenty-c-123", name: "Alice", ... });
addEpisodeForObjectMock.mockRejectedValueOnce(new Error("Graphiti unreachable"));
```

`vi.spyOn(process.stderr, "write")` is used to assert structured fallback log lines, with `.mockRestore()` in a `finally` block.

**What to Mock:**
- `server-only` (always — the package throws in Node environments)
- SDK host-injected providers (`setObjectsProvider`, `setCrmRequestActorResolver`)
- Internal modules that cross a subsystem boundary: `../facade`, `@/lib/background-jobs`, `../integration/register-object-types`, `../sync-adapters/twenty-to-graphiti-adapter`
- `@cinatra-ai/sdk-extensions` functions that are DI slots (`setObjectsProvider`, `_resetObjectsProviderForTests`)

**What NOT to Mock:**
- The module under test itself
- Pure utility functions (`src/lib/utils.ts`)
- The registry module when testing registry behavior (test uses real `registerCrmProvider`/`lookupCrmProvider` with `_resetCrmProviderRegistry`)

## Fixtures and Factories

**Test Data:**
Factory functions are used to produce valid input objects with overridable fields:
```typescript
function mkContactPointer(overrides: Record<string, unknown> = {}) {
  return {
    id: "obj-1",
    type: "@cinatra-ai/entity-contacts:contact",
    data: { type: "contact", external_id: "twenty-c-123", name: "Alice" },
    orgId: "org-1",
    ...overrides,  // spread last so callers can override any field
  };
}
```

**Location:**
- Factories are defined inline at the top of the test file that uses them (not shared across files)

## Coverage

**Requirements:** Not enforced — no coverage threshold in `vitest.config.ts` or `package.json`

**View Coverage:**
```bash
# Not configured; run manually with:
npx vitest run --coverage
```

## Test Types

**Unit Tests:**
- Core test type in this package
- Scope: single module or adapter with all external collaborators mocked
- Examples: `twenty-to-graphiti-adapter.test.ts` (adapter behavior), `pointer-write-repair.test.ts` (BullMQ repair path), `contract-shape.test.ts` (registry contract)

**Source-Text / Contract Tests:**
- A distinct pattern used where React/JSX rendering is impractical in the sandbox
- Tests read source files with `readFileSync` and assert on string content (import paths, JSX element names, directive placement, regex matches on source code)
- Used in `crm-contact-finder.test.ts` to pin UI component composition, auth guard ordering, and naming conventions without needing a DOM renderer
- Rationale documented inline: package-local vitest sandbox cannot resolve `@/components/*` host-app aliases, so runtime loading is skipped; full type-checking happens via host `pnpm typecheck`

**Integration Tests:**
- Not applicable — no integration or E2E test infrastructure in this package

**E2E Tests:**
- Not used

## Common Patterns

**Async Testing:**
```typescript
it("description", async () => {
  contactGetMock.mockResolvedValue({ id: "twenty-c-123", name: "Alice" });
  const result = await twentyToGraphitiAdapter.export(mkContactPointer() as any, {});
  expect(result.ok).toBe(true);
});
```

**Error Testing:**
```typescript
it("returns ok:false with the error message when the provider projection throws", async () => {
  addEpisodeForObjectMock.mockRejectedValueOnce(new Error("Graphiti unreachable"));
  const result = await twentyToGraphitiAdapter.export(mkContactPointer() as any, {});
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/Graphiti unreachable/);
});
```

**Testing non-throw contracts (the mutation must not bounce):**
```typescript
await expect(
  writeAccountPointer({ id: "twenty-a-x", name: "Lost" } as never),
).resolves.toBeUndefined();
```

**Asserting call arguments with type cast:**
```typescript
const call = addEpisodeForObjectMock.mock.calls[0]![0] as Record<string, unknown>;
expect(call.objectId).toBe("obj-1");
```
Note: `as any` or `as never` casts on mock inputs are annotated with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`.

**Vitest config (full):**
```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],   // .tsx test files not included
    environment: "node",
  },
});
```

---

*Testing analysis: 2026-06-09*
