import "server-only";

import type { CrmConnector, CrmContact, CrmAccount, CrmList, CrmListMembership } from "./contract";
import { lookupCrmProvider } from "./registry";

// The facade resolves the active provider for the calling instance. Today
// there is exactly one provider (twenty); the indirection exists for
// provider-agnostic naming across multiple CRM providers.
//
// The facade resolves provider by the instance's `provider_id` connector_config
// row. Today every CRM op resolves to "twenty" (only registered provider); the
// resolver does not yet look up `provider_id` per connector_instance.

function resolveProvider(_instanceId?: string): CrmConnector {
  // Single-provider path. The instance-aware resolver is not yet wired (only
  // one provider is registered today).
  const providers = ["twenty"];
  for (const id of providers) {
    const p = lookupCrmProvider(id);
    if (p) return p;
  }
  throw new Error(
    "[crm-connector] no CRM provider registered. Call registerTwentyProvider() at boot via src/lib/register-crm-providers.ts.",
  );
}

export const crmFacade = {
  contact: {
    search: (input: { query: string; limit?: number }, instanceId?: string): Promise<CrmContact[]> =>
      resolveProvider(instanceId).searchContacts(input),
    get: (input: { id: string }, instanceId?: string): Promise<CrmContact | null> =>
      resolveProvider(instanceId).getContact(input),
    create: (input: Omit<CrmContact, "id" | "cinatraObjectId">, instanceId?: string): Promise<CrmContact> =>
      resolveProvider(instanceId).createContact(input),
    update: (input: { id: string; patch: Partial<CrmContact> }, instanceId?: string): Promise<CrmContact> =>
      resolveProvider(instanceId).updateContact(input),
    findByEmail: (input: { email: string }, instanceId?: string): Promise<CrmContact | null> =>
      resolveProvider(instanceId).findContactByEmail(input),
  },
  account: {
    search: (input: { query: string; limit?: number }, instanceId?: string): Promise<CrmAccount[]> =>
      resolveProvider(instanceId).searchAccounts(input),
    get: (input: { id: string }, instanceId?: string): Promise<CrmAccount | null> =>
      resolveProvider(instanceId).getAccount(input),
    create: (input: Omit<CrmAccount, "id" | "cinatraObjectId">, instanceId?: string): Promise<CrmAccount> =>
      resolveProvider(instanceId).createAccount(input),
    update: (input: { id: string; patch: Partial<CrmAccount> }, instanceId?: string): Promise<CrmAccount> =>
      resolveProvider(instanceId).updateAccount(input),
  },
  list: {
    search: (input: { query: string; objectType?: "contact" | "account" }, instanceId?: string): Promise<CrmList[]> =>
      resolveProvider(instanceId).searchLists(input),
    get: (input: { id: string }, instanceId?: string): Promise<CrmList | null> =>
      resolveProvider(instanceId).getList(input),
    create: (input: Omit<CrmList, "id">, instanceId?: string): Promise<CrmList> =>
      resolveProvider(instanceId).createList(input),
    membersGet: (
      input: { listId: string; limit?: number },
      instanceId?: string,
    ): Promise<{ contactIds: string[]; accountIds: string[] }> =>
      resolveProvider(instanceId).getListMembers(input),
    memberAdd: (input: CrmListMembership, instanceId?: string): Promise<void> =>
      resolveProvider(instanceId).addListMember(input),
    memberRemove: (input: CrmListMembership, instanceId?: string): Promise<void> =>
      resolveProvider(instanceId).removeListMember(input),
  },
};
