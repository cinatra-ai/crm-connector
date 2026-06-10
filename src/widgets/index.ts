import type { WidgetDefinition } from "@cinatra-ai/sdk-ui";
import { CrmContactFinderWidget } from "../chat-widgets/crm-contact-finder";

// Chat-widget registry for the CRM connector. Loaded by the host app's RSC
// chat mount via `@cinatra-ai/crm-connector/widgets`. The single widget,
// `crm-connector.contact-finder`, performs a read-only lookup of an
// existing CRM contact by email; CRM mutations (create/update) are not
// available through the chat token (deny-by-default).
//
// The widget MANIFEST lives in `./manifest` (pure data, no React) so server
// surfaces that only need metadata never import the component graph; it is
// re-exported here for compatibility.

export { crmContactFinderManifest } from "./manifest";

export const crmConnectorWidgets: WidgetDefinition[] = [
  {
    id: "crm-connector.contact-finder",
    label: "Find contact by email",
    component: CrmContactFinderWidget,
  },
];

export { CrmContactFinderWidget };
