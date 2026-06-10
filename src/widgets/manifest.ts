import type { WidgetManifest } from "@cinatra-ai/sdk-ui";

// Chat-widget manifest for the CRM connector — PURE DATA, no React imports.
// The host loads this module from server bundles that are NOT React render
// boundaries (e.g. the chat API route's wizard-manifest registry) via
// `@cinatra-ai/crm-connector/widgets/manifest`, so it must never pull the
// component graph. The component-bearing `./index` module is loaded only by
// the host's RSC chat mount.

export const crmContactFinderManifest: WidgetManifest = {
  id: "crm-connector",
  description:
    "Use when the user wants to find an existing CRM contact by email.",
};
