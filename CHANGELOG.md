# Changelog

All notable changes to this project are documented here, derived from the
project's merged pull request and release-tag history.

## v0.1.1 — 2026-06-13

- refactor: adopt ctx.authSession + ctx.jobs host ports via a deps slot (#16)
- ci(release): grant contents: write + pin reusable workflow to .github HEAD (#17)
- ci: repin reusable release workflow (immutable-safe decoration + corrected build-input provisioning) (#18)
- release: crm-connector v0.1.1 (republish on corrected serverEntry build pipeline) (#19)

## v0.1.0 — 2026-06-03

- Initial release.

## Unreleased

- fix(test): crm-contact-finder asserts the real extension import paths (../components/ui + @cinatra-ai/sdk-ui) (#1)
- ci: adopt source-leak-gate (#2)
- ci: adopt source-leak-gate (#3)
- chore: add .gitignore (#4)
- ci: adopt org gates — SHA-pin all remote uses: refs, bump source-leak-gate to v0.1.0, add actions-pinned + gitignore gate callers (#5)
- chore: keep internal planning notes untracked (#6)
- Split the chat-widget manifest into a pure-data module (widgets/manifest.ts) (#7)
- Add package exports map for the consumed subpaths (incl. ./widgets/manifest) (#8)
- chore: npm files allowlist + export-ignore packaging hygiene (#9)
- ci: adopt the org ui-design-system gate (#10)
- serverEntry register(ctx): expose the CRM integration surfaces as capabilities (cinatra#7 P721) (#11)
- fix(tests): type the saveObject mock parameter (host tsgo strictness) (#12)
- feat: register the crm-list-reader capability surface (#13)
- chore: Configure Renovate (#14)
- ci: add truthful-attribution-gate in WARN (advisory) mode (#20)
- ci: adopt the reusable extension->host IoC conformance gate (org-wide rollout) (#21)
- ci: tag-driven GitHub release on v* (#22)
- ci: adopt secret-scan-gate (#23)
- docs(readme): expand README to the org standard (#24) (#25)
- ci(ui-gate): ramp raw-JSX block to error (#26)
- ci: adopt source-leak-gate (#27)
- ci: adopt source-leak-gate (#28)
- ci(ui-gate): re-vendor preset with Block-C (dynamic-import ban) + bump pin to v0.1.1 (#29)
- chore: strip private engineering-tracker refs from public source (#30)
- chore: strip private tracker references from workflow comments (#33)
- chore(manifest): backfill cinatra.sdkAbiRange "^2" (#34)
- ci(release): pin reusable-extension-release to gated v0.1.1 (release-approval wall) (#35)
- chore: add cinatra.vendor and displayName connector metadata (#36)
- chore(deps): declare cinatra.consumes for closure-gate enrollment (#37)

