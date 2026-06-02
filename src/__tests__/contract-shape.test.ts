import { describe, it, expect } from "vitest";

import {
  registerCrmProvider,
  lookupCrmProvider,
  _resetCrmProviderRegistry,
} from "../registry";
import type { CrmConnector } from "../contract";

describe("crm-connector facade — contract shape", () => {
  it("registers + looks up a provider by providerId", () => {
    _resetCrmProviderRegistry();
    const stub: CrmConnector = {
      providerId: "stub",
      searchContacts: async () => [],
      getContact: async () => null,
      createContact: async (input) => ({ id: "stub-1", ...input }),
      updateContact: async (input) => ({ id: input.id, name: "stub" }),
      findContactByEmail: async () => null,
      searchAccounts: async () => [],
      getAccount: async () => null,
      createAccount: async (input) => ({ id: "stub-a", ...input }),
      updateAccount: async (input) => ({ id: input.id, name: "stub" }),
      searchLists: async () => [],
      getList: async () => null,
      createList: async (input) => ({ id: "stub-l", ...input }),
      getListMembers: async () => ({ contactIds: [], accountIds: [] }),
      addListMember: async () => {},
      removeListMember: async () => {},
    };
    registerCrmProvider(stub);
    expect(lookupCrmProvider("stub")?.providerId).toBe("stub");
    expect(lookupCrmProvider("nonexistent")).toBeNull();
  });

  it("returns null when the looked-up provider isn't registered", () => {
    _resetCrmProviderRegistry();
    expect(lookupCrmProvider("twenty")).toBeNull();
  });
});
