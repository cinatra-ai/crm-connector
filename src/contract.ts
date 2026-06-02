// Provider-agnostic CRM contract — RELOCATED into @cinatra-ai/sdk-extensions in
// the connector→SDK decouple. This file re-exports the SDK contract so
// crm-connector's internal modules keep importing `./contract` unchanged, while
// CRM provider extensions (twenty-connector) import the same types from the SDK
// directly (no crm-connector ↔ provider coupling).

export type {
  CrmConnectorId,
  CrmContact,
  CrmAccount,
  CrmList,
  CrmListMembership,
  CrmConnector,
} from "@cinatra-ai/sdk-extensions";
