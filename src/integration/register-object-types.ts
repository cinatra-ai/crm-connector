import "server-only";

// Register object types via the SDK's host-injected objects provider
// (`requireObjectsProvider()`) — the host binds it to the real `objectTypeRegistry`
// at boot (src/lib/register-objects-provider.ts), so this connector imports ONLY
// `@cinatra-ai/sdk-extensions`, never `@cinatra-ai/objects`.
//
// The DEFINITIONS live in the dependency-light leaf
// `./object-type-definitions.ts` (shared with the serverEntry activation path,
// which registers the same definitions through the host-provided objects
// surface without value-importing a host peer). This module remains the
// SDK-slot registration path for the MCP-module/boot callers.

import { requireObjectsProvider, getObjectsProviderOrNull } from "@cinatra-ai/sdk-extensions";
import { CRM_OBJECT_TYPE_DEFINITIONS } from "./object-type-definitions";

/**
 * Register all three CRM object types (account / contact / list) so the
 * substrate can classify the pointer rows the CRM facade writes. Idempotent —
 * the host objects provider's `registerObjectType` is replace-by-id, so calling
 * this more than once (boot module + host registry warmer) is safe.
 */
export function registerCrmObjectTypes(): void {
  // The host objects provider isn't wired during `next build` page-data collection
  // (the binder runs from instrumentation, which doesn't execute at build) — skip;
  // the build-process registry is discarded anyway. At runtime boot + worker boot
  // the provider IS bound (Next.js runs instrumentation.register() before any route
  // handler / worker), so this registers the types where it matters.
  if (!getObjectsProviderOrNull()) return;
  const provider = requireObjectsProvider();
  for (const definition of CRM_OBJECT_TYPE_DEFINITIONS) {
    provider.registerObjectType(definition);
  }
}
