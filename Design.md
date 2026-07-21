# Career CoPilot — Design System

Repo-level design reference (SCRUM-35). Single source of truth for palette, type,
spacing, and component patterns so P0–P2 work stays consistent and we do not revert
to the shadcn default / generic-AI-SaaS look.

This document describes what is **already in the codebase**. It does not introduce a
new palette. Two token layers exist and both are documented below:

- **App shell (shadcn base):** `index.css` — the logged-in product UI (`CareerApp.tsx`, `components/`, `features/`).
- **Public site:** `marketing/site-theme.css` + `marketing/design-tokens.ts` — the default public pages (`marketing/pages/`, `marketing/components/`).

The historical redesign direction came from Confluence page `TCC / 9601025`.
The repository is now the operational source of truth. Companion files:
`marketing/Design.md`, `marketing/ANTI-PATTERNS.md`.

---

## Palette

### Public-site tokens (`--site-*`)

Defined on the legacy `.beta-root` selector in `marketing/site-theme.css`; mirrored
as TS constants in `marketing/design-tokens.ts`. The selector name is retained for
compatibility and is not a release-status label. Use these tokens for all
public-site work.

| Token (CSS var) | Hex | TS key | Usage |
|-----------------|-----|--------|-------|
| `--site-action` | `#1D4ED8` (blue-700) | `colors.action` | Primary CTA, links, focus ring. **Actions only** |
| `--site-action-hover` | `#1E40AF` (blue-800) | `colors.actionHover` | Hover state for primary action |
| `--site-surface` | `#FFFFFF` | `colors.surface` | Page background, default cards |
| `--site-surface-muted` | `#F8FAFC` (slate-50) | `colors.surfaceMuted` | Alternate sections, inset panels |
| `--site-text` | `#0F172A` (slate-900) | `colors.textPrimary` | Headlines, body |
| `--site-text-muted` | `#64748B` (slate-500) | `colors.textMuted` | Secondary copy, captions |
| `--site-border` | `#E2E8F0` (slate-200) | `colors.border` | Card + table borders |
| `--site-ready` | `#16A34A` (green-600) | `colors.ready` | Status: ATS ready, skills matched |
| `--site-ready-bg` | `#F0FDF4` (green-50) | `colors.readyBg` | Ready badge / chip background |
| `--site-gap` | `#EA580C` (orange-600) | `colors.gap` | Status: missing keywords, skill gaps |
| `--site-gap-bg` | `#FFF7ED` (orange-50) | `colors.gapBg` | Gap badge / chip background |
| `--site-risk` | `#DC2626` (red-600) | `colors.risk` | Status: blockers, critical issues |
| `--site-risk-bg` | `#FEF2F2` (red-50) | `colors.riskBg` | Risk badge / chip background |

**Palette rules**
- Exactly **one** restrained blue action color (`--site-action`). Green / orange / red are **status signals only** — never decorative.
- White (`--site-surface`) background, deep-ink (`--site-text`) text.
- No purple / violet / indigo anywhere. No multi-stop gradients.
- Accent blue should stay ≤ ~5% of viewport area on marketing pages.

### App shell tokens (shadcn base, `index.css`)

The logged-in product UI uses the shadcn CSS-variable theme (light + `.dark`),
bridged to Tailwind utilities via `@theme inline`. Key light-mode values:

| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `#ffffff` | App background |
| `--foreground` | `oklch(0.145 0 0)` (near-black) | Default text |
| `--primary` | `#030213` (near-black ink) | Primary surfaces/text in app chrome |
| `--secondary` | `oklch(0.95 0.0058 264.53)` | Subtle fills |
| `--muted` / `--muted-foreground` | `#ececf0` / `#717182` | Muted surfaces / text |
| `--accent` | `#e9ebef` | Hover/selected fills |
| `--destructive` | `#d4183d` | Destructive actions |
| `--border` | `rgba(0,0,0,0.1)` | Borders |
| `--ring` | `oklch(0.708 0 0)` | Focus ring |
| `--radius` | `0.625rem` (10px) | Base radius (sm/md/lg/xl derived) |

Workspace primitives (also in `index.css`) used across in-app surfaces:
`.workspace-card`, `.workspace-button-secondary`, `.workspace-button-ghost`.
Their interactive blues align with the action color (e.g. focus `rgb(37 99 235)`,
hover `rgb(29 78 216)`).

