# Incident: substitute-email-domain checkbox selector drift

**Date observed:** 2026-05-12
**Symptom:** `enable-email-deliverability.js` hung for ~68s then failed with
`waiting for ... iframe[title*="Deliverability"] ... #thePage\:theForm\:editBlock\:spfSection\:substituteEmailDomain\:cbSubstituteEmailDomain to be visible`.

## Root cause

Salesforce renamed the section containing the substitute-domain checkbox from
**"SPF"** (`spfSection`) to **"Email Domain Verification"** (`domainAuthSection`).
The Visualforce ID path changed correspondingly. The stable suffix
`:substituteEmailDomain:cbSubstituteEmailDomain` was preserved — only the
ancestor section segment changed.

| | Old (pre-2026-05-12) | New |
|---|---|---|
| Section id segment | `spfSection` | `domainAuthSection` |
| Full checkbox id | `thePage:theForm:editBlock:spfSection:substituteEmailDomain:cbSubstituteEmailDomain` | `thePage:theForm:editBlock:domainAuthSection:substituteEmailDomain:cbSubstituteEmailDomain` |
| UI label of section | "SPF" | "Email Domain Verification" |

The captured DOM at the time of the rename is in `./new-html` (1 file, single-line
HTML). Search for `cbSubstituteEmailDomain` to find the exact attributes.

## Fix applied

Updated the hard-coded selector in `enable-email-deliverability.js:193` to the
new path. Log strings updated from "SPF substitute-domain checkbox" to
"Substitute email domain checkbox" (the "SPF" terminology is gone from the UI).

## Next time this drifts — try a smarter selector first

The hard-coded full-path ID is brittle by design: every Salesforce rebranding of
the surrounding section renames the middle of the id. Before patching the
literal string again, **try one of these locale- and section-agnostic selectors**:

1. **Suffix match on the stable tail.** The leaf names
   `:substituteEmailDomain:cbSubstituteEmailDomain` have survived this rename and
   are unlikely to churn — they describe the field itself, not its parent block.

   ```js
   const substituteDomainCheckboxSelector =
     'input[id$=":substituteEmailDomain:cbSubstituteEmailDomain"]';
   ```

   Playwright supports CSS `[attr$="..."]`. This survives any future
   `spfSection` → `domainAuthSection` → `whateverSection` rename without code
   changes.

2. **Name attribute, same tail.** The `name` attribute mirrors the `id` and the
   same suffix match works (`input[name$="..."]`). Useful as a cross-check.

3. **Avoid** matching on visible label text ("Use a substitute email address
   for unverified domains") — Salesforce ships localized orgs and this string
   is not stable across edition/locale.

If a smarter selector is adopted, also reconsider the other three hard-coded IDs
in the same file (dropdown, save button, success panel) for the same treatment —
they have stable trailing segments too (`:sendEmailAccessControlSelect`,
`:saveBtn`, `:successMessagePanel`).

## Why this incident matters as guidance

This is the second time we've patched a literal Visualforce id in this codebase
(the first was the initial implementation). One more drift on any of the four
IDs and the brittle approach should be retired in favor of suffix-based
selectors across the board. Treat the next drift as the trigger.
