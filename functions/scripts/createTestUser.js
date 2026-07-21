/**
 * Create or update an emulator-only executive-tier test user.
 *
 * Dry-run (default):
 *   node scripts/createTestUser.js --email tester@example.test
 *
 * Apply to the local emulator:
 *   TEST_USER_PASSWORD='<strong-local-password>' node scripts/createTestUser.js \
 *     --email tester@example.test --credits 1000 --apply
 *
 * Production mode is intentionally refused. Passwords are accepted only from
 * TEST_USER_PASSWORD so they do not appear in shell history or process lists.
 */
const admin = require("firebase-admin");

const SCRIPT_NAME = "createTestUser";

(async () => {
  const {
    assertMaximumPositionals,
    isAuthUserNotFound,
    OperationSafetyError,
    parseBoundedInteger,
    positionalArguments,
    prepareFirebaseOperation,
    printDryRun,
    readOption,
    requireEmail,
    requirePasswordFromEnvironment,
  } = await import("./guardedFirebaseOperation.mjs");

  try {
    const argv = process.argv.slice(2);
    if (readOption(argv, "--password") !== undefined) {
      throw new OperationSafetyError(
        SCRIPT_NAME,
        "Command-line passwords are refused; use TEST_USER_PASSWORD.",
      );
    }
    const positional = positionalArguments(argv, ["--email", "--credits", "--password"]);
    assertMaximumPositionals(positional, 1, SCRIPT_NAME);
    const email = requireEmail(readOption(argv, "--email") || positional[0], SCRIPT_NAME);
    const credits = parseBoundedInteger(readOption(argv, "--credits"), {
      scriptName: SCRIPT_NAME,
      label: "credits",
      minimum: 0,
      maximum: 10_000,
      fallback: 1_000,
    });
    const operation = prepareFirebaseOperation({
      scriptName: SCRIPT_NAME,
      action: "UPSERT_EXECUTIVE_TEST_USER",
      subject: email,
      argv,
      allowProduction: false,
    });

    if (operation.dryRun) {
      printDryRun(operation);
      console.log(`Planned credit balance: ${credits}`);
      return;
    }

    const password = requirePasswordFromEnvironment({
      env: process.env,
      name: "TEST_USER_PASSWORD",
      scriptName: SCRIPT_NAME,
      apply: true,
    });
    admin.initializeApp({ projectId: operation.projectId });

    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
      user = await admin.auth().updateUser(user.uid, { password, emailVerified: true });
      console.log(`Updated existing emulator user ${user.uid}.`);
    } catch (error) {
      if (!isAuthUserNotFound(error)) throw error;
      user = await admin.auth().createUser({
        email,
        password,
        emailVerified: true,
        displayName: "Test User (Executive)",
      });
      console.log(`Created emulator user ${user.uid}.`);
    }

    const now = new Date().toISOString();
    await admin.firestore().collection("users").doc(user.uid).set(
      {
        credits,
        role: "candidate",
        subscription_status: "executive",
        full_name: "Test User (Executive)",
        avatar_url: null,
        created_at: now,
        updated_at: now,
      },
      { merge: true },
    );

    console.log(`users/${user.uid} is ready with executive tier and ${credits} credits.`);
    console.log(
      `Sign-in email: ${email}. Password was read from TEST_USER_PASSWORD and not printed.`,
    );
  } catch (error) {
    const { safeFailureMessage } = await import("./guardedFirebaseOperation.mjs");
    console.error(safeFailureMessage(error));
    process.exitCode = 1;
  }
})();
