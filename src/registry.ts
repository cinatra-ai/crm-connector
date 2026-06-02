// Provider-agnostic CRM provider registry — RELOCATED into
// @cinatra-ai/sdk-extensions in the connector→SDK decouple (the Map is now
// anchored on a globalThis Symbol there so the facade lookup and the provider
// extensions' boot-time registration share one instance without importing each
// other). This file re-exports the SDK registry so crm-connector's facade keeps
// importing `./registry` unchanged.

export {
  registerCrmProvider,
  lookupCrmProvider,
  listCrmProviders,
  _resetCrmProviderRegistry,
} from "@cinatra-ai/sdk-extensions";
