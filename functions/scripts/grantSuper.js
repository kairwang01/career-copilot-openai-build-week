/**
 * Grant the super role through the authoritative RBAC document.
 *
 * No email or production project is implicit. The script is dry-run by
 * default, preserves unrelated custom claims, and requires an exact typed
 * confirmation before any write.
 */
const admin = require("firebase-admin");

const SCRIPT_NAME = "grantSuper";

(async () => {
  const {
    assertMaximumPositionals,
    OperationSafetyError,
    positionalArguments,
    prepareFirebaseOperation,
    printDryRun,
    readOption,
    requireEmail,
    requireFirebaseUid,
    safeFailureMessage,
  } = await import("./guardedFirebaseOperation.mjs");

  try {
    const argv = process.argv.slice(2);
    const positional = positionalArguments(argv, ["--email"]);
    assertMaximumPositionals(positional, 1, SCRIPT_NAME);
    const email = requireEmail(readOption(argv, "--email") || positional[0], SCRIPT_NAME);
    const operation = prepareFirebaseOperation({
      scriptName: SCRIPT_NAME,
      action: "GRANT_SUPER",
      subject: email,
      argv,
      allowProduction: true,
      requireTypedConfirmation: true,
    });

    if (operation.dryRun) {
      printDryRun(operation);
      console.log(`Apply confirmation: --confirm-action "${operation.expectedConfirmation}"`);
      return;
    }

    const changeReason = String(process.env.ADMIN_CHANGE_REASON ?? "").trim();
    if (operation.mode === "production" && changeReason.length < 8) {
      throw new OperationSafetyError(
        SCRIPT_NAME,
        "Production role grants require ADMIN_CHANGE_REASON with an audit-ticket or reason.",
      );
    }

    admin.initializeApp({ projectId: operation.projectId });
    const auth = admin.auth();
    const db = admin.firestore();
    const user = await auth.getUserByEmail(email);
    requireFirebaseUid(user.uid, SCRIPT_NAME);
    const ref = db.collection("platform_config").doc("access");
    const timestamp = new Date().toISOString();

    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const data = snap.exists ? snap.data() || {} : {};
      if (
        data.admins !== undefined &&
        (typeof data.admins !== "object" || Array.isArray(data.admins))
      ) {
        throw new OperationSafetyError(
          SCRIPT_NAME,
          "The RBAC admins map is malformed; refusing to overwrite it.",
        );
      }
      const admins = { ...(data.admins || {}) };
      const existing = admins[user.uid];
      admins[user.uid] = {
        ...existing,
        role: "super",
        email,
        status: "active",
        invited_by: changeReason || "guarded-super-script",
        invited_at: existing?.invited_at || timestamp,
      };
      transaction.set(ref, { admins, updated_at: timestamp }, { merge: true });
    });

    await auth.setCustomUserClaims(user.uid, {
      ...(user.customClaims || {}),
      admin: true,
    });

    console.log(`Granted super access to ${email} (${user.uid}).`);
    console.log(
      "The existing custom claims were preserved. Sign out and back in to refresh the token.",
    );
  } catch (error) {
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  }
})();
