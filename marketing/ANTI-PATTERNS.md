# Public-site anti-patterns

Use this list when reviewing `marketing/**`. The current public UI is the default
application surface; there is no beta feature flag or alternate MVP homepage.

## Visual and layout

| Banned | Use instead |
| --- | --- |
| Purple/blue multi-stop gradient hero or gradient headline | Solid site tokens and restrained status/action color |
| Glassmorphism or translucent content cards | Opaque surfaces with a one-pixel border |
| Stock photos, fake people, decorative testimonials, or invented logos | Real product imagery or clearly labelled illustrative product previews |
| Floating score/KPI with no method or context | Named evidence, limitations, and actionable gaps |
| Identical feature-card wallpaper | A workflow, comparison, or catalog whose grouping helps a user decide |
| Large radii and heavy shadows on every panel | 8 px base radius; shadow only for a true overlay |
| Desktop-only fixed widths or clipped tables | Responsive wrapping or an intentional labelled scroll region |
| Color-only state | Text/icon/status labels with sufficient contrast |

## Copy and trust

| Banned | Use instead |
| --- | --- |
| “Land the job”, guaranteed outcome, instant result, perfect match, or unsupported accuracy claim | Exact workflow capability and an explicit limitation |
| Fabricated customer quote, hiring result, company activity, rating, salary, or market coverage | Source-backed fact or “illustrative example” label |
| AI score presented as a recruiter decision | AI-assisted/lexical signal with evidence and user verification |
| Mixed locales or raw localization keys | One locale per render and canonical localization keys |
| Hard-coded tool count that can drift from the catalog | Count derived from the source collection or count-free copy |
| University/course-team/customer approval copy in public brand UI | Product-only footer; historical academic context stays in project documents |
| Unverified support, privacy, or billing promises | Release-owner verification and an honest blocker |

## Product and engineering

| Banned | Use instead |
| --- | --- |
| Marketing-only purchase state treated as an entitlement | Server-authoritative Stripe/billing result |
| Direct Firestore mutation for protected business/admin state | Reviewed callable with role and input validation |
| A sample or legacy SKU that appears purchasable without a live entitlement | Hide/disable it and explain its status internally |
| New visible copy hard-coded in one component | Add the key to every canonical locale and sync generated public mirrors |
| A component/class that is never mounted | Identify creator, lifecycle/route wiring, and runtime proof |
| Remote font/image/script added without privacy/CSP review | Local assets/system fonts or a consent-gated reviewed integration |

## Review fingerprints

Scan marketing changes for unsupported percentages and superlatives, `Strong
Hire`, “guarantee”, raw `site_*` keys, fixed tool counts, third-party names in the
footer, unlabelled mock content, `from-violet`, `from-indigo`, `to-purple`,
`rounded-2xl`, `rounded-3xl`, `shadow-lg`, and `shadow-xl`. A match is a prompt for
review, not an automatic replacement: status colors and intentional responsive
geometry can be legitimate.

## Acceptance test

Without relying on the logo, a visitor should understand that Career CoPilot:

1. helps review career material and practise workflows;
2. provides decision support, not a guaranteed hiring outcome; and
3. separates illustrative examples from real user/customer evidence.
