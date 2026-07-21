# Career CoPilot public-site design system

This document describes the public site that is mounted by default from
`index.tsx`. There is no marketing feature flag. Authenticated candidate and
employer workflows lazy-load under `/workspace/*` and `/portal/*`; the admin
surface lazy-loads under `/admin`.

The repository-wide design reference is [`../Design.md`](../Design.md). This file
adds the public-site information architecture and implementation contract.

## Sources of truth

- CSS variables and system font stack: `marketing/site-theme.css`
- TypeScript token mirror: `marketing/design-tokens.ts`
- Shared layout, header, and footer: `marketing/components/`
- Route map: `marketing/SiteRouter.tsx` and `config/site.ts`
- Localized copy: `localization/*.json`; `public/localization/*.json` is generated
  by `scripts/sync-localization.mjs`
- Pricing: `marketing/config/pricingPlans.ts` plus server-authoritative billing
  entitlements

The legacy `.beta-root` class and `data-beta-*` attributes remain only as stable
CSS/QA selectors. They are not a feature flag or user-visible release label and
must not be used as evidence that a different UI is active.

## Visual language

- Use the restrained `--site-action` blue for actions and focus. Green, orange,
  and red are status colors only.
- Public pages use opaque white or slate surfaces, an 8 px base radius, one-pixel
  borders, and no default card shadow.
- Use the local system font stack. Production CSP intentionally does not fetch a
  remote font.
- Keep body copy near 65 characters per line, touch targets at least 44 px, and
  focus indicators visible.
- Avoid purple gradients, glass cards, decorative KPI wallpaper, stock photos,
  unlabelled sample data, fabricated testimonials, and unexplained scores.
- Product previews must be either real screenshots or clearly labelled
  illustrative examples. They are not proof of a live customer result.

## Current page information architecture

### Job seeker `/`

1. Outcome-led introduction and resume entry point
2. Clearly labelled report/workflow previews
3. Candidate workflow and tool catalog
4. Fictional, explicitly disclosed use-case snapshots
5. Pricing entry and FAQ

### Employer `/employers`

1. Employer-specific introduction
2. Posting, review, and contact workflow
3. Clearly labelled candidate/product previews
4. Pricing entry and privacy/trust context

### Supporting public routes

- `/sample-report`: illustrative report, never a customer result
- `/pricing`: job-seeker and employer purchase intent; server remains the
  authority for real products and entitlements
- `/portal/*`: employer authentication/workspace
- `/workspace/*`: candidate authentication/workspace
- `/admin`: role-gated admin surface
- `/privacy.html`: static privacy disclosure

## Responsive and accessibility contract

- Required QA widths are 320, 390, 768, and 1440 px; also check zoom/reflow at
  200% where practical.
- No horizontal document overflow. Long URLs, localized labels, tables, dialogs,
  and generated text must wrap or scroll inside an intentional container.
- Navigation, carousels, dialogs, forms, and language selection must be usable by
  keyboard and expose accessible names.
- English and all configured locales must render without raw `site_*` keys. Arabic
  additionally requires right-to-left layout inspection.
- Loading, empty, error, retry, disabled, pending, and success states are part of
  the feature, not optional polish.

## Copy and trust contract

- Describe what the current workflow does; do not promise a job, interview,
  recruiter decision, ATS acceptance, response time, or security outcome.
- Any score is an AI-assisted or lexical signal with context, not a hiring
  decision. A zero score must remain zero; do not manufacture a reassuring floor.
- Prices use CAD where the billing contract does. Legacy employer add-ons remain
  hidden while their checkout entitlement is disabled.
- University, course-team, customer, or third-party approval copy is not part of
  the public footer.
- Support and legal contact details must be verified by the release owner before
  customer launch.

## Verification

Run from the repository root:

```bash
npm run localization:check
npm run test:localization
npm run marketing:qa
```

`marketing:qa` writes current screenshots and `marketing/qa-screenshots/QA-REPORT.md`.
Automated overflow and copy checks do not replace a real-browser keyboard,
screen-reader, RTL, and small-device pass.
