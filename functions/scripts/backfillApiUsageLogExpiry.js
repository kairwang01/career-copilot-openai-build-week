/**
 * Add the 90-day TTL timestamp to usage logs created before TTL was introduced.
 * Dry-run is no-I/O; production writes require explicit project and action gates.
 */

const SCRIPT_NAME = "backfillApiUsageLogExpiry";
const RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

const hasExpiry = (snapshot) =>
  Object.prototype.hasOwnProperty.call(snapshot.data() || {}, "expires_at");

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
      action: "BACKFILL_API_USAGE_TTL",
      subject: "api_usage_logs.expires_at",
      argv,
      allowProduction: true,
      requireTypedConfirmation: true,
    });

    if (operation.dryRun) {
      printDryRun(operation);
      console.log(`Retention: 90 days; page size: ${pageSize}.`);
      console.log(`Apply confirmation: --confirm-action "${operation.expectedConfirmation}"`);
      return;
    }

    const admin = require("firebase-admin");
    initializedApp = admin.apps.length
      ? admin.app()
      : admin.initializeApp({ projectId: operation.projectId });
    const db = admin.firestore();
    const documentId = admin.firestore.FieldPath.documentId();
    let scanned = 0;
    let updated = 0;
    let invalidTimestamp = 0;
    let cursor;

    while (true) {
      let query = db.collection("api_usage_logs").orderBy(documentId).limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      scanned += snapshot.size;

      const batch = db.batch();
      let pageUpdates = 0;
      for (const log of snapshot.docs) {
        if (hasExpiry(log)) continue;
        const timestamp = log.get("timestamp");
        if (!timestamp || typeof timestamp.toMillis !== "function") {
          invalidTimestamp += 1;
          continue;
        }
        batch.update(log.ref, {
          expires_at: admin.firestore.Timestamp.fromMillis(timestamp.toMillis() + RETENTION_MS),
        });
        pageUpdates += 1;
      }
      if (pageUpdates > 0) await batch.commit();
      updated += pageUpdates;
      cursor = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < pageSize) break;
    }

    let remainingMissing = 0;
    cursor = undefined;
    while (true) {
      let query = db.collection("api_usage_logs").orderBy(documentId).limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      remainingMissing += snapshot.docs.filter((log) => !hasExpiry(log)).length;
      cursor = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < pageSize) break;
    }

    console.log(
      `scanned=${scanned} updated=${updated} invalid_timestamp=${invalidTimestamp} remaining_missing_expiry=${remainingMissing}`,
    );
    if (remainingMissing !== 0) {
      throw new OperationSafetyError(
        SCRIPT_NAME,
        "Usage logs remain without an expiry. Do not enable the TTL policy.",
      );
    }
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  } finally {
    if (initializedApp) await initializedApp.delete();
  }
})();
