import { configureFirebaseScript } from "../../scripts/lib/firebase-script-safety.mjs";

export const PRODUCTION_PROJECT_ALLOWLIST = Object.freeze(["career-copilot-a3168"]);

export class OperationSafetyError extends Error {
  constructor(scriptName, message) {
    super(`[${scriptName}] ${message}`);
    this.name = "OperationSafetyError";
  }
}

const hasValue = (value) => typeof value === "string" && value.trim().length > 0;

export function readOption(argv, name) {
  const inlinePrefix = `${name}=`;
  const inline = argv.find((argument) => argument.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length).trim();

  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) return "";
  return value.trim();
}

export function positionalArguments(argv, valueOptions = []) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith("--") || argument === "-P") {
      const optionName = argument.includes("=") ? argument.split("=", 1)[0] : argument;
      const optionsWithValues = [...valueOptions, "--project", "-P", "--confirm-action"];
      if (!argument.includes("=") && optionsWithValues.includes(optionName)) {
        index += 1;
      }
      continue;
    }
    values.push(argument);
  }
  return values;
}

export function assertMaximumPositionals(values, maximum, scriptName) {
  if (values.length > maximum) {
    throw new OperationSafetyError(
      scriptName,
      "Unexpected positional arguments were supplied; use the documented named options.",
    );
  }
}

export function requireEmail(value, scriptName) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new OperationSafetyError(scriptName, "A valid explicit email address is required.");
  }
  return email;
}

export function requireFirebaseUid(value, scriptName) {
  const uid = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new OperationSafetyError(scriptName, "A valid explicit Firebase UID is required.");
  }
  return uid;
}

export function parseBoundedInteger(value, { scriptName, label, minimum, maximum, fallback }) {
  const source = hasValue(value) ? value.trim() : String(fallback);
  if (!/^(?:0|[1-9]\d*)$/.test(source)) {
    throw new OperationSafetyError(scriptName, `${label} must be an integer.`);
  }
  const parsed = Number(source);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new OperationSafetyError(
      scriptName,
      `${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

export function requirePasswordFromEnvironment({ env, name, scriptName, apply }) {
  if (!apply) return undefined;
  const password = env[name];
  if (!hasValue(password)) {
    throw new OperationSafetyError(
      scriptName,
      `${name} must be set in the environment; command-line passwords are refused.`,
    );
  }
  if (
    password.length < 12 ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new OperationSafetyError(
      scriptName,
      `${name} must be at least 12 characters and contain upper, lower, number, and symbol characters.`,
    );
  }
  return password;
}

export function prepareFirebaseOperation({
  scriptName,
  action,
  subject,
  argv = process.argv.slice(2),
  env = process.env,
  stdinIsTTY = process.stdin.isTTY === true,
  allowProduction = false,
  requireTypedConfirmation = false,
}) {
  if (argv.includes("--apply") && argv.includes("--dry-run")) {
    throw new OperationSafetyError(scriptName, "Choose either --apply or --dry-run, not both.");
  }

  const target = configureFirebaseScript({
    scriptName,
    argv,
    env,
    stdinIsTTY,
    productionProjects: allowProduction ? PRODUCTION_PROJECT_ALLOWLIST : [],
  });
  const apply = argv.includes("--apply");
  const expectedConfirmation = `${action}:${target.projectId}:${subject}`;

  if (apply && requireTypedConfirmation) {
    const confirmation = readOption(argv, "--confirm-action");
    if (confirmation !== expectedConfirmation) {
      throw new OperationSafetyError(
        scriptName,
        `The write requires --confirm-action "${expectedConfirmation}".`,
      );
    }
  }

  return {
    ...target,
    action,
    subject,
    apply,
    dryRun: !apply,
    expectedConfirmation,
  };
}

export function printDryRun(operation) {
  console.log(`[DRY RUN] ${operation.action}`);
  console.log(`Target mode: ${operation.mode}`);
  console.log(`Target project: ${operation.projectId}`);
  console.log(`Subject: ${operation.subject}`);
  console.log("No Firebase SDK was initialized and no remote read or write occurred.");
  console.log("Re-run with --apply only after reviewing this plan.");
}

export function isAuthUserNotFound(error) {
  return Boolean(error && typeof error === "object" && error.code === "auth/user-not-found");
}

export function safeFailureMessage(error) {
  if (
    error &&
    typeof error === "object" &&
    (error.name === "OperationSafetyError" || error.name === "ScriptSafetyError") &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  const code =
    error && typeof error === "object" && typeof error.code === "string" ? error.code : "unknown";
  return `Firebase operation failed (${code}). Sensitive input was not printed.`;
}
