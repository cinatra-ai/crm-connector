"use server";

import "server-only";

import { getCrmDeps } from "../deps";
import { crmFacade } from "../facade";
import type { CrmContact } from "../contract";

// Deterministic server action backing `<CrmContactFinderWidget>`. The widget
// (a chat widget) submits an email; the action verifies the caller has an
// authenticated session, then resolves the contact via the
// provider-agnostic CRM facade (`crm_contact_find_by_email`) and returns
// the resolved row OR `null`.
//
// Deterministic — no chat / no LLM. The first step is an explicit actor
// gate: `getCrmDeps().getActor()` (the host `authSession` port, bound by
// this connector's register(ctx) — a "use server" action cannot close over
// ctx, hence the deps slot; cinatra#172 Stage H1). `getActor()` is
// non-throwing and resolves `null` for a genuinely unauthenticated caller
// across cookie / MCP / worker / A2A contexts; the null-check maps to the
// same typed error envelope the previous cookie-only `requireAuthSession()`
// gate produced. The gate matters: the Twenty provider resolves the
// workspace row + bearer server-side, so an unauthenticated request would
// otherwise hit Twenty with the cinatra-app-side credentials.
// Returns a small projection of the CrmContact shape so the client
// island can render result chrome without server-only types leaking
// client-side.
export type ContactFinderResult =
  | {
      status: "found";
      contactId: string;
      name: string;
      email: string;
      title: string;
      accountId: string;
    }
  | { status: "not_found" }
  | { status: "error"; message: string };

function isValidEmail(email: string): boolean {
  // The CRM facade's Zod schema validates with z.string().email(), but
  // returning a typed error envelope is friendlier than letting the
  // throw bubble up to the client.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function findContactByEmailAction(
  formData: FormData,
): Promise<ContactFinderResult> {
  const actor = await getCrmDeps().getActor();
  if (!actor) {
    return { status: "error", message: "Not authenticated." };
  }

  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { status: "error", message: "Email is required." };
  }
  if (!isValidEmail(email)) {
    return { status: "error", message: "Email format looks invalid." };
  }

  try {
    const contact: CrmContact | null = await crmFacade.contact.findByEmail({
      email,
    });
    if (!contact) return { status: "not_found" };
    return {
      status: "found",
      contactId: contact.id,
      name: contact.name ?? "",
      email: contact.email ?? "",
      title: contact.title ?? "",
      accountId: contact.accountId ?? "",
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Lookup failed.",
    };
  }
}
