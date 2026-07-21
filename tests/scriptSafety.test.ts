import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMULATOR_PROJECT,
  assertSafeLocalFilePath,
  configureFirebaseScript,
  mergeEmulatorSecretPlaceholders,
} from "../scripts/lib/firebase-script-safety.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

const firebaseWriteOrSmokeScripts = [
  "account-profile-smoke.mjs",
  "aiproxy-guard-smoke.mjs",
  "auth-routing-smoke.mjs",
  "billing-credits-smoke.mjs",
  "capture-product-screenshots.mjs",
  "dialog-positioning-smoke.mjs",
  "hiring-loop-smoke.mjs",
  "navigation-ui-smoke.mjs",
  "overlay-collision-smoke.mjs",
  "resume-preview-smoke.mjs",
  "run-all-smokes.mjs",
  "seed-ats-preview.mjs",
  "seed-company-reviews.mjs",
  "seed-emulator.mjs",
  "seed-web3-preview.mjs",
  "sourcing-outreach-smoke.mjs",
  "tool-execution-smoke.mjs",
  "web3-preview-smoke.mjs",
];

const makeEnv = (overrides: Record<string, string> = {}) => ({ ...overrides });

describe("Firebase script safety", () => {
  it("defaults every Firebase service to a loopback emulator", () => {
    const env = makeEnv();

    const target = configureFirebaseScript({
      scriptName: "unit-test",
      argv: [],
      env,
      stdinIsTTY: false,
    });

    expect(target).toMatchObject({
      mode: "emulator",
      projectId: DEFAULT_EMULATOR_PROJECT,
    });
    expect(env).toMatchObject({
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9197",
      STORAGE_EMULATOR_HOST: "http://127.0.0.1:9197",
      VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST: "127.0.0.1",
      VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT: "5001",
      VITE_FIREBASE_USE_EMULATOR: "true",
      GCLOUD_PROJECT: DEFAULT_EMULATOR_PROJECT,
      GOOGLE_CLOUD_PROJECT: DEFAULT_EMULATOR_PROJECT,
    });
  });

  it.each([
    ["FIREBASE_AUTH_EMULATOR_HOST", "auth.example.com:9199"],
    ["FIRESTORE_EMULATOR_HOST", "10.0.0.5:8080"],
    ["FIREBASE_STORAGE_EMULATOR_HOST", "storage.example.com:9197"],
    ["STORAGE_EMULATOR_HOST", "https://storage.example.com"],
    ["VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST", "functions.example.com"],
  ])("rejects a non-loopback %s", (name, value) => {
    expect(() =>
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: [],
        env: makeEnv({ [name]: value }),
        stdinIsTTY: true,
      }),
    ).toThrow(/loopback/i);
  });

  it("rejects HTTPS even when an emulator URL points to loopback", () => {
    expect(() =>
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: [],
        env: makeEnv({ VITE_FIREBASE_AUTH_EMULATOR_URL: "https://127.0.0.1:9199" }),
        stdinIsTTY: true,
      }),
    ).toThrow(/plain HTTP/i);
  });

  it("rejects a production project when production mode was not explicit", () => {
    expect(() =>
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: ["--project", "career-copilot-a3168"],
        env: makeEnv(),
        stdinIsTTY: true,
        productionProjects: ["career-copilot-a3168"],
      }),
    ).toThrow(/--production/);
  });

  it("rejects production mode for emulator-only scripts", () => {
    expect(() =>
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: ["--production", "--project", "career-copilot-a3168"],
        env: makeEnv({
          ALLOW_PRODUCTION_WRITES: "1",
          CONFIRM_PRODUCTION_PROJECT: "career-copilot-a3168",
        }),
        stdinIsTTY: true,
      }),
    ).toThrow(/emulator-only/i);
  });

  it("rejects a production project outside the script allowlist", () => {
    expect(() =>
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: ["--production", "--project", "other-production-project"],
        env: makeEnv({
          ALLOW_PRODUCTION_WRITES: "1",
          CONFIRM_PRODUCTION_PROJECT: "other-production-project",
        }),
        stdinIsTTY: true,
        productionProjects: ["career-copilot-a3168"],
      }),
    ).toThrow(/allowlist/i);
  });

  it("does not echo a rejected project argument", () => {
    const rejectedValue = "secret-looking-project-value";
    let message = "";
    try {
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: ["--production", "--project", rejectedValue],
        env: makeEnv({
          ALLOW_PRODUCTION_WRITES: "1",
          CONFIRM_PRODUCTION_PROJECT: rejectedValue,
        }),
        stdinIsTTY: true,
        productionProjects: ["career-copilot-a3168"],
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/allowlist/i);
    expect(message).not.toContain(rejectedValue);
  });

  it.each([
    [{ CONFIRM_PRODUCTION_PROJECT: "career-copilot-a3168" }, "ALLOW_PRODUCTION_WRITES"],
    [{ ALLOW_PRODUCTION_WRITES: "1" }, "CONFIRM_PRODUCTION_PROJECT"],
  ])("requires both production confirmations", (env, missingName) => {
    expect(() =>
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: ["--production", "--project", "career-copilot-a3168"],
        env: makeEnv(env),
        stdinIsTTY: true,
        productionProjects: ["career-copilot-a3168"],
      }),
    ).toThrow(missingName);
  });

  it("allows an interactive production run only after explicit confirmation", () => {
    const env = makeEnv({
      ALLOW_PRODUCTION_WRITES: "1",
      CONFIRM_PRODUCTION_PROJECT: "career-copilot-a3168",
    });

    expect(
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: ["--production", "--project=career-copilot-a3168"],
        env,
        stdinIsTTY: true,
        productionProjects: ["career-copilot-a3168"],
      }),
    ).toMatchObject({ mode: "production", projectId: "career-copilot-a3168" });
  });

  it("rejects non-interactive production by default", () => {
    const env = makeEnv({
      CI: "true",
      ALLOW_PRODUCTION_WRITES: "1",
      CONFIRM_PRODUCTION_PROJECT: "career-copilot-a3168",
    });

    expect(() =>
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: ["--production", "--project", "career-copilot-a3168"],
        env,
        stdinIsTTY: false,
        productionProjects: ["career-copilot-a3168"],
      }),
    ).toThrow(/ALLOW_NONINTERACTIVE_PRODUCTION_WRITES/);
  });

  it("permits a specifically confirmed non-interactive production run", () => {
    const env = makeEnv({
      CI: "true",
      ALLOW_PRODUCTION_WRITES: "1",
      CONFIRM_PRODUCTION_PROJECT: "career-copilot-a3168",
      ALLOW_NONINTERACTIVE_PRODUCTION_WRITES: "1",
    });

    expect(
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: ["--production", "--project", "career-copilot-a3168"],
        env,
        stdinIsTTY: false,
        productionProjects: ["career-copilot-a3168"],
      }),
    ).toMatchObject({ mode: "production", projectId: "career-copilot-a3168" });
  });

  it("rejects production mode when emulator routing is still present", () => {
    expect(() =>
      configureFirebaseScript({
        scriptName: "unit-test",
        argv: ["--production", "--project", "career-copilot-a3168"],
        env: makeEnv({
          ALLOW_PRODUCTION_WRITES: "1",
          CONFIRM_PRODUCTION_PROJECT: "career-copilot-a3168",
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        }),
        stdinIsTTY: true,
        productionProjects: ["career-copilot-a3168"],
      }),
    ).toThrow(/emulator/i);
  });

  it("requires a fixed local path for generated secret files", () => {
    const allowedDirectory = resolve(repositoryRoot, "functions");
    const safePath = resolve(allowedDirectory, ".secret.local");

    expect(
      assertSafeLocalFilePath({
        filePath: safePath,
        allowedDirectory,
        expectedBasename: ".secret.local",
      }),
    ).toBe(safePath);
    expect(() =>
      assertSafeLocalFilePath({
        filePath: resolve(allowedDirectory, "..", ".secret.local"),
        allowedDirectory,
        expectedBasename: ".secret.local",
      }),
    ).toThrow(/outside/i);
  });

  it("preserves unrelated secret-file lines while adding emulator placeholders", () => {
    const result = mergeEmulatorSecretPlaceholders(
      "# Local-only file\nOTHER_KEY=other_emulator_placeholder\nSTRIPE_SECRET_KEY=sk_test_emulator_placeholder\n",
      {
        STRIPE_SECRET_KEY: "sk_test_emulator_placeholder",
        STRIPE_WEBHOOK_SECRET: "whsec_emulator_placeholder",
      },
    );

    expect(result).toContain("# Local-only file\n");
    expect(result).toContain("OTHER_KEY=other_emulator_placeholder\n");
    expect(result).toContain("STRIPE_SECRET_KEY=sk_test_emulator_placeholder\n");
    expect(result).toContain("STRIPE_WEBHOOK_SECRET=whsec_emulator_placeholder\n");
  });

  it("refuses to replace a non-placeholder secret without echoing it", () => {
    const realLookingValue = "sk_live_must_never_appear_in_errors";

    let message = "";
    try {
      mergeEmulatorSecretPlaceholders(`STRIPE_SECRET_KEY=${realLookingValue}\n`, {
        STRIPE_SECRET_KEY: "sk_test_emulator_placeholder",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/refus/i);
    expect(message).not.toContain(realLookingValue);
  });

  it("refuses unknown real-looking secret-file values without echoing them", () => {
    const realLookingValue = "provider_key_must_not_appear_in_errors";
    let message = "";
    try {
      mergeEmulatorSecretPlaceholders(`GEMINI_API_KEY=${realLookingValue}\n`, {
        STRIPE_SECRET_KEY: "sk_test_emulator_placeholder",
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/refus/i);
    expect(message).not.toContain(realLookingValue);
  });

  it.each(firebaseWriteOrSmokeScripts)("guards %s before Firebase can initialize", (script) => {
    const source = readFileSync(resolve(repositoryRoot, "scripts", script), "utf8");
    const guardIndex = source.indexOf("configureFirebaseScript(");
    const initializeIndex = source.search(/initializeApp\(|initializeTestEnvironment\(|chromium\.launch\(/);

    expect(guardIndex, `${script} must call configureFirebaseScript`).toBeGreaterThanOrEqual(0);
    if (initializeIndex >= 0) {
      expect(guardIndex, `${script} must guard before initialization`).toBeLessThan(initializeIndex);
    }
  });

  it("keeps the guarded inventory aligned with Firebase writers and seed orchestrators", () => {
    const discovered = readdirSync(resolve(repositoryRoot, "scripts"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:mjs|js)$/.test(entry.name))
      .filter((entry) => {
        const source = readFileSync(resolve(repositoryRoot, "scripts", entry.name), "utf8");
        const usesAdminSdk = source.includes("firebase-admin");
        const invokesSeed = source.includes("scripts/seed-emulator.mjs");
        const usesFirebaseClient = /from ['"]firebase\/(?:app|auth|firestore|functions|storage)['"]/.test(source);
        const writesFirestoreRest =
          source.includes("firestore.googleapis.com") && /['"](?:PATCH|POST|DELETE)['"]/.test(source);
        return (
          usesAdminSdk ||
          invokesSeed ||
          usesFirebaseClient ||
          writesFirestoreRest ||
          entry.name === "run-all-smokes.mjs"
        );
      })
      .map((entry) => entry.name)
      .sort();

    expect(discovered).toEqual([...firebaseWriteOrSmokeScripts].sort());
  });

  it("centralizes emulator environment mutation in the safety module", () => {
    for (const script of firebaseWriteOrSmokeScripts) {
      const source = readFileSync(resolve(repositoryRoot, "scripts", script), "utf8");
      expect(source, script).not.toMatch(
        /process\.env\.(?:FIRESTORE_EMULATOR_HOST|FIREBASE_AUTH_EMULATOR_HOST|FIREBASE_STORAGE_EMULATOR_HOST)\s*=/,
      );
    }
  });

  it("allows production only for the explicitly reviewed company-review seed", () => {
    for (const script of firebaseWriteOrSmokeScripts) {
      const source = readFileSync(resolve(repositoryRoot, "scripts", script), "utf8");
      expect(source.includes("productionProjects:"), script).toBe(script === "seed-company-reviews.mjs");
    }
  });

  it("does not read Firebase CLI bearer tokens or print seeded passwords", () => {
    const companySeed = readFileSync(resolve(repositoryRoot, "scripts", "seed-company-reviews.mjs"), "utf8");
    const emulatorSeed = readFileSync(resolve(repositoryRoot, "scripts", "seed-emulator.mjs"), "utf8");

    expect(companySeed).not.toMatch(/firebase-tools\.json|access_token|Bearer\s+\$\{/);
    expect(emulatorSeed).not.toMatch(/password:\s*\$\{PASSWORD\}/i);
  });

  it("supplies a stable valid operation ID for every billing checkout", () => {
    const billingSmoke = readFileSync(
      resolve(repositoryRoot, "scripts", "billing-credits-smoke.mjs"),
      "utf8",
    );
    const operationLabels = [
      ...billingSmoke.matchAll(/`billing-smoke:([A-Za-z0-9._:-]+):\$\{CHECKOUT_RUN_ID\}`/g),
    ].map((match) => match[1]);
    const checkoutCalls = [...billingSmoke.matchAll(/(?:candidate|employer)CreateCheckout\(\{/g)];
    const sampleRunId = "00000000-0000-4000-8000-000000000000";
    const sampleIds = operationLabels.map((label) => `billing-smoke:${label}:${sampleRunId}`);

    expect(billingSmoke).toContain("const CHECKOUT_RUN_ID = randomUUID();");
    expect(operationLabels).toHaveLength(4);
    expect(new Set(operationLabels).size).toBe(4);
    expect(sampleIds.every((id) => /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(id))).toBe(true);
    expect(checkoutCalls).toHaveLength(5);
    expect(billingSmoke.match(/operationId:\s*CHECKOUT_OPERATION_IDS\./g)).toHaveLength(5);
    expect(billingSmoke.match(/operationId:\s*CHECKOUT_OPERATION_IDS\.candidateSubscription/g)).toHaveLength(2);
  });
});
