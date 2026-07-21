# Runbook — restore AI when every AI tool is unavailable

Use this runbook when customer tools return “AI features are temporarily
unavailable” and the Admin dashboard reports that no usable provider route is
configured. Treat provider credentials as secrets throughout the incident.

## Preconditions

- Open an incident/change record with an owner, target Firebase project, start
  time, and rollback decision-maker.
- Confirm the exact project before reading or writing configuration. The
  production example below is `career-copilot-a3168`; replace it only when the
  incident record names a different environment.
- A `super` administrator is required for Models & Keys. Bootstrap access only
  through the guarded `functions/scripts/grantSuper.js` procedure in
  `docs/deployment/README.md`; do not hand-edit access documents.
- Never paste a raw provider key into logs, screenshots, tickets, chat, or shell
  history. Use the password field in the Admin Portal or the environment's
  approved secret-entry mechanism.

## Diagnose before changing state

```bash
PROJECT_ID=career-copilot-a3168
firebase functions:list --project "$PROJECT_ID"
```

1. Confirm the browser is connected to the same project named in the incident.
2. In **Admin → Dashboard**, record only masked provider health and route status.
3. In **Admin → Models & Keys**, verify whether the intended route has an active
   model, a usable masked key, and the expected base URL. Do not assume that a
   generic Gemini-key error proves every provider is missing.
4. Check approved Cloud Functions logs for error codes and model identifiers;
   redact request content and never query or export raw credentials.

## Restore configuration

1. As a `super` admin, open **Admin → Models & Keys**.
2. Select the intended provider and model. Enter a newly issued key in **New API
   key** and verify the configured base URL against the provider's official
   endpoint. Leaving the key field blank preserves the existing secret.
3. Save once. The callable refreshes platform caches after the Firestore write;
   other warm instances may take up to the documented cache interval to converge.
4. Use the admin model probe with a non-sensitive prompt. Then run one ordinary
   customer tool from a dedicated test account and verify that credits are charged
   once on success or refunded on provider failure.
5. Confirm the admin audit log records who changed the configuration without
   exposing the raw key. Close the incident only after the dashboard, probe, and
   customer path all agree.

If the save callable itself is unavailable or the deployed release is older than
the incident's approved commit, stop and use the normal release procedure. Build
first, review the exact target list, and always pass the project explicitly:

```bash
npm --prefix functions run build
ONLY_TARGETS="functions:adminGetDashboard,functions:adminGetLlmConfig,functions:adminUpdateLlmConfig,functions:adminListModels,functions:adminUpsertModel,functions:adminDeleteModel,functions:adminSetDefaultModel,functions:adminUpdateModelRouting,functions:adminTestModel"
firebase deploy --project "$PROJECT_ID" --only "$ONLY_TARGETS"
```

Do not redeploy every function as an improvised key-recovery step. If a customer
tool handler also needs a code fix, add its exported function name to the reviewed
change record and run the full release gates before deployment.

## Emergency environment fallback

`GEMINI_API_KEY`, `KAIRLLM_API_KEY`, and `DEEPSEEK_API_KEY` remain runtime
fallbacks, while an Admin Portal value takes precedence. Use an environment
fallback only under the project's approved secret-management procedure, record
which function revision consumes it, and redeploy the reviewed affected
functions to the explicit project. Do not commit a production `.env` file.

## Prevention and evidence

- Dashboard provider-health warnings make the outage visible to reviewers and
  administrators; key/model edits remain `super`-only.
- The admin model probe, masked key response, cache refresh, audit entry, and one
  customer-tool smoke are all required evidence. A successful configuration
  write alone is not proof that the runtime route works.
- Keep at least one tested fallback route only when its cost, data-processing
  terms, and failure behavior have an approved owner.
- Rotate a credential immediately if it was exposed during recovery, then verify
  that the compromised version has been disabled at the provider.
