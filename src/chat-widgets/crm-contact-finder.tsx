"use client";

import { useImperativeHandle, useState } from "react";
import { MailIcon } from "lucide-react";
import { WidgetShell, type WidgetProps } from "@cinatra-ai/sdk-ui";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import { StatusPill, type StatusPillStatus } from "@cinatra-ai/sdk-ui/marketplace";
import {
  findContactByEmailAction,
  type ContactFinderResult,
} from "./find-contact-action";

// CRM-connector chat widget — find an existing CRM contact by email.
//
// Read-only path through the provider-agnostic CRM facade
// (`crm_contact_find_by_email`). Replaces the legacy entity-contacts
// "Create contact" widget; CRM mutations now go through agent dispatch
// (chat allowlist denies `crm_contact_create`), so this widget is the
// chat's window into the CRM contact substrate for lookup + follow-up
// flow seeding.
//
// On success: calls `onSave({ contactId, name, email, accountId, ... })`
// so a chat continuation can wire the found contact into a follow-up
// (e.g. add to list, draft outreach).

type StatusState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "found"; result: Extract<ContactFinderResult, { status: "found" }> }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

function tonesFor(state: StatusState): {
  label: string;
  status: StatusPillStatus;
} {
  switch (state.kind) {
    case "idle":
      return { label: "Ready", status: "idle" };
    case "loading":
      return { label: "Looking up…", status: "running" };
    case "found":
      return { label: "Found", status: "approved" };
    case "not_found":
      return { label: "Not found", status: "needs-review" };
    case "error":
      return { label: "Error", status: "failed" };
  }
}

export function CrmContactFinderWidget({ onSave, submitRef }: WidgetProps) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<StatusState>({ kind: "idle" });

  async function runLookup(): Promise<boolean> {
    if (!email.trim()) {
      setState({ kind: "error", message: "Email is required." });
      return false;
    }
    setState({ kind: "loading" });
    try {
      const fd = new FormData();
      fd.set("email", email.trim());
      const result = await findContactByEmailAction(fd);
      if (result.status === "found") {
        setState({ kind: "found", result });
        if (onSave) {
          onSave({
            contactId: result.contactId,
            name: result.name,
            email: result.email,
            title: result.title,
            accountId: result.accountId,
          });
        }
        return true;
      }
      if (result.status === "not_found") {
        setState({ kind: "not_found" });
        return false;
      }
      setState({ kind: "error", message: result.message });
      return false;
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Lookup failed.",
      });
      return false;
    }
  }

  useImperativeHandle(submitRef, () => ({
    submit: () => runLookup(),
  }));

  const pill = tonesFor(state);

  return (
    <WidgetShell
      label="Find contact by email"
      loading={state.kind === "loading"}
      error={state.kind === "error" ? state.message : null}
    >
      <div className="grid gap-4 rounded-panel border border-line bg-surface-strong p-4">
        <p className="text-sm font-semibold text-foreground">
          Find contact by email
        </p>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="crm-contact-finder-email">Email</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <MailIcon className="size-4" aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                id="crm-contact-finder-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="jane@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runLookup();
                  }
                }}
                disabled={state.kind === "loading"}
              />
            </InputGroup>
            <FieldDescription>
              Looks up an existing contact in the CRM via the provider-agnostic
              facade. To create a new contact, dispatch the contact-discovery
              or apollo-prospecting agent instead.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <div className="flex items-center justify-between gap-2">
          <StatusPill status={pill.status}>{pill.label}</StatusPill>
        </div>
        {state.kind === "found" && (
          <div className="grid gap-2 rounded-control border border-line bg-surface p-3 text-sm">
            <div className="font-medium text-foreground">
              {state.result.name || "(no name on file)"}
            </div>
            <div className="text-muted-foreground">{state.result.email}</div>
            {state.result.title ? (
              <div className="text-muted-foreground">{state.result.title}</div>
            ) : null}
          </div>
        )}
        {state.kind === "not_found" && (
          <div className="rounded-control border border-line bg-surface p-3 text-sm text-muted-foreground">
            No CRM contact matches that email. Dispatch the contact-discovery
            agent to create one.
          </div>
        )}
      </div>
    </WidgetShell>
  );
}
