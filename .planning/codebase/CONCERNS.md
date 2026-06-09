# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**Single-provider facade hardcode:**
- Issue: `resolveProvider()` in `src/facade.ts` iterates a hardcoded `["twenty"]` array and ignores the `instanceId` parameter. The comment explicitly says "The instance-aware resolver is not yet wired". Any second CRM provider registration silently requires touching the array.
- Files: `src/facade.ts` (lines 14–25)
- Impact: Multi-tenant or multi-provider scenarios are blocked; the `instanceId` parameter signature is a no-op today.
- Fix approach: Replace the hardcoded list with a lookup from the provider registry using the `instanceId` when provided; fall back to the single registered provider only when `instanceId` is absent.

**`as unknown as` type casts in schema registration:**
- Issue: `src/integration/register-object-types.ts` (line 227) uses `as unknown as ObjectTypeDefinition["schema"]` to force a mismatched Zod type past TypeScript. This masks a type mismatch between the connector's Zod 4 `z.object()` return and what the SDK's `ObjectTypeDefinition["schema"]` expects.
- Files: `src/integration/register-object-types.ts` (line 227)
- Impact: Type safety on the list object type schema is silently bypassed; schema-level regressions won't surface at compile time.
- Fix approach: Align the Zod schema shape with the SDK's `ObjectTypeDefinition["schema"]` type directly, or update the SDK contract to accept the wider type.

**`hydrated as unknown as Record<string, unknown>` cast in adapter:**
- Issue: In `src/sync-adapters/twenty-to-graphiti-adapter.ts` (line 158), the hydrated CRM record is cast with `as unknown as Record<string, unknown>` before passing to `composeEpisodeBody`. The facade returns typed `CrmContact | CrmAccount | null`, but the cast erases that typing.
- Files: `src/sync-adapters/twenty-to-graphiti-adapter.ts` (line 158)
- Impact: Any structural change to `CrmContact`/`CrmAccount` will not produce a compile error in the episode body composition path. Fields accessed via string indexing (`hydrated.email`, `hydrated.domainName`) are unchecked.
- Fix approach: Overload or genericize `composeEpisodeBody` to accept the typed union directly.

**`version` field absent from CRM episode envelope:**
- Issue: The `composeEpisodeBody` function in `src/sync-adapters/twenty-to-graphiti-adapter.ts` (lines 73–116) intentionally omits `version` from the `_cinatra` envelope, with a comment noting the adapter receives a lighter `StoredObject` that lacks `version`. The generic projector emits `version` for back-mapping provenance.
- Files: `src/sync-adapters/twenty-to-graphiti-adapter.ts` (lines 73–84)
- Impact: CRM-originated Graphiti episodes have weaker provenance than generic projector episodes. The comment states this is harmless for recovery, but it creates a divergence in episode shape that could complicate future cross-type queries.
- Fix approach: Add a `version` field to `StoredObject` in the SDK, or derive a monotonic counter from `createdAt` as a substitute.

**`RetiredCrmRenderer` / `StubRenderer` null-rendering stubs:**
- Issue: `src/integration/register-object-types.ts` (lines 32, 202) declares `RetiredCrmRenderer = () => null` and `StubRenderer = () => null` as the required `listRow`, `card`, and `detail` renderer slots. These are non-functional and are only present to satisfy a registry contract.
- Files: `src/integration/register-object-types.ts` (lines 32–33, 202)
- Impact: If the host app ever surfaces these renderer slots (e.g. cinatra objects browse UI), CRM pointer rows will render nothing with no error, silently degrading the UX.
- Fix approach: Either formally document these as intentional no-ops with a type annotation or provide minimal read-only renderers that deeplink to the Twenty UI (as the comments suggest is the intended browse path).

