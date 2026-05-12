# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-file Node.js CLI that uses Playwright (Chromium) to flip a Salesforce sandbox's email deliverability setting to "All email". Published to npm as `sf-email-deliverability-automation`; binary `sf-email-deliverability` maps to `enable-email-deliverability.js`. Node >= 16.

## Common commands

```bash
npm install                              # auto-runs `playwright install chromium` via postinstall
# Fallback if postinstall was skipped (e.g. --ignore-scripts):
# npx playwright install chromium

# Run locally (headless)
node enable-email-deliverability.js --sandbox-url "<frontdoor.jsp URL>"

# Debug visually
node enable-email-deliverability.js --sandbox-url "<url>" --headed

# Tuning knobs
node enable-email-deliverability.js --sandbox-url "<url>" --timeout 120000 --retries 3
```

No test suite exists — `npm test` is a no-op that exits 0. Publishing is automated: creating a GitHub release triggers `.github/workflows/npm-publish.yml`, which runs `npm ci` + `npm test` then `npm publish` using the `npm_token` secret.

## Architecture

Everything lives in `enable-email-deliverability.js` (~275 lines). Key design choices a future edit needs to respect:

1. **Direct navigation over UI clicking.** The script appends a `retURL` query param to the provided authenticated `frontdoor.jsp` URL via `buildSetupUrl(sandboxUrl, setupPath)` and `waitForURL('**'+setupPath)` to ride through SSO/Lightning redirects. Used for both the deliverability page (`/lightning/setup/OrgEmailSettings/home`) and the Email Domain Filter page (`/lightning/setup/EmailDomainFilter/home`). Do not add gear-icon/setup-search navigation — it would re-introduce the flakiness this approach eliminates.

2. **Classic iframe inside Lightning.** Both target pages are Salesforce Classic pages rendered in iframes. Interaction goes through `page.frameLocator('iframe[title*="..."]')` — form fields, list tables, and action links are not in the top-level DOM. Iframe title patterns: `"Deliverability"` and `"Email Domain Filter"` (partial match tolerates edition differences).

3. **Stable Visualforce IDs are the contract.** The code targets four IDs inside the iframe, with colons escaped for CSS selectors:
   - dropdown: `#thePage:theForm:editBlock:sendEmailAccessControlSection:sendEmailAccessControl:sendEmailAccessControlSelect`
   - Substitute email domain checkbox (under "Email Domain Verification" section): `#thePage:theForm:editBlock:domainAuthSection:substituteEmailDomain:cbSubstituteEmailDomain`
   - save: `#thePage:theForm:editBlock:buttons:saveBtn`
   - success panel: `#thePage:theForm:successMessagePanel`
   Dropdown value `'2'` means "All email" (`EMAIL_DELIVERABILITY.ALL_EMAIL`). The substitute-domain checkbox must be `:checked` at Save time — the script reads `isChecked()` and calls `check()` only when needed so CI logs show whether a run enforced the setting or merely confirmed it. Both changes commit under one Save. Success is detected by the panel becoming visible — do not switch to a text match, that would break across locales.

4. **`withRetry` wraps nav+iframe-attach only**, never individual clicks, and never the purge loop. Retries use exponential backoff starting at 1s. Default is 5 retries, so worst case ~31s of backoff on top of the per-attempt timeout. Both target pages go through `withRetry` for their nav+iframe-attach step.

5. **Email Domain Filter purge is opt-in and destructive.** Gated behind `--purge-domain-filters` (default `false`). Implemented in `purgeEmailDomainFilters(page)`. Registers a page-level `page.on('dialog', d => d.accept())` so Salesforce's native `confirm()` on "Del" is auto-accepted; `page.off` in a `finally` prevents handler leakage. Selectors inside the iframe:
   - row: `table.list tr.dataRow`
   - delete link: `a.actionLink[title^="Delete"]` (matched by `title` attribute, which stays English across locales, not by visible text)
   Loop: click first delete link → poll row count (main-page URL doesn't change; only the iframe navigates through `deleteredirect.jsp` and back) → repeat until zero. A safety cap of 50 iterations converts a potential runaway into a clear failure. Never GET-navigate to `deleteredirect.jsp` directly — the `_CONFIRMATIONTOKEN` param is session-scoped and rotates.

6. **URL redaction.** `redactUrl` strips everything after `origin` before logging because `frontdoor.jsp` URLs contain session tokens. Any new logging that touches the sandbox URL must go through this helper.

7. **Exit codes matter.** `process.exit(0)` on success, `process.exit(1)` on any failure — the script is meant to be called from CI/CD shell wrappers. Keep the `browser.close()` in the catch block so failures don't leak Chromium processes.

## When Salesforce breaks this

If the script starts failing after a Salesforce release, the likely culprits in order are: (a) iframe title changed, (b) Visualforce IDs changed, (c) the `retURL` path changed. Run with `--headed` to see which step hangs, then update selectors in `enable-email-deliverability.js` — there is no abstraction layer to update elsewhere.

## Known selector drifts (read before patching IDs)

Whenever a Visualforce ID selector breaks, before swapping in a new literal, read `features/*/incident.md` for prior drift history and the recommended smarter selector strategy. Current known incidents:

- `features/substitute-email-locator-bug/incident.md` — 2026-05-12: SF renamed the section `spfSection` → `domainAuthSection`. Captured DOM in the same folder. The note also proposes switching the four hard-coded IDs to `[id$="...stable-tail..."]` suffix matchers if drift happens again.

When a new drift is fixed, append a new `features/<short-bug-slug>/incident.md` (with captured HTML next to it) and add a one-line entry above. The goal: the next time Salesforce renames anything, the assistant sees this list, reads the relevant `incident.md`, and considers the smarter-selector path instead of just patching the literal.
