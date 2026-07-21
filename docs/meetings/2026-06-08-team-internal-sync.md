# Team Internal Sprint Sync — Career CoPilot

Date: 2026-06-08, 20:00–21:00 (EDT)
Type: Internal squad sync
Attendees: Kair Wang, Jingxuan Xu (Joyce), Xiaoyi Zhang, Jiaoyang Bi, Xiang Zhao, Xiaoyan Yang
Course: University of Ottawa, ELG 5902
Jira: project SCRUM (Team1 Career CoPilot)
Branch: dev

## Summary

The team agreed to keep driving the sprint without waiting on external sign-off. This session we finished moving every AI feature off the browser and onto Cloud Functions, and added a model picker for the paid tiers.

Until now the Gemini API key shipped inside the browser bundle and credits were tracked only in React state, so a user could get around the credit checks. The key now stays on the server, credits are deducted server-side before each model call, and the frontend talks to a single typed client. An earlier audit had listed 50 problems caused by two separate backends that were never wired together; most of those are resolved by this change.

Status: the client-to-server migration is code-complete across both phases. Root `tsc` is back to 0 errors (from 129), the functions package type-checks, the production build passes, and the main bundle dropped from 2.93 MB to about 600 KB (180 KB gzipped). It is not deployed yet — see Open items.

## Work by owner

Kair Wang — AI proxy and frontend integration
- Generic `aiProxy` callable that routes the long-tail tools through the shared provider layer, with auth, credit deduction, refund on failure, and a payload cap.
- `services/aiClient.ts` as a drop-in replacement that keeps the same 41 signatures, so components only had to change their import. Removed `services/geminiService.ts` (792 lines).
- `ModelSelector` in the sidebar, shown only when the tier has more than one model available.
- Wired the stateless rewrites on the client for the interview simulator and the coach.
- Build config: vite chunk splitting, removed the key injection, `tsconfig` and env updates, and a test-user script.

Jingxuan Xu (Joyce) — secure Cloud Functions
- Server-side handlers for resume analysis, mock interview, cover letter, and career path. Auth is checked and credits are deducted before the model call; the mock interview is validated before any deduction.
- New handlers: `setSubscriptionStatus` (normalises the plan keys the frontend sends and writes the status only), career coach, URL text extraction with an SSRF guard, and headshot generation with an input cap.
- Function exports and global options, plus clearer auth error messages.
- Collapsed the recruiting reads into a single owner-scoped query, which also fixes the N+1.

Xiaoyi Zhang — frontend components
- Moved all 24 feature components off the old client service onto `aiClient` with no change in behaviour: every tool under `components/tools`, the employer and business pages, and the shared shell.

Xiang Zhao — multi-LLM provider layer
- Provider interface plus the Gemini provider (with search grounding) and an OpenAI-compatible provider for the KAIRLLM gateway.
- Model registry and tool registry, and a `listModels` callable. The free tier stays on Gemini; paid tiers can switch. The gate is enforced on the server.

Jiaoyang Bi — DevOps and security config
- Hardened the Firestore rules: closed the self-grant hole on user creation, scoped the subcollections and job collections to their owner, and kept the users collection read-denied.
- Defined the API-key secrets and documented the Secret-Manager-backed environment for staging and production.

Xiaoyan Yang — credits and billing
- Made `config/credits.ts` the single source of truth and reconciled the server schema to it.
- Added guards and refund-on-failure to the deduction path, and removed the client-side add-credits path.

## Decisions

1. All AI runs server-side; the API key is no longer in the browser.
2. `config/credits.ts` is the canonical pricing, and the server mirrors it.
3. `setSubscriptionStatus` sets the plan status only, not credits. Credit grants will come from the Stripe webhook later, so dev mode cannot be used to hand out free credits.
4. Model access is gated by tier on the server: free uses Gemini, paid can use the KAIRLLM gateway. Adding another model is one registry entry plus one branch.

## Metrics

| Metric | Before | After |
|---|---|---|
| Root tsc errors | 129 | 0 |
| Functions tsc | — | clean |
| API key in browser bundle | yes | no |
| Credit deduction | client state | server-side |
| Main JS chunk | 2.93 MB (791 KB gz) | ~600 KB (~180 KB gz) |
| AI tools on the secure path | 0 / 35 | 35 / 35 |

## Open items (do not block the code, but block production)

- Rotate the exposed Gemini key (Kair / Jiaoyang).
- Set the function secrets and deploy to staging (Jiaoyang).
- Test the Firestore rules and every callable in the emulator or staging; none run in our local setup (Jiaoyang / Joyce).
- App Check and per-user rate limiting are deferred. App Check needs a reCAPTCHA key and client registration first. Auth, input caps, and server-side credits are in place as a baseline.
- Set the pricing for the tools that are currently left uncharged (Xiaoyan).
- Rotate the KAIRLLM key after testing (Xiang / Kair).

## Action items

| Action | Owner | Due |
|---|---|---|
| Rotate the exposed Gemini key and confirm to the team | Kair / Jiaoyang | before next sync |
| Set function secrets and deploy to staging | Jiaoyang | next sprint |
| Test rules and callables in the emulator | Jiaoyang / Joyce | next sprint |
| Decide pricing for the uncharged tools | Xiaoyan | next sync |
| Open a ticket for App Check and rate limiting | Kair | next sync |

## Jira updates

- SCRUM-15 (AI provider abstraction and second model) moved to Done.
- SCRUM-18, SCRUM-19, SCRUM-20, SCRUM-22 moved to In Progress with notes.
- Epics SCRUM-6 and SCRUM-7 updated with progress.
- These notes mirrored to SCRUM-36.

Recorded by Kair Wang.