**`preserveOnUpdate` references retired field names:**
- Issue: Both `registerAccountObjectType` and `registerContactObjectType` in `src/integration/register-object-types.ts` list `"startupId"` and `"accountId"` in `preserveOnUpdate` (lines 97, 184). The surrounding comments state these fields were "dropped" and "no row in cinatra.objects carries them after the cutover."
- Files: `src/integration/register-object-types.ts` (lines 97, 184)
- Impact: Dead configuration; the substrate may unnecessarily attempt to preserve fields that no longer exist, or future schema readers may be confused about what the live schema contains.
- Fix approach: Remove `startupId` and `accountId` from `preserveOnUpdate` once confirmed no legacy rows remain with those fields.

**`contactRequiredFields` requires email but schema marks it optional:**
- Issue: `registerContactObjectType` sets `requiredFields: ["email"]` (line 183) in `crudPolicy`, but the Zod schema (line 151) declares `email: z.string().optional()`. These two contracts are inconsistent — the schema admits rows without email, but the crud policy treats email as required for deduplication.
- Files: `src/integration/register-object-types.ts` (lines 140–186)
- Impact: A contact pointer row without `email` passes schema validation but may behave unpredictably at the crud-policy layer (identity miss → spurious create vs. merge).
- Fix approach: Either make `email` required in the Zod schema (and update `identityKey` fallback chain) or change `requiredFields` to reflect that email is one of several acceptable identity keys.

## Known Bugs

**Pointer-write `orgId` null race in inline handler:**
- Symptoms: If `requireCrmRequestActorResolver().getActor()` returns `null` (e.g. the MCP ALS frame is not populated yet when `enqueuePointerRepairOrLog` is called), then `orgId` and `userId` are captured as `null`. The BullMQ job is enqueued with `orgId: null`, and every retry fails `objects_save`'s `actor.orgId is null` guard deterministically.
- Files: `src/mcp/module.ts` (lines 193–240)
- Trigger: Any scenario where the inline MCP handler fires outside a populated request store (e.g. a synthetic test invocation, or a misconfigured host that does not wire the CRM actor resolver before dispatching).
- Workaround: The `[POINTER_REPAIR_FALLBACK]` stderr log captures the payload for manual replay.

**Terminal `ok: true` on unsupported type silently swallows misroutes:**
- Symptoms: If the projector routes a non-CRM type to `twentyToGraphitiAdapter.export()`, the adapter returns `{ ok: true }` and marks the outbox row as projected. No error is emitted and no retry occurs.
- Files: `src/sync-adapters/twenty-to-graphiti-adapter.ts` (lines 126–130)
- Trigger: A misconfigured adapter registry that routes an unexpected type to the CRM adapter.
- Workaround: None; the silent `ok: true` makes this invisible in logs.

## Security Considerations

**`.npmrc` present:**
- Risk: `.npmrc` files often contain auth tokens or registry credentials.
- Files: `.npmrc`
- Current mitigation: File contents not read; existence noted.
- Recommendations: Confirm `.npmrc` contains no auth tokens; if tokens are required, use environment variable interpolation rather than embedded literals.

**Server action skips email-format validation before returning typed result:**
- Risk: `isValidEmail` in `src/chat-widgets/find-contact-action.ts` (line 34) uses a minimal regex (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) that is not RFC 5321 compliant and could pass malformed inputs to the CRM facade. The facade re-validates with `z.string().email()` (Zod), so a thrown Zod error is caught and returned as `{ status: "error" }`.
- Files: `src/chat-widgets/find-contact-action.ts` (lines 34–38)
- Current mitigation: Zod schema on the facade layer acts as a second gate; the error is caught and returned rather than surfaced.
- Recommendations: The defense-in-depth is adequate, but document that `isValidEmail` is a UX-level pre-check, not a security boundary.

