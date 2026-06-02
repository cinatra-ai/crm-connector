// Source-text contract test for the CRM-connector chat widget. Same shape
// as the data-safety source-pin tests — assertion-only, no React rendering.
//
// Pins:
//   - widget registry source exports crmContactFinderManifest +
//     crmConnectorWidgets with the expected ids/labels
//   - widget uses shadcn primitives (Input via InputGroupInput, no raw
//     <input>), StatusPill for state surface, FieldGroup/Field/FieldLabel
//   - widget consumes the deterministic findContactByEmailAction (no
//     /api/chat round-trip; not subject to SSE parsing)
//   - widget calls onSave with the full contact projection
//   - server action calls crmFacade.contact.findByEmail and returns a
//     typed ContactFinderResult discriminated union
//   - no emojis anywhere
//
// This test is intentionally source-text-only (no runtime module load) so
// the package-local vitest sandbox doesn't need to resolve `@/components/*`
// (which lives in the host app's src/). The full type-check happens via
// the root `pnpm typecheck` (tsgo) which DOES resolve `@/` against the
// app's tsconfig paths.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const WIDGET_SRC = readFileSync(
  "src/chat-widgets/crm-contact-finder.tsx",
  "utf-8",
);
const ACTION_SRC = readFileSync(
  "src/chat-widgets/find-contact-action.ts",
  "utf-8",
);
const REGISTRY_SRC = readFileSync(
  "src/widgets/index.ts",
  "utf-8",
);

describe("CRM-connector widget registry source", () => {
  it("exports the contact-finder manifest with the expected id", () => {
    expect(REGISTRY_SRC).toMatch(/crmContactFinderManifest/);
    expect(REGISTRY_SRC).toMatch(/id: "crm-connector"/);
  });

  it("exports crmConnectorWidgets containing the contact-finder widget", () => {
    expect(REGISTRY_SRC).toMatch(/crmConnectorWidgets/);
    expect(REGISTRY_SRC).toMatch(/id: "crm-connector\.contact-finder"/);
    expect(REGISTRY_SRC).toMatch(/label: "Find contact by email"/);
    expect(REGISTRY_SRC).toMatch(/component: CrmContactFinderWidget/);
  });

  it("registry file re-exports the widget component (single source of truth)", () => {
    expect(REGISTRY_SRC).toMatch(/CrmContactFinderWidget/);
    expect(REGISTRY_SRC).toMatch(/from "\.\.\/chat-widgets\/crm-contact-finder"/);
  });
});

describe("CrmContactFinderWidget source contract", () => {
  it("exports the widget function from its source file", () => {
    expect(WIDGET_SRC).toMatch(/export function CrmContactFinderWidget\(/);
  });

  it("declares 'use client' at the top", () => {
    expect(WIDGET_SRC.split("\n")[0]).toMatch(/^"use client"/);
  });

  it("composes the canonical shadcn primitives — no raw <input>", () => {
    expect(WIDGET_SRC).toMatch(/from "@\/components\/ui\/field"/);
    expect(WIDGET_SRC).toMatch(/from "@\/components\/ui\/input-group"/);
    expect(WIDGET_SRC).toMatch(/from "@\/components\/ui\/status-pill"/);
    expect(WIDGET_SRC).toMatch(/<FieldGroup>/);
    expect(WIDGET_SRC).toMatch(/<Field>/);
    expect(WIDGET_SRC).toMatch(/<FieldLabel/);
    expect(WIDGET_SRC).toMatch(/<FieldDescription>/);
    expect(WIDGET_SRC).toMatch(/<InputGroup>/);
    expect(WIDGET_SRC).toMatch(/<InputGroupInput\s/);
    expect(WIDGET_SRC).toMatch(/<StatusPill\s/);
    // Negative: no raw <input> JSX (lowercase tag) — must use InputGroupInput.
    expect(WIDGET_SRC).not.toMatch(/<input\s/);
  });

  it("uses semantic tokens — no bg-white / text-gray-* / text-slate-*", () => {
    expect(WIDGET_SRC).not.toMatch(/\bbg-white\b/);
    expect(WIDGET_SRC).not.toMatch(/\btext-gray-\d+/);
    expect(WIDGET_SRC).not.toMatch(/\btext-slate-\d+/);
  });

  it("consumes the deterministic server action — no /api/chat SSE round-trip", () => {
    expect(WIDGET_SRC).toMatch(/findContactByEmailAction/);
    expect(WIDGET_SRC).not.toMatch(/fetch\("\/api\/chat"/);
  });

  it("calls onSave with the full contact projection on found", () => {
    // The widget must surface contactId + name + email + accountId so a
    // chat continuation can wire the found contact into a follow-up flow.
    expect(WIDGET_SRC).toMatch(/onSave\({/);
    expect(WIDGET_SRC).toMatch(/contactId: result\.contactId/);
    expect(WIDGET_SRC).toMatch(/name: result\.name/);
    expect(WIDGET_SRC).toMatch(/email: result\.email/);
    expect(WIDGET_SRC).toMatch(/accountId: result\.accountId/);
  });

  it("StatusPill is used for connection state — no inline color classes", () => {
    expect(WIDGET_SRC).toMatch(/<StatusPill\s+status=\{pill\.status\}>/);
    // No hand-rolled status pill with raw color classes.
    expect(WIDGET_SRC).not.toMatch(/bg-(red|green|blue|amber|yellow)-/);
  });

  it("no emojis in source", () => {
    expect(WIDGET_SRC).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe("findContactByEmailAction source contract", () => {
  it("declares 'use server' and 'server-only'", () => {
    expect(ACTION_SRC).toMatch(/^"use server";/);
    expect(ACTION_SRC).toMatch(/import "server-only"/);
  });

  it("calls requireAuthSession BEFORE the CRM facade lookup", () => {
    expect(ACTION_SRC).toMatch(/from "@\/lib\/auth-session"/);
    expect(ACTION_SRC).toMatch(/await requireAuthSession\(\)/);
    // Order check: the auth gate's `await` MUST appear before any
    // `crmFacade.contact.findByEmail` call in the action body.
    const gateIdx = ACTION_SRC.indexOf("await requireAuthSession()");
    const lookupIdx = ACTION_SRC.indexOf("crmFacade.contact.findByEmail");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(lookupIdx).toBeGreaterThan(gateIdx);
  });

  it("routes through the provider-agnostic CRM facade", () => {
    expect(ACTION_SRC).toMatch(/crmFacade\.contact\.findByEmail/);
    // Negative: do not depend on the retired `objects_*` heavy-field path.
    expect(ACTION_SRC).not.toMatch(/objects_list/);
    expect(ACTION_SRC).not.toMatch(/objects_save/);
    expect(ACTION_SRC).not.toMatch(/contacts_get\b/);
  });

  it("returns a typed discriminated union for found/not_found/error", () => {
    expect(ACTION_SRC).toMatch(/type ContactFinderResult\s*=/);
    expect(ACTION_SRC).toMatch(/status: "found"/);
    expect(ACTION_SRC).toMatch(/status: "not_found"/);
    expect(ACTION_SRC).toMatch(/status: "error"/);
  });

  it("validates the email shape before calling the facade", () => {
    expect(ACTION_SRC).toMatch(/isValidEmail/);
  });
});
