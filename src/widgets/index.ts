import type { WidgetDefinition, WidgetManifest } from "@cinatra-ai/sdk-ui";
import { CrmContactFinderWidget } from "../chat-widgets/crm-contact-finder";

// Chat-widget manifest + registry for the CRM connector. Mounted by the
// host app via `@cinatra-ai/crm-connector/widgets`. The single widget,
// `crm-connector.contact-finder`, performs a read-only lookup of an
// existing CRM contact by email; CRM mutations (create/update) are not
// available through the chat token (deny-by-default).

export const crmContactFinderManifest: WidgetManifest = {
  id: "crm-connector",
  description:
    "Use when the user wants to find an existing CRM contact by email.",
};

export const crmConnectorWidgets: WidgetDefinition[] = [
  {
    id: "crm-connector.contact-finder",
    label: "Find contact by email",
    component: CrmContactFinderWidget,
  },
];

export { CrmContactFinderWidget };
