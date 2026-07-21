# Public-site visual QA

## Automated screenshot pass

From the repository root, run:

```bash
npm run marketing:qa
```

The script reserves its own local port, starts the current default Vite UI, and
writes full-page screenshots plus `marketing/qa-screenshots/QA-REPORT.md`. To
inspect an already-running candidate instead, set `QA_SKIP_DEV=1` and an explicit
`QA_BASE_URL`; do not rely on a process merely because it occupies a familiar
port.

Covered routes are `/`, `/employers`, `/sample-report`, `/pricing`, `/workspace`,
and `/portal` at 1280x800 and 390x844. The harness checks the stable legacy
`data-beta-*` marketing selectors, app-shell isolation, forbidden stale copy,
horizontal overflow, the workspace cookie-banner collision, and a Chinese-locale
smoke. The selector name is retained for compatibility and is not a release
status label.

## Manual release pass

- [ ] Repeat the public routes at 320, 768, and 1440 px.
- [ ] Use keyboard-only navigation for header, menus, carousel, forms, and footer.
- [ ] Check visible focus, dialog focus containment/return, and accessible names.
- [ ] Inspect English plus the seven configured locale files; inspect Arabic RTL
      independently.
- [ ] Confirm no raw localization key, horizontal page overflow, clipped generated
      content, fixed-banner collision, or control hidden behind a sticky element.
- [ ] Confirm the requested beta-preview/course-team footer copy is absent.
- [ ] Confirm every sample, scenario, rating, salary, and AI output is labelled as
      illustrative where applicable.
- [ ] Confirm loading, empty, error, retry, pending-payment, and permission-denied
      states remain understandable on mobile.
- [ ] Inspect browser console/network failures and verify that consent-gated
      integrations do not load before consent.

Record the tested commit, browser/device versions, base URL, screenshots, failures,
and human reviewer in the release evidence. A historical report is not evidence
for a new commit.
