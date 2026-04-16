# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-file Node.js CLI that uses Playwright (Chromium) to flip a Salesforce sandbox's email deliverability setting to "All email". Published to npm as `sf-email-deliverability-automation`; binary `sf-email-deliverability` maps to `enable-email-deliverability.js`. Node >= 16.

## Common commands

```bash
npm install
npx playwright install chromium         # required once before first run

# Run locally (headless)
node enable-email-deliverability.js --sandbox-url "<frontdoor.jsp URL>"

# Debug visually
node enable-email-deliverability.js --sandbox-url "<url>" --headed

# Tuning knobs
node enable-email-deliverability.js --sandbox-url "<url>" --timeout 120000 --retries 3
```

No test suite exists — `npm test` is a no-op that exits 0. Publishing is automated: creating a GitHub release triggers `.github/workflows/npm-publish.yml`, which runs `npm ci` + `npm test` then `npm publish` using the `npm_token` secret.

## Architecture

Everything lives in `enable-email-deliverability.js` (~187 lines). Key design choices a future edit needs to respect:

1. **Direct navigation over UI clicking.** The script appends `retURL=/lightning/setup/OrgEmailSettings/home` to the provided authenticated `frontdoor.jsp` URL (`buildDeliverabilityUrl`) and `waitForURL('**/lightning/setup/OrgEmailSettings/home')` to ride through SSO/Lightning redirects. Do not add gear-icon/setup-search navigation — it would re-introduce the flakiness this approach eliminates.

2. **Classic iframe inside Lightning.** The deliverability form is a Salesforce Classic page rendered in an iframe whose title contains "Deliverability" (partial match tolerates edition differences). All form interaction goes through `page.frameLocator('iframe[title*="Deliverability"]')` — the dropdown, save button, and success panel are not in the top-level DOM.

3. **Stable Visualforce IDs are the contract.** The code targets four IDs inside the iframe, with colons escaped for CSS selectors:
   - dropdown: `#thePage:theForm:editBlock:sendEmailAccessControlSection:sendEmailAccessControl:sendEmailAccessControlSelect`
   - SPF substitute-domain checkbox: `#thePage:theForm:editBlock:spfSection:substituteEmailDomain:cbSubstituteEmailDomain`
   - save: `#thePage:theForm:editBlock:buttons:saveBtn`
   - success panel: `#thePage:theForm:successMessagePanel`
   Dropdown value `'2'` means "All email" (`EMAIL_DELIVERABILITY.ALL_EMAIL`). The SPF checkbox must be `:checked` at Save time — the script reads `isChecked()` and calls `check()` only when needed so CI logs show whether a run enforced the setting or merely confirmed it. Both changes commit under one Save. Success is detected by the panel becoming visible — do not switch to a text match, that would break across locales.

4. **`withRetry` wraps the whole nav+iframe-attach step**, not individual clicks. Retries use exponential backoff starting at 1s. Default is 5 retries, so worst case ~31s of backoff on top of the per-attempt timeout.

5. **URL redaction.** `redactUrl` strips everything after `origin` before logging because `frontdoor.jsp` URLs contain session tokens. Any new logging that touches the sandbox URL must go through this helper.

6. **Exit codes matter.** `process.exit(0)` on success, `process.exit(1)` on any failure — the script is meant to be called from CI/CD shell wrappers. Keep the `browser.close()` in the catch block so failures don't leak Chromium processes.

## When Salesforce breaks this

If the script starts failing after a Salesforce release, the likely culprits in order are: (a) iframe title changed, (b) Visualforce IDs changed, (c) the `retURL` path changed. Run with `--headed` to see which step hangs, then update selectors in `enable-email-deliverability.js` — there is no abstraction layer to update elsewhere.
