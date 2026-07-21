import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PRODUCTION_PROJECT_ALLOWLIST,
  assertMaximumPositionals,
  parseBoundedInteger,
  positionalArguments,
  prepareFirebaseOperation,
  requirePasswordFromEnvironment,
  safeFailureMessage,
} from "../functions/scripts/guardedFirebaseOperation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const scriptsDirectory = resolve(repositoryRoot, "functions", "scripts");
const guardedScripts = [
  "backfillApiUsageLogExpiry.js",
  "backfillApiUsageSummaries.js",
  "createTestUser.js",
  "grantAdmin.js",
  "grantSuper.js",
  "migrateCustomProviderConfigs.js",
  "seedBusinessAccount.js",
  "seedCandidates.js",
  "seedJobs.js",
];

const source = (name: string) => readFileSync(resolve(scriptsDirectory, name), "utf8");

describe("functions/scripts production safety", () => {
  it("defaults an operation to an emulator dry run", () => {
    const env: Record<string, string> = {};
    const operation = prepareFirebaseOperation({
      scriptName: "unit-test",
      action: "TEST_ACTION",
      subject: "synthetic-subject",
      argv: [],
      env,
      stdinIsTTY: false,
    });

    expect(operation).toMatchObject({
      mode: "emulator",
      projectId: "demo-careercopilot",
      apply: false,
      dryRun: true,
    });
    expect(env).toMatchObject({
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9199",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    });
  });

  it("refuses production for seed and test-account operations", () => {
    expect(() =>
      prepareFirebaseOperation({
        scriptName: "unit-test",
        action: "SEED_TEST_DATA",
        subject: "synthetic",
        argv: ["--production", "--project", PRODUCTION_PROJECT_ALLOWLIST[0]],
        env: {
          ALLOW_PRODUCTION_WRITES: "1",
          CONFIRM_PRODUCTION_PROJECT: PRODUCTION_PROJECT_ALLOWLIST[0],
        },
        stdinIsTTY: true,
        allowProduction: false,
      }),
    ).toThrow(/emulator-only/i);
  });

  it("requires the exact typed confirmation for a privileged write", () => {
    const common = {
      scriptName: "unit-test",
      action: "GRANT_SUPER",
      subject: "admin@example.test",
      env: {} as Record<string, string>,
      stdinIsTTY: true,
      allowProduction: true,
      requireTypedConfirmation: true,
    };

    expect(() => prepareFirebaseOperation({ ...common, argv: ["--apply"] })).toThrow(
      /--confirm-action/i,
    );
    expect(
      prepareFirebaseOperation({
        ...common,
        env: {},
        argv: [
          "--apply",
          "--confirm-action",
          "GRANT_SUPER:demo-careercopilot:admin@example.test",
        ],
      }),
    ).toMatchObject({ apply: true, mode: "emulator" });
  });

  it("requires all production gates before a privileged operation can apply", () => {
    const projectId = PRODUCTION_PROJECT_ALLOWLIST[0];
    const argv = [
      "--production",
      "--project",
      projectId,
      "--apply",
      "--confirm-action",
      `GRANT_ADMIN:${projectId}:admin@example.test`,
    ];

    expect(() =>
      prepareFirebaseOperation({
        scriptName: "unit-test",
        action: "GRANT_ADMIN",
        subject: "admin@example.test",
        argv,
        env: {},
        stdinIsTTY: true,
        allowProduction: true,
        requireTypedConfirmation: true,
      }),
    ).toThrow(/ALLOW_PRODUCTION_WRITES/);

    expect(
      prepareFirebaseOperation({
        scriptName: "unit-test",
        action: "GRANT_ADMIN",
        subject: "admin@example.test",
        argv,
        env: {
          ALLOW_PRODUCTION_WRITES: "1",
          CONFIRM_PRODUCTION_PROJECT: projectId,
        },
        stdinIsTTY: true,
        allowProduction: true,
        requireTypedConfirmation: true,
      }),
    ).toMatchObject({ apply: true, mode: "production", projectId });
  });

  it("accepts passwords only from an environment variable on apply", () => {
    expect(
      requirePasswordFromEnvironment({
        env: {},
        name: "TEST_PASSWORD",
        scriptName: "unit-test",
        apply: false,
      }),
    ).toBeUndefined();
    expect(() =>
      requirePasswordFromEnvironment({
        env: {},
        name: "TEST_PASSWORD",
        scriptName: "unit-test",
        apply: true,
      }),
    ).toThrow(/environment/i);
    expect(
      requirePasswordFromEnvironment({
        env: { TEST_PASSWORD: "StrongLocal!234" },
        name: "TEST_PASSWORD",
        scriptName: "unit-test",
        apply: true,
      }),
    ).toBe("StrongLocal!234");
  });

  it("does not echo an arbitrary Firebase error message", () => {
    const secret = "StrongLocal!234";
    const message = safeFailureMessage({ code: "auth/internal-error", message: secret });
    expect(message).toContain("auth/internal-error");
    expect(message).not.toContain(secret);
  });

  it("parses bounded integers and positional values fail-closed", () => {
    expect(
      parseBoundedInteger("20", {
        scriptName: "unit-test",
        label: "count",
        minimum: 1,
        maximum: 20,
        fallback: 6,
      }),
    ).toBe(20);
    expect(() =>
      parseBoundedInteger("20junk", {
        scriptName: "unit-test",
        label: "count",
        minimum: 1,
        maximum: 20,
        fallback: 6,
      }),
    ).toThrow(/integer/i);
    expect(
      positionalArguments(
        ["target", "12", "--project", "demo-careercopilot", "--apply"],
        [],
      ),
    ).toEqual(["target", "12"]);
    expect(() => assertMaximumPositionals(["email", "secret"], 1, "unit-test")).toThrow(
      /unexpected positional/i,
    );
  });

  it.each(guardedScripts)("guards %s before Firebase initialization", (name) => {
    const script = source(name);
    expect(script).toContain("guardedFirebaseOperation.mjs");
    expect(script).toContain("prepareFirebaseOperation");
    expect(script).toContain("operation.dryRun");
    expect(script).not.toMatch(/process\.env\.GCLOUD_PROJECT\s*\|\|/);
    expect(script).not.toContain('"career-copilot-a3168"');
    expect(script.indexOf("operation.dryRun")).toBeLessThan(script.indexOf("admin.initializeApp"));
  });

  it("keeps synthetic account scripts emulator-only and free of known passwords", () => {
    const accountScripts = ["createTestUser.js", "seedBusinessAccount.js", "seedCandidates.js"];
    const combined = accountScripts.map(source).join("\n");
    accountScripts.forEach((name) => expect(source(name)).toMatch(/allowProduction:\s*false/));
    expect(combined).not.toMatch(/TestUser!2026|AbiTest!2026|CandidateTest!2026/);
    expect(combined).not.toMatch(/Password:\s*\$\{password\}/);
    expect(combined).toContain("Command-line passwords are refused");
  });

  it("uses the current RBAC map transactionally without overwriting unrelated claims", () => {
    for (const name of ["grantAdmin.js", "grantSuper.js"]) {
      const script = source(name);
      expect(script).toContain("allowProduction: true");
      expect(script).toContain("requireTypedConfirmation: true");
      expect(script).toContain("db.runTransaction");
      expect(script).toContain("...(user.customClaims || {})");
      expect(script).toContain("ADMIN_CHANGE_REASON");
      expect(script).not.toContain("admin_uids");
    }
  });

  it("makes repeated job seeding deterministic and validates employer ownership", () => {
    expect(source("seedBusinessAccount.js")).toContain("seed-business-${uid}-${index + 1}");
    const jobs = source("seedJobs.js");
    expect(jobs).toContain("seed-job-${employerUid}-${index + 1}");
    expect(jobs).toContain('employer.data()?.role !== "employer"');
    expect(jobs).not.toContain("Math.random()");
  });

  it("migrates legacy provider secrets with bounded paging and a zero-residue rescan", () => {
    const migration = source("migrateCustomProviderConfigs.js");
    expect(migration).toContain('action: ACTION');
    expect(migration).toContain('subject: SUBJECT');
    expect(migration).toContain('allowProduction: true');
    expect(migration).toContain('requireTypedConfirmation: true');
    expect(migration).toContain('.orderBy(documentId).limit(pageSize)');
    expect(migration).toContain('.startAfter(cursor)');
    expect(migration).toContain('mapWithConcurrency(legacyDocs, CONCURRENCY');
    expect(migration).toContain('remaining_legacy_fields=${remainingLegacyFields}');
    expect(migration).toContain('Do not deploy the strict Firestore rules');
    expect(migration).not.toContain('Math.random()');
    expect(migration).not.toMatch(/console\.(?:log|error)\([^\n]*(?:userDoc\.id|api_key)/);
  });

  it("backfills API usage TTL with bounded batches and verifies zero residue", () => {
    const backfill = source("backfillApiUsageLogExpiry.js");
    expect(backfill).toContain('action: "BACKFILL_API_USAGE_TTL"');
    expect(backfill).toContain('subject: "api_usage_logs.expires_at"');
    expect(backfill).toContain('allowProduction: true');
    expect(backfill).toContain('requireTypedConfirmation: true');
    expect(backfill).toContain('.orderBy(documentId).limit(pageSize)');
    expect(backfill).toContain('expires_at: admin.firestore.Timestamp.fromMillis');
    expect(backfill).toContain('remaining_missing_expiry=${remainingMissing}');
    expect(backfill).toContain('Do not enable the TTL policy');
    expect(backfill).not.toContain('Math.random()');
  });

  it("backfills API usage summaries transactionally and verifies zero residue", () => {
    const backfill = source("backfillApiUsageSummaries.js");
    expect(backfill).toContain('action: "BACKFILL_API_USAGE_SUMMARIES"');
    expect(backfill).toContain('subject: "api_usage_logs.summary_version"');
    expect(backfill).toContain('allowProduction: true');
    expect(backfill).toContain('requireTypedConfirmation: true');
    expect(backfill).toContain('.orderBy(documentId).limit(pageSize)');
    expect(backfill).toContain('mapWithConcurrency(snapshot.docs, CONCURRENCY');
    expect(backfill).toContain('remaining_unapplied=${remainingUnapplied}');
    expect(backfill).toContain('remaining_invalid_marker=${remainingInvalidMarker}');
    expect(backfill).toContain('summary_version: SUMMARY_VERSION');
    expect(backfill).toContain('Do not deploy apiPlatformGetUsage');
    expect(backfill).not.toContain('Math.random()');
    expect(backfill).not.toMatch(/console\.(?:log|error)\([^\n]*(?:log\.id|key_id|request_id)/);
  });

  it("keeps shell smoke tests loopback-only, fail-closed, and free of persistent temp files", () => {
    const smoke = source("smoke-test.sh");
    expect(smoke).toContain("set -euo pipefail");
    expect(smoke).toContain('AUTH_URL="http://127.0.0.1:9199"');
    expect(smoke).toContain("ALLOW_LLM_SMOKE_TEST");
    expect(smoke).toContain("mktemp -d");
    expect(smoke).toContain("trap 'rm -rf");
    expect(smoke).not.toContain("/tmp/smoke-test-response.json");
    expect(smoke).not.toContain("Auth response: $AUTH_RESPONSE");

    const concurrency = source("concurrency-test.sh");
    expect(concurrency).toContain("set -euo pipefail");
    expect(concurrency).toContain('AUTH_URL="http://127.0.0.1:9199"');
    expect(concurrency).toContain("ALLOW_LLM_LOAD_TEST");
    expect(concurrency).toContain("N > 50");
    expect(concurrency).toContain("USER_UID=");
    expect(concurrency).not.toMatch(/^UID=/m);
    expect(concurrency).toContain("trap 'rm -rf");
  });
});