**`roles: ["member"]` synthetic actor grant:**
- Risk: `buildPointerActor` and `buildPointerActorFromIds` in `src/mcp/module.ts` stamp `roles: ["member"]` on synthetic actors. If the kernel's cross-org guard is ever bypassed or misconfigured, this grant could allow a model-sourced actor to escalate to `member` permissions in an org it did not originally authenticate against.
- Files: `src/mcp/module.ts` (lines 50–56, 97–101)
- Current mitigation: The actor's `orgId`/`organizationId` is captured from the parent operation's validated request context; the kernel's cross-org guard checks resource `org_id` must match actor `organizationId`.
- Recommendations: Add a test that verifies `organizationId` is always set on the synthetic actor and equals the captured `orgId`; a missing `organizationId` would be the failure mode.

## Performance Bottlenecks

**Synchronous facade hydration on every Graphiti projection:**
- Problem: `twentyToGraphitiAdapter.export()` calls `crmFacade.contact.get()` or `crmFacade.account.get()` for every pointer row routed through the projector. If the outbox has a burst of CRM pointer rows (e.g. a bulk import), each row triggers a separate Twenty API round-trip.
- Files: `src/sync-adapters/twenty-to-graphiti-adapter.ts` (lines 143–148)
- Cause: No batching or caching; each `export()` call is independent.
- Improvement path: Add a short-lived in-memory cache keyed on `external_id` with a TTL of ~1 minute to deduplicate repeated hydration calls for the same record during burst processing.

## Fragile Areas