> Note: the app primary (`#030213`) is an ink/near-black, **not** a brand blue.
> Brand action blue lives only in the marketing layer (`--site-action`). Keep the
> two layers distinct; do not import `--site-*` into the app shell or vice versa.

---

## Type scale

| Layer | Family |
|-------|--------|
| Marketing | `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` |
| App shell | The same system stack (`index.css` `body`); external font imports are prohibited by the production CSP |

Marketing scale (`marketing/design-tokens.ts` `typography`):

| Level | Size | Weight | Use |
|-------|------|--------|-----|
| Display | `clamp(2rem, 4vw, 3rem)` | 600 | Hero headlines only |
| Heading | `1.375rem` | 600 | Section titles |
| Body | `1rem` / 16px | 400 | Paragraphs, UI labels |
| Small / mono | `0.875rem` | 400 | Scores, keywords, data |

**Type rules**
- Line-height: ~1.5 body, ~1.2 display.
- Max line width ~65ch for marketing prose; tool panels may be denser.
- Banned for display headlines: 700/800 (`font-extrabold`) and any gradient text fill.

---

## Spacing

8pt grid. Marketing scale (`marketing/design-tokens.ts` `spacing`, mirrored as
`--site-section`):

| Token | Value |
|-------|-------|
| `space-1` | 8px |
| `space-2` | 16px |
| `space-3` | 24px |
| `space-4` | 32px |
| `space-6` | 48px |
| `space-8` | 64px |
| `--site-section` | `clamp(80px, 12vw, 160px)` |

- Section vertical padding uses `--site-section` (80–160px on desktop). Do not ship marketing section padding < 80px on desktop.
- No arbitrary spacing values like `p-[13px]`.

Radius scale: marketing `--site-radius` = `8px` (also `radius.sm 6 / md 8 / lg 12`
in tokens). App shell base radius `--radius` = `10px`.

---

## Buttons

Marketing source: `marketing/components/SiteButton.tsx` (variants `primary | secondary | ghost`).
Base: `inline-flex items-center justify-center rounded-[var(--site-radius)] px-6 py-2.5 text-sm font-medium transition-colors`.

| Variant | Classes |
|---------|---------|
| Primary | `bg-[var(--site-action)] text-white hover:bg-[var(--site-action-hover)] border border-transparent` |
| Secondary | `bg-[var(--site-surface)] text-[var(--site-text)] border border-[var(--site-border)] hover:bg-[var(--site-surface-muted)]` |
| Ghost | `bg-transparent text-[var(--site-action)] border border-transparent hover:bg-[var(--site-surface-muted)]` |

App shell: use `.workspace-button-secondary` / `.workspace-button-ghost` from `index.css`.

**Button rules**
- One primary action per viewport section.
- No gradient buttons. No `rounded-full` pill CTAs for primary actions.

---

## Cards

Marketing source: `marketing/components/SiteCard.tsx`.
`rounded-[var(--site-radius)] border border-[var(--site-border)] p-6` over
`bg-[var(--site-surface)]` (or `bg-[var(--site-surface-muted)]` when `muted`).

```
radius:    8px (var(--site-radius))
border:    1px solid var(--site-border)
padding:   24px (p-6)
shadow:    none by default
background: var(--site-surface) | var(--site-surface-muted)
```

App shell: `.workspace-card` — 1px `rgb(226 232 240)` border, `0.75rem` radius,
white background, `0 1px 2px rgba(15,23,42,0.05)` shadow.

**Card rules**
- Default cards are flat: 8px radius, 1px border, **no** shadow.
- Elevated surfaces (modals, dropdowns) may use `shadow-sm` only — never `shadow-lg`/`shadow-xl`.
- No `rounded-2xl` / `rounded-3xl` defaults.

---

## Tables (portal / reports)

- Prefer 1px row borders (`border-[var(--site-border)]`); zebra striping optional.
- Left-align text; right-align numbers.
- Status column uses semantic status badges (see below), not raw percentages.
- Minimum 44px row height on mobile (touch target).

---

## Status labels

The de-template direction is "show the diagnosis, not a fake number." Status is
always carried by the three semantic colors, paired with a tinted background, not by
decorative color. Canonical pattern from `marketing/components/ReportPreview.tsx`:

