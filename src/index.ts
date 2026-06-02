// Public surface for @cinatra-ai/crm-connector.

export type {
  CrmConnector,
  CrmConnectorId,
  CrmContact,
  CrmAccount,
  CrmList,
  CrmListMembership,
} from "./contract";
export { registerCrmProvider, lookupCrmProvider, listCrmProviders } from "./registry";
export { crmFacade } from "./facade";
export { registerCrmConnectorPrimitives, writePointerByType } from "./mcp/module";
// CRM object-type registration is normally called via `createCrmModule()` at
// MCP-server boot. The BullMQ worker process boots independently and must
// register the same types before invoking `writePointerByType` so
// `objects_save`'s classifier fast-path (`objectTypeRegistry.resolve(typeHint)`)
// hits the static entry instead of falling through to the LLM classification
// path (which may fail in a worker without an LLM provider configured, or
// misclassify the minimal pointer row).
export { registerCrmObjectTypes } from "./integration/register-object-types";
// D8 — Twenty→Graphiti sync adapter registration. Re-exported here so the
// BullMQ worker boot path (src/lib/background-jobs.ts) can register the
// adapter into the shared registry before processProjectionOutbox runs;
// the MCP-server boot path registers the same adapter via createCrmModule().
export {
  registerCrmObjectSyncAdapters,
  twentyToGraphitiAdapter,
} from "./sync-adapters/twenty-to-graphiti-adapter";
