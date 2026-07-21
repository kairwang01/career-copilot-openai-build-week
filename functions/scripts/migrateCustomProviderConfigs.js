/**
 * Move legacy users/{uid}.custom_provider credentials into the private store.
 *
 * The script is a no-I/O dry run by default. Apply mode requires the same
 * production gates as privileged role changes plus an exact typed confirmation.
 * Build Functions before apply so the canonical transactional helper exists.
 */

const SCRIPT_NAME = "migrateCustomProviderConfigs";
const ACTION = "MIGRATE_CUSTOM_PROVIDER";
const SUBJECT = "users.custom_provider";
const CONCURRENCY = 10;

const hasLegacyField = (snapshot) =>
  snapshot.exists &&
  Object.prototype.hasOwnProperty.call(snapshot.data() || {}, "custom_provider");

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
      maximum: 500,
      fallback: 200,
    });
    const operation = prepareFirebaseOperation({
      scriptName: SCRIPT_NAME,
      action: ACTION,
      subject: SUBJECT,
      argv,
      allowProduction: true,
      requireTypedConfirmation: true,
    });

    if (operation.dryRun) {
      printDryRun(operation);
      console.log(`Page size: ${pageSize}; concurrency: ${CONCURRENCY}.`);
      console.log(`Apply confirmation: --confirm-action "${operation.expectedConfirmation}"`);
      return;
    }

    let migrationModulePath;
    try {
      migrationModulePath = require.resolve("../lib/llm/customProviderStore.js");
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
    const { migrateLegacyCustomProviderConfig } = require(migrationModulePath);
    if (typeof migrateLegacyCustomProviderConfig !== "function") {
      throw new OperationSafetyError(
        SCRIPT_NAME,
        "The built custom-provider migration helper is unavailable. Rebuild Functions.",
      );
    }
    const db = admin.firestore();
    const documentId = admin.firestore.FieldPath.documentId();
    const counts = {
      scanned: 0,
      legacyFound: 0,
      migrated: 0,
      privatePreserved: 0,
      invalidRemoved: 0,
    };

    let cursor;
    while (true) {
      let query = db.collection("users").orderBy(documentId).limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;

      counts.scanned += snapshot.size;
      const legacyDocs = snapshot.docs.filter(hasLegacyField);
      counts.legacyFound += legacyDocs.length;
      const statuses = await mapWithConcurrency(legacyDocs, CONCURRENCY, (userDoc) =>
        migrateLegacyCustomProviderConfig(userDoc.id, db).then((result) => result.status),
      );
      for (const status of statuses) {
        if (status === "migrated") counts.migrated += 1;
        if (status === "private_preserved") counts.privatePreserved += 1;
        if (status === "invalid_removed") counts.invalidRemoved += 1;
      }

      cursor = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < pageSize) break;
    }

    let remainingLegacyFields = 0;
    cursor = undefined;
    while (true) {
      let query = db.collection("users").orderBy(documentId).limit(pageSize);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      remainingLegacyFields += snapshot.docs.filter(hasLegacyField).length;
      cursor = snapshot.docs[snapshot.docs.length - 1];
      if (snapshot.size < pageSize) break;
    }

    console.log(
      [
        `scanned=${counts.scanned}`,
        `legacy_found=${counts.legacyFound}`,
        `migrated=${counts.migrated}`,
        `private_preserved=${counts.privatePreserved}`,
        `invalid_removed=${counts.invalidRemoved}`,
        `remaining_legacy_fields=${remainingLegacyFields}`,
      ].join(" "),
    );
    if (remainingLegacyFields !== 0) {
      throw new OperationSafetyError(
        SCRIPT_NAME,
        "Legacy fields remain after migration. Do not deploy the strict Firestore rules.",
      );
    }
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  } finally {
    if (initializedApp) await initializedApp.delete();
  }
})();