```ts
const status = {
  ready: 'bg-[var(--site-ready-bg)] text-[var(--site-ready)] border-[var(--site-ready)]/20',
  gap:   'bg-[var(--site-gap-bg)]   text-[var(--site-gap)]   border-[var(--site-gap)]/20',
  risk:  'bg-[var(--site-risk-bg)]  text-[var(--site-risk)]  border-[var(--site-risk)]/20',
};
```

Inline chip (e.g. keyword tag): `text-xs px-2 py-1 rounded border` + one of the above.

| Status | Meaning | Color |
|--------|---------|-------|
| `ready` | ATS ready, skill matched, requirement met | green `#16A34A` on `#F0FDF4` |
| `gap` | Missing keyword, skill gap, needs work | orange `#EA580C` on `#FFF7ED` |
| `risk` | Blocker, critical issue | red `#DC2626` on `#FEF2F2` |

**Status rules**
- These three colors mean status and nothing else. Never use green/orange/red for branding, headers, or buttons.
- A candidate / report surface must explain *why* (role fit, matched skills, missing skills, evidence) — not show a single match % in isolation.

---

## Banned patterns

If a PR introduces any of these, reject it. Full table: `marketing/ANTI-PATTERNS.md`.
These exist to keep us off the shadcn default / generic-AI-SaaS template.

### Hard bans (called out in the design direction)

1. **Blue/purple gradients.** No purple/violet/indigo. No multi-stop gradient heroes, gradient headlines (`bg-gradient-to-r from-blue-600 to-indigo-700`), or full-bleed gradient backgrounds. → Solid `--site-surface` + optional single-corner radial accent; solid `--site-text` headlines.
2. **Glass / translucent cards.** No glassmorphism (`backdrop-blur` cards floating over a gradient). → Opaque surfaces only.
3. **Fake-score cards.** No "Resume Score 94%" floating card, no decorative score badges, no out-of-context metrics ("10x faster"). → A real product screenshot, or a clearly labelled illustrative report that names its method, limitations, gaps, keywords, and role-fit evidence.
4. **"Most Popular" pricing pill.** No `MOST POPULAR` gradient pill, no four symmetric pricing cards. → Tiered layout (LinkedIn-style) with one recommended plan emphasized by a subtle border highlight only — no gradient pill.
5. **Stock photos.** No stock photography or generic illustrations standing in for product. → Real product panels/screenshots (Resume Report, Career Path, Interview Feedback, Candidate Match).

### Additional bans (inferred from the codebase direction)

6. **Three identical feature cards in a row** + a 48px Lucide icon over a generic title. → One primary feature + supporting list, or an alternating layout with a real data preview.
7. **`rounded-2xl shadow-lg` on every card.** → 8px radius, 1px border, no shadow (default); `shadow-sm` only for true overlays.
8. **`font-extrabold` for display headlines / gradient text fills.** → Display weight 600, solid color.
9. **Job-seeker / employer toggle on one page; centered-everything hero + predictable 3-card grid.** → Separate routes (`/` and `/employers`); asymmetric, left-weighted hero.
10. **Mixed Chinese/English in a single UI string.** → One locale per render; use i18n keys.
11. **Hard-coded hex in marketing components.** → Use `--site-*` CSS vars or `marketing/design-tokens.ts`.
12. **University, course-team, customer, or third-party approval branding in public product UI; or "AI-powered / Unlock / Empower / Transform / Seamless" filler copy.** → Product-only public branding and concrete, outcome-specific copy; keep historical academic context in project documents.

### Lint targets (when an ESLint plugin is added)

Fail the build on, within marketing files:
`from-violet`, `from-indigo`, `to-purple`, `bg-indigo-600`,
`rounded-2xl`, `rounded-3xl`, `shadow-lg`, `shadow-xl`,
and `font-extrabold` in display contexts.

### Acceptance test

Cover the logo. A new visitor should be able to say:
1. "This helps me fix my resume and prepare for interviews."
2. "Employers see *why* someone matches, not just a score."
3. "This doesn't look like every other AI SaaS landing page."

---

## References

- Historical direction: Confluence TCC / page 9601025.
- `marketing/Design.md` — current public-site implementation contract and page IA.
- `marketing/ANTI-PATTERNS.md` — full banned-pattern table.
- Tokens: `marketing/design-tokens.ts`, `marketing/site-theme.css`.
- App shell theme: `index.css`.