**Dual-boot registration requirement (MCP server + BullMQ worker):**
- Files: `src/mcp/module.ts` (lines 515–521), `src/index.ts` (lines 19–29), `src/sync-adapters/twenty-to-graphiti-adapter.ts` (lines 200–211)
- Why fragile: Both `registerCrmObjectTypes()` and `registerCrmObjectSyncAdapters()` must be called at BullMQ worker boot before `processProjectionOutbox()` runs. If the worker boot sequence changes or a new worker type is added, omitting either call causes silent classification misses (falls through to LLM classification) or adapter routing failures.
- Safe modification: Always call both functions together; the `cold-worker regression` test in `src/__tests__/pointer-write-repair.test.ts` (line 248) guards the barrel export contract but does not guard the worker call sequence itself.
- Test coverage: Barrel export is tested; actual worker boot ordering is not tested in this repo (tested only in the host monorepo's integration tests).

**`main` and `types` both point to source `.ts` file:**
- Files: `package.json` (lines 5–6)
- Why fragile: `"main": "./src/index.ts"` and `"types": "./src/index.ts"` point directly to TypeScript source. This package is not built/published standalone (it's a source mirror consumed by the monorepo workspace). If a consumer ever tries to resolve it as a published package (e.g. in a standalone integration test), there is no compiled output to load.
- Safe modification: This is intentional for the monorepo-embedded pattern but must not be changed without updating the host monorepo's module resolution.

**Type-ID strings are persisted in the database and must never change:**
- Files: `src/integration/register-object-types.ts` (lines 37–39, comment on lines 26–28), `src/sync-adapters/twenty-to-graphiti-adapter.ts` (lines 37–40)
- Why fragile: `@cinatra-ai/entity-accounts:account`, `@cinatra-ai/entity-contacts:contact`, and `@cinatra-ai/lists:list` are persisted in `cinatra.objects.type`. Any rename requires a data migration; there is no runtime guard that would detect a mismatch.
- Safe modification: Treat these strings as immutable constants. Any refactor must be accompanied by a migration script and verified against the cutover script's `CRM_TYPE_IDS`.

## Scaling Limits

**BullMQ pointer-repair queue depth:**
- Current capacity: 5 retry attempts with exponential backoff starting at 30 seconds (max ~16 minutes total retry window).
- Limit: If both Postgres and Redis are degraded for longer than the retry window, the repair job is exhausted and the pointer row is permanently stranded (the only recovery is the `[POINTER_REPAIR_FALLBACK]` stderr log).
- Scaling path: Increase `attempts` or add a dead-letter queue with manual replay tooling that consumes the `POINTER_REPAIR_FALLBACK` log lines.

## Dependencies at Risk

**`zod` at `^4.4.3` (Zod v4):**
- Risk: Zod v4 is a major version with breaking changes from v3. If any peer dependency or SDK package pins Zod v3, there can be incompatible schema instances passed between boundaries (Zod instances do not interoperate across major versions).
- Impact: Silent runtime failures if a schema object created by a v3-linked package is passed to a v4 validation call.
- Migration plan: Ensure `@cinatra-ai/sdk-extensions` and all host packages use the same Zod major version; add a deduplication check in the monorepo lockfile.

**`radix-ui` at `^1.4.3` (newer monolithic package):**
- Risk: `radix-ui` (the monolithic package) is distinct from the older `@radix-ui/*` scoped packages. The vendored shadcn UI components in `src/components/ui/` may have been generated against `@radix-ui/*` primitives, not the monolithic `radix-ui` package.
- Files: `src/components/ui/` (all component files)
- Impact: If the vendored components import from `@radix-ui/*` scoped packages but only `radix-ui` is in `dependencies`, tree-shaking and peer resolution could fail in the host app's build.
- Migration plan: Audit each component in `src/components/ui/` to confirm imports match the declared dependency.

## Missing Critical Features

**No list-object Graphiti projection:**
- Problem: `registerListObjectType()` in `src/integration/register-object-types.ts` registers the `@cinatra-ai/lists:list` type but `twentyToGraphitiAdapter`'s `SUPPORTED_TYPES` only includes accounts and contacts. List pointer rows written via `crm_list_create` are never projected to Graphiti.
- Blocks: Graphiti-grounded LLM workflows cannot discover or reference CRM lists by semantic search.

**No instance-aware provider resolution:**
- Problem: The facade's `resolveProvider()` ignores `instanceId` and always returns the single registered provider. Multi-tenant deployments with different CRM providers per workspace cannot be supported.
- Blocks: Any future provider beyond Twenty (e.g. HubSpot, Salesforce) would require forking the facade logic rather than registering a second provider.

## Test Coverage Gaps

**BullMQ worker boot sequence:**
- What's not tested: The actual call sequence `registerCrmObjectTypes()` + `registerCrmObjectSyncAdapters()` before `writePointerByType()` in the worker process is not tested in this repo.
- Files: `src/__tests__/pointer-write-repair.test.ts`
- Risk: A future worker refactor that reorders or skips registration calls would not be caught until integration testing in the host monorepo.
- Priority: Medium

**List primitive handlers (crm_list_*):**
- What's not tested: None of the six list primitives (`crm_list_search`, `crm_list_get`, `crm_list_create`, `crm_list_members_get`, `crm_list_member_add`, `crm_list_member_remove`) registered in `src/mcp/module.ts` have unit tests.
- Files: `src/mcp/module.ts` (lines 444–504)
- Risk: Input validation (Zod parsing), facade call routing, and JSON result shape for list operations are all untested.
- Priority: High

**Multi-provider registration and fallback:**
- What's not tested: Behavior of `resolveProvider()` when zero providers are registered (should throw), or when two providers are registered (returns first match from hardcoded list).
- Files: `src/facade.ts`, `src/__tests__/contract-shape.test.ts`
- Risk: Registering a second provider accidentally would silently shadow it; the error message on zero providers is only validated in `contract-shape.test.ts` via the registry, not the facade throw path.
- Priority: Low

**Graphiti projection of account pointer rows with null orgId:**
- What's not tested: The adapter's `composeEpisodeBody` for accounts when `object.orgId` is null and `hydrated.inLists` / `hydrated.apolloOrganizationId` are absent. The contact null-orgId path is tested (`src/__tests__/twenty-to-graphiti-adapter.test.ts` line 218) but the account equivalent is not.
- Files: `src/__tests__/twenty-to-graphiti-adapter.test.ts`
- Risk: An account-type projection with null orgId and missing optional fields could produce a malformed episode body.
- Priority: Low

---

*Concerns audit: 2026-06-09*
