# Runbook — migrate critical config to Firestore (deploy-safe)

Run in order; every step is non-destructive.

1. Read live values from Cloud Run console
   (console.cloud.google.com/run → project career-copilot-a3168 → a function
   service → Edit & deploy new revision → Variables & Secrets — do NOT deploy):
   `ADMIN_UIDS`, `KAIRLLM_API_KEY`, `KAIRLLM_BASE_URL`, `DEEPSEEK_API_KEY`,
   `GEMINI_API_KEY`, current `APP_BASE_URL`.

2. Populate Firestore (survives subsequent targeted Functions deployments):
   - `platform_config/llm` ← LLM keys (via Admin Portal LLM config).
   - `platform_config/access` ← admin UIDs (Admin Portal RBAC).
   - `platform_config/app` ← `{ "app_base_url": "https://copilot.example.com" }`.

3. Build, then deploy only the Functions that consume the canonical app URL:
   ```bash
   npm --prefix functions run build
   firebase deploy --project career-copilot-a3168 --only \
   functions:createCheckoutSession,\
   functions:createBillingPortalSession,\
   functions:onApplicationStatusChange
   ```
   Do not replace this with an untargeted `--only functions` deployment. The
   production project still has legacy Functions that are intentionally absent
   from the current source tree, so a full deploy can offer to delete them.

4. Remove the migrated keys from local `functions/.env`
   (LLM keys, `ADMIN_UIDS`, `APP_BASE_URL`). Keep `STRIPE_*` (out of scope).
   With the values gone from `.env`, no future local deploy can replace the live
   Firestore config.

5. Verify:
   - From https://copilot.example.com: open Stripe portal → Return → lands on
     copilot.example.com.
   - Trigger an application-status-change email → "Open Career CoPilot" points at
     copilot.example.com.
