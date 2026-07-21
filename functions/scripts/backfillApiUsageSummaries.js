/**
 * Apply every retained API usage log to the sharded day/month summaries.
 * Dry-run is no-I/O; production writes require explicit project and action gates.
 */

const SCRIPT_NAME = "backfillApiUsageSummaries";
const SUMMARY_VERSION = 1;
const CONCURRENCY = 10;

async function mapWithConcurrency(values, concurrency, callback) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

(async () => {
  const {
    assertMaximumPositionals,
    OperationSafetyError,
    parseBoundedInteger,
    positionalArguments,
    prepareFirebaseOperation,
    printDryRun,
    readOption,
    safeFailureMessage,
  } = await import("./guardedFirebaseOperation.mjs");

  let initializedApp;
  try {
    const argv = process.argv.slice(2);
    assertMaximumPositionals(positionalArguments(argv, ["--page-size"]), 0, SCRIPT_NAME);
    const pageSize = parseBoundedInteger(readOption(argv, "--page-size"), {
      scriptName: SCRIPT_NAME,
      label: "page-size",
      minimum: 1,
      maximum: 400,
      fallback: 200,
    });
    const operation = prepareFirebaseOperation({
      scriptName: SCRIPT_NAME,
      action: "BACKFILL_API_USAGE_SUMMARIES",
      subject: "api_usage_logs.summary_version",
      argv,
      allowProduction: true,
      requireTypedConfirmation: true,
    });

    if (operation.dryRun) {
      printDryRun(operation);
      console.log(`Summary version: ${SUMMARY_VERSION}; page size: ${pageSize}; concurrency: ${CONCURRENCY}.`);
      console.log(`Apply confirmation: --confirm-action "${operation.expectedConfirmation}"`);
      return;
    }

    let summaryModulePath;
    try {
      summaryModulePath = require.resolve("../lib/handlers/apiPlatform.js");
    } catch {
      throw new OperationSafetyError(
        SCRIPT_NAME,
        "Built Functions output is missing. Run npm --prefix functions run build first.",
      );
    }

    const admin = require("firebase-admin");
    initializedApp = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ projectId: operation.projectId });
    const { applyApiUsageSummaryForLog } = require(summaryModulePath);
    if (typeof applyApiUsageSummaryForLog !== "function") {
      throw new OperationSafetyError(
        SCRIPT_NAME,
        "The built API usage summary helper is unavailable. Rebuild Functions.",
      );
    }

    const db = admin.firestore();
    const documentId = admin.firestore.FieldPath.documentId();
    const counts = {
      scanned: 0,
      applied: 0,
      alreadyApplied: 0,
      missing: 0,
      invalidTimestamp: 0,
      invalidStatus: 0,
      invalidMarker: 0,
    };
    let cursor;

    while (true) {
      let query = db.collection("api_usage_logs").orderBy(documentId).limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      counts.scanned += snapshot.size;

      const statuses = await mapWithConcurrency(snapshot.docs, CONCURRENCY, (log) =>
        applyApiUsageSummaryForLog(log.id, db),
      );
      for (const status of statuses) {
        if (status === "applied") counts.applied += 1;
        if (status === "already_applied") counts.alreadyApplied += 1;
        if (status === "missing") counts.missing += 1;
        if (status === "invalid_timestamp") counts.invalidTimestamp += 1;
        if (status === "invalid_status") counts.invalidStatus += 1;
        if (status === "invalid_marker") counts.invalidMarker += 1;
      }

      cursor = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < pageSize) break;
    }

    let remainingUnapplied = 0;
    let remainingInvalidTimestamp = 0;
    let remainingInvalidStatus = 0;
    let remainingInvalidMarker = 0;
    cursor = undefined;
    while (true) {
      let query = db.collection("api_usage_logs").orderBy(documentId).limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      const statuses = await mapWithConcurrency(snapshot.docs, CONCURRENCY, (log) =>
        applyApiUsageSummaryForLog(log.id, db),
      );
      for (const status of statuses) {
        if (status !== "already_applied") remainingUnapplied += 1;
        if (status === "invalid_timestamp") remainingInvalidTimestamp += 1;
        if (status === "invalid_status") remainingInvalidStatus += 1;
        if (status === "invalid_marker") remainingInvalidMarker += 1;
      }
      cursor = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < pageSize) break;
    }

    console.log(
      [
        `scanned=${counts.scanned}`,
        `applied=${counts.applied}`,
        `already_applied=${counts.alreadyApplied}`,
        `missing=${counts.missing}`,
        `invalid_timestamp=${counts.invalidTimestamp}`,
        `invalid_status=${counts.invalidStatus}`,
        `invalid_marker=${counts.invalidMarker}`,
        `remaining_invalid_timestamp=${remainingInvalidTimestamp}`,
        `remaining_invalid_status=${remainingInvalidStatus}`,
        `remaining_invalid_marker=${remainingInvalidMarker}`,
        `remaining_unapplied=${remainingUnapplied}`,
      ].join(" "),
    );

    if (
      counts.missing !== 0 ||
      remainingInvalidTimestamp !== 0 ||
      remainingInvalidStatus !== 0 ||
      remainingInvalidMarker !== 0 ||
      remainingUnapplied !== 0
    ) {
      throw new OperationSafetyError(
        SCRIPT_NAME,
        "Usage logs remain outside the exact summary. Do not deploy apiPlatformGetUsage.",
      );
    }

    await db.collection("api_usage_summary_state").doc("rollout_v1").set(
      {
        summary_version: SUMMARY_VERSION,
        source_collection: "api_usage_logs",
        last_verified_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    console.log(`checkpoint=ready summary_version=${SUMMARY_VERSION}`);
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  } finally {
    if (initializedApp) await initializedApp.delete();
  }
})();
