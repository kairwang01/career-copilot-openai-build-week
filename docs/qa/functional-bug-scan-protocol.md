# Functional Bug Similarity Scan Protocol

This protocol prevents shallow "fixed one page" QA rounds. It defines how Career CoPilot scans for same-class functional bugs, when scan depth expands, and why localization-only findings do not count as effective scan rounds.

## Classification

| Class | Counts as effective round? | Definition |
| --- | --- | --- |
| `FUNC-ASYNC-LIFECYCLE` | Yes | Async work, timers, subscriptions, or browser APIs can update state after a component unmounts, after a newer request supersedes it, or after a user switches context. |
| `FUNC-DUPLICATE-SUBMIT` | Yes | A user can trigger duplicate writes, duplicate AI charges, duplicate checkout sessions, duplicate applications, or duplicate backend actions before React state disables the UI. |
| `FUNC-OPTIMISTIC-ROLLBACK` | Yes | UI updates optimistically but does not revert or clearly recover when the backend call fails. |
| `FUNC-AUTH-ROUTING` | Yes | Role/session/admin/business state can route the user to the wrong shell, block the correct portal, or lose registration/profile data. |
| `FUNC-DATA-PERSISTENCE` | Yes | User data appears saved but is not persisted, is overwritten by stale state, or is not reloaded in the next workspace/portal view. |
| `L10N-TRANSLATION` | No | Missing, awkward, inconsistent, or untranslated copy only. Fix separately; do not count as an effective functional scan round. |
| `UX-COSMETIC` | No by default | Pure spacing/color/wording/visual polish. Count only if it blocks a core task, hides required controls, or overlaps text. |
| `QA-TEST-DEBT` | No by itself | Missing tests or weak QA hooks. Count only when paired with a verified functional defect. |

## Similarity Standard

Two bugs are same-class when they share all four signals:

1. Same root cause family, such as late async state writes or duplicate submits.
2. Same user-visible failure mode, such as stale data replacing current data, stuck loading, false success, or wrong portal.
3. Same code pattern, such as `await ...; setState`, `.then(setState)`, timer without cleanup, optimistic update without rollback, or action handler without a synchronous ref latch.
4. Same product risk surface, such as candidate workspace, employer portal, admin console, AI tools, billing/credits, or application pipeline.

Translation-only findings never satisfy this standard, even when many locale files share the same issue.

## Scan Depth

Each scan round must expand the search space from the previous round:

1. **L0 seed surface**: the file or flow where the bug was reported.
2. **L1 sibling components**: other components in the same feature folder or same visible workflow.
3. **L2 shared data/service pattern**: shared hooks, helpers, Firestore reads, callables, or AI client calls with the same control flow.
4. **L3 same role shell**: all candidate, employer, admin, or business surfaces that use the same bug pattern.
5. **L4 cross-role/shared primitives**: common UI primitives, modals, loaders, toasts, export/download controls, and tool wrappers.

A round is valid only if it contains a new search dimension, a new proof artifact, or a new fix. Re-running the same grep without narrowing/classifying does not count.

## Continue / Stop Rules

Continue to the next round when the current round finds at least one new `FUNC-*` defect in the same class.

Stop when one full expanded round finds:

- zero new `FUNC-*` defects in the target class;
- only already-guarded patterns;
- only `L10N-TRANSLATION`;
- only synchronous hydration from props/context;
- only focus/print helper timers that do not write React state; or
- only timers/subscriptions that already have cleanup.

## Scan Algorithm

1. Write the seed bug as a signature:
   - root cause;
   - code shape;
   - user-visible failure;
   - affected role/flow.
2. Run broad static search excluding translations:
   - `rg "await|\\.then\\(|setTimeout|setInterval|onSnapshot|addEventListener|finally|savingRef|loadingRef" components hooks lib --glob '!**/localization/**' --glob '!**/public/localization/**'`
   - `npm run scan:functional-bugs -- --include-duplicate-submit` for the maintained duplicate-submit candidate scanner.
3. Bucket matches into `FUNC-*`, `L10N-*`, `UX-*`, or `QA-*`.
4. Manually prove each `FUNC-*` candidate:
   - stale result can write state;
   - component can unmount or context can switch before completion;
   - no active/mounted/run-id/ref latch guard exists;
   - failure affects a real user task.
5. Fix with the smallest stable guard:
   - `mountedRef` for component lifetime;
   - `active`/`cancelled` for one effect;
   - run id refs for superseded requests;
   - cleanup for timers/listeners/subscriptions;
   - synchronous ref latch for duplicate-submit;
   - centralized action guards such as `startAiAction()` when a form already owns a shared AI-action mutex.
6. Run TypeScript after each effective fix round.
7. Run another scan round if any same-class `FUNC-*` defect was fixed.
8. Finish with build/tests and a round summary.

## Required Round Report

Each round must report:

- `Round N`: effective or non-effective.
- `Scope`: L0-L4 depth covered.
- `Functional defects found`: file + class + failure mode.
- `Translation findings`: excluded count or `none`.
- `Fixes`: exact surfaces changed.
- `Verification`: commands run.
- `Decision`: continue or stop, with reason.
