import { basename, isAbsolute, relative, resolve } from "node:path";

export const DEFAULT_EMULATOR_PROJECT = "demo-careercopilot";

const DEFAULT_ENDPOINTS = Object.freeze({
  auth: "127.0.0.1:9199",
  firestore: "127.0.0.1:8080",
  storage: "127.0.0.1:9197",
  functionsHost: "127.0.0.1",
  functionsPort: "5001",
});

const EMULATOR_ENV_KEYS = Object.freeze([
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_STORAGE_EMULATOR_HOST",
  "STORAGE_EMULATOR_HOST",
  "VITE_FIREBASE_AUTH_EMULATOR_URL",
  "VITE_FIRESTORE_EMULATOR_HOST",
  "VITE_FIRESTORE_EMULATOR_PORT",
  "VITE_FIREBASE_STORAGE_EMULATOR_HOST",
  "VITE_FIREBASE_STORAGE_EMULATOR_PORT",
  "VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST",
  "VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT",
]);

export class ScriptSafetyError extends Error {
  constructor(scriptName, message) {
    super(`[${scriptName}] ${message}`);
    this.name = "ScriptSafetyError";
  }
}

const hasValue = (value) => typeof value === "string" && value.trim().length > 0;

const isTruthy = (value) => /^(1|true|yes|on)$/i.test(String(value ?? "").trim());

const parseOption = (argv, name) => {
  const inlinePrefix = `${name}=`;
  const inline = argv.find((argument) => argument.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length).trim();

  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) return "";
  return value.trim();
};

const projectFromFirebaseConfig = (value, scriptName) => {
  if (!hasValue(value)) return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) {
    throw new ScriptSafetyError(
      scriptName,
      "FIREBASE_CONFIG must be inline JSON for guarded scripts; file-based config is refused.",
    );
  }

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed?.projectId === "string" ? parsed.projectId.trim() : undefined;
  } catch {
    throw new ScriptSafetyError(scriptName, "FIREBASE_CONFIG is not valid JSON.");
  }
};

const isDemoProject = (projectId) => /^demo-[a-z0-9][a-z0-9-]*$/i.test(projectId);

const isLoopbackHostname = (hostname) => {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  if (!/^127(?:\.\d{1,3}){3}$/.test(normalized)) return false;
  return normalized
    .split(".")
    .slice(1)
    .every((part) => Number(part) >= 0 && Number(part) <= 255);
};

const parseLoopbackEndpoint = (
  value,
  { scriptName, label, requirePort = true, allowProtocol = false },
) => {
  if (!hasValue(value)) {
    throw new ScriptSafetyError(scriptName, `${label} is empty.`);
  }
  const trimmed = value.trim();
  const includesProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (includesProtocol && !allowProtocol) {
    throw new ScriptSafetyError(scriptName, `${label} must not include a URL protocol.`);
  }

  let parsed;
  try {
    parsed = new URL(includesProtocol ? trimmed : `http://${trimmed}`);
  } catch {
    throw new ScriptSafetyError(scriptName, `${label} is not a valid emulator endpoint.`);
  }

  if (!isLoopbackHostname(parsed.hostname)) {
    throw new ScriptSafetyError(scriptName, `${label} must use a loopback host.`);
  }
  if (includesProtocol && parsed.protocol !== "http:") {
    throw new ScriptSafetyError(scriptName, `${label} must use plain HTTP for a local emulator.`);
  }
  if (requirePort && !parsed.port) {
    throw new ScriptSafetyError(scriptName, `${label} must include an explicit port.`);
  }
  if (parsed.port && (Number(parsed.port) < 1 || Number(parsed.port) > 65535)) {
    throw new ScriptSafetyError(scriptName, `${label} contains an invalid port.`);
  }

  return {
    hostname: parsed.hostname.replace(/^\[|\]$/g, ""),
    port: parsed.port,
    hostPort: `${parsed.hostname}:${parsed.port}`,
  };
};

const validateMatchingEndpoint = (scriptName, label, first, second) => {
  if (first.hostname !== second.hostname || first.port !== second.port) {
    throw new ScriptSafetyError(scriptName, `${label} emulator settings disagree.`);
  }
};

const resolveEmulatorEndpoints = (env, scriptName) => {
  if (hasValue(env.VITE_FIREBASE_USE_EMULATOR) && !isTruthy(env.VITE_FIREBASE_USE_EMULATOR)) {
    throw new ScriptSafetyError(
      scriptName,
      "VITE_FIREBASE_USE_EMULATOR explicitly disables emulator routing.",
    );
  }

  const viteAuth = hasValue(env.VITE_FIREBASE_AUTH_EMULATOR_URL)
    ? parseLoopbackEndpoint(env.VITE_FIREBASE_AUTH_EMULATOR_URL, {
        scriptName,
        label: "VITE_FIREBASE_AUTH_EMULATOR_URL",
        allowProtocol: true,
      })
    : undefined;
  const auth = parseLoopbackEndpoint(
    env.FIREBASE_AUTH_EMULATOR_HOST || viteAuth?.hostPort || DEFAULT_ENDPOINTS.auth,
    { scriptName, label: "FIREBASE_AUTH_EMULATOR_HOST" },
  );
  if (viteAuth) validateMatchingEndpoint(scriptName, "Auth", auth, viteAuth);

  const firestoreFallback = [
    env.VITE_FIRESTORE_EMULATOR_HOST || "127.0.0.1",
    env.VITE_FIRESTORE_EMULATOR_PORT || DEFAULT_ENDPOINTS.firestore.split(":").at(-1),
  ].join(":");
  const firestore = parseLoopbackEndpoint(
    env.FIRESTORE_EMULATOR_HOST || firestoreFallback,
    { scriptName, label: "FIRESTORE_EMULATOR_HOST" },
  );
  if (hasValue(env.VITE_FIRESTORE_EMULATOR_HOST) || hasValue(env.VITE_FIRESTORE_EMULATOR_PORT)) {
    const viteFirestore = parseLoopbackEndpoint(firestoreFallback, {
      scriptName,
      label: "VITE Firestore emulator endpoint",
    });
    validateMatchingEndpoint(scriptName, "Firestore", firestore, viteFirestore);
  }

  const storageFromGoogle = hasValue(env.STORAGE_EMULATOR_HOST)
    ? parseLoopbackEndpoint(env.STORAGE_EMULATOR_HOST, {
        scriptName,
        label: "STORAGE_EMULATOR_HOST",
        allowProtocol: true,
      })
    : undefined;
  const storageFallback = [
    env.VITE_FIREBASE_STORAGE_EMULATOR_HOST || "127.0.0.1",
    env.VITE_FIREBASE_STORAGE_EMULATOR_PORT || DEFAULT_ENDPOINTS.storage.split(":").at(-1),
  ].join(":");
  const storage = parseLoopbackEndpoint(
    env.FIREBASE_STORAGE_EMULATOR_HOST || storageFromGoogle?.hostPort || storageFallback,
    { scriptName, label: "FIREBASE_STORAGE_EMULATOR_HOST" },
  );
  if (storageFromGoogle) validateMatchingEndpoint(scriptName, "Storage", storage, storageFromGoogle);
  if (
    hasValue(env.VITE_FIREBASE_STORAGE_EMULATOR_HOST) ||
    hasValue(env.VITE_FIREBASE_STORAGE_EMULATOR_PORT)
  ) {
    const viteStorage = parseLoopbackEndpoint(storageFallback, {
      scriptName,
      label: "VITE Storage emulator endpoint",
    });
    validateMatchingEndpoint(scriptName, "Storage", storage, viteStorage);
  }

  const functionsHost = parseLoopbackEndpoint(
    [
      env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST || DEFAULT_ENDPOINTS.functionsHost,
      env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT || DEFAULT_ENDPOINTS.functionsPort,
    ].join(":"),
    { scriptName, label: "Functions emulator endpoint" },
  );

  return { auth, firestore, storage, functionsHost };
};

const applyEmulatorEnvironment = (env, projectId, endpoints) => {
  env.FIREBASE_AUTH_EMULATOR_HOST = endpoints.auth.hostPort;
  env.FIRESTORE_EMULATOR_HOST = endpoints.firestore.hostPort;
  env.FIREBASE_STORAGE_EMULATOR_HOST = endpoints.storage.hostPort;
  env.STORAGE_EMULATOR_HOST = `http://${endpoints.storage.hostPort}`;

  env.VITE_FIREBASE_USE_EMULATOR = "true";
  env.VITE_FIREBASE_API_KEY = "demo-api-key";
  env.VITE_FIREBASE_AUTH_DOMAIN = `${projectId}.firebaseapp.com`;
  env.VITE_FIREBASE_PROJECT_ID = projectId;
  env.VITE_FIREBASE_STORAGE_BUCKET = `${projectId}.appspot.com`;
  env.VITE_FIREBASE_MESSAGING_SENDER_ID = "000000000000";
  env.VITE_FIREBASE_APP_ID = "1:000000000000:web:demo";
  env.VITE_FIREBASE_AUTH_EMULATOR_URL = `http://${endpoints.auth.hostPort}`;
  env.VITE_FIRESTORE_EMULATOR_HOST = endpoints.firestore.hostname;
  env.VITE_FIRESTORE_EMULATOR_PORT = endpoints.firestore.port;
  env.VITE_FIREBASE_STORAGE_EMULATOR_HOST = endpoints.storage.hostname;
  env.VITE_FIREBASE_STORAGE_EMULATOR_PORT = endpoints.storage.port;
  env.VITE_FIREBASE_FUNCTIONS_EMULATOR_HOST = endpoints.functionsHost.hostname;
  env.VITE_FIREBASE_FUNCTIONS_EMULATOR_PORT = endpoints.functionsHost.port;

  env.GCLOUD_PROJECT = projectId;
  env.GOOGLE_CLOUD_PROJECT = projectId;
  env.FIREBASE_CONFIG = JSON.stringify({
    projectId,
    storageBucket: `${projectId}.appspot.com`,
  });
};

/**
 * @typedef {object} FirebaseScriptSafetyOptions
 * @property {string} scriptName
 * @property {string[]} [argv]
 * @property {Record<string, string | undefined>} [env]
 * @property {boolean} [stdinIsTTY]
 * @property {readonly string[]} [productionProjects]
 */

/**
 * Configure and validate the Firebase target before any SDK initialization.
 *
 * @param {FirebaseScriptSafetyOptions} options
 */
export function configureFirebaseScript({
  scriptName,
  argv = process.argv.slice(2),
  env = process.env,
  stdinIsTTY = process.stdin.isTTY === true,
  productionProjects = [],
} = {}) {
  if (!hasValue(scriptName)) {
    throw new ScriptSafetyError("unknown-script", "scriptName is required.");
  }

  const productionRequested = argv.includes("--production");
  const cliProject = parseOption(argv, "--project") || parseOption(argv, "-P");
  if (productionRequested) {
    if (!hasValue(cliProject)) {
      throw new ScriptSafetyError(scriptName, "Production mode requires --project <project-id>.");
    }
    if (productionProjects.length === 0) {
      throw new ScriptSafetyError(scriptName, "This script is emulator-only; production is refused.");
    }
    if (!productionProjects.includes(cliProject)) {
      throw new ScriptSafetyError(scriptName, "The requested project is not in this script's allowlist.");
    }
    if (env.ALLOW_PRODUCTION_WRITES !== "1") {
      throw new ScriptSafetyError(scriptName, "Set ALLOW_PRODUCTION_WRITES=1 to confirm production writes.");
    }
    if (env.CONFIRM_PRODUCTION_PROJECT !== cliProject) {
      throw new ScriptSafetyError(
        scriptName,
        "CONFIRM_PRODUCTION_PROJECT must exactly match the allowlisted project ID.",
      );
    }

    const configuredEmulatorKey = EMULATOR_ENV_KEYS.find((key) => hasValue(env[key]));
    if (configuredEmulatorKey || isTruthy(env.VITE_FIREBASE_USE_EMULATOR)) {
      throw new ScriptSafetyError(
        scriptName,
        `Production mode refuses configured emulator routing (${configuredEmulatorKey || "VITE_FIREBASE_USE_EMULATOR"}).`,
      );
    }

    const nonInteractive = isTruthy(env.CI) || stdinIsTTY !== true;
    if (nonInteractive && env.ALLOW_NONINTERACTIVE_PRODUCTION_WRITES !== "1") {
      throw new ScriptSafetyError(
        scriptName,
        "Non-interactive production writes are denied unless ALLOW_NONINTERACTIVE_PRODUCTION_WRITES=1.",
      );
    }

    const environmentProjects = [
      env.GCLOUD_PROJECT,
      env.GOOGLE_CLOUD_PROJECT,
      projectFromFirebaseConfig(env.FIREBASE_CONFIG, scriptName),
    ].filter(hasValue);
    if (environmentProjects.some((projectId) => projectId !== cliProject)) {
      throw new ScriptSafetyError(scriptName, "Configured Firebase project does not match --project.");
    }

    env.GCLOUD_PROJECT = cliProject;
    env.GOOGLE_CLOUD_PROJECT = cliProject;
    return { mode: "production", projectId: cliProject, emulator: null };
  }

  const requestedProject =
    cliProject ||
    env.SCRIPT_FIREBASE_PROJECT ||
    env.GCLOUD_PROJECT ||
    env.GOOGLE_CLOUD_PROJECT ||
    projectFromFirebaseConfig(env.FIREBASE_CONFIG, scriptName) ||
    DEFAULT_EMULATOR_PROJECT;
  if (!isDemoProject(requestedProject)) {
    throw new ScriptSafetyError(
      scriptName,
      "The requested project is not an emulator project; use explicit --production mode if supported.",
    );
  }

  const endpoints = resolveEmulatorEndpoints(env, scriptName);
  applyEmulatorEnvironment(env, requestedProject, endpoints);
  return {
    mode: "emulator",
    projectId: requestedProject,
    emulator: {
      authHost: endpoints.auth.hostPort,
      firestoreHost: endpoints.firestore.hostPort,
      storageHost: endpoints.storage.hostPort,
      functionsHost: endpoints.functionsHost.hostname,
      functionsPort: endpoints.functionsHost.port,
    },
  };
}

export function assertSafeLocalFilePath({ filePath, allowedDirectory, expectedBasename }) {
  if (![filePath, allowedDirectory, expectedBasename].every(hasValue)) {
    throw new Error("filePath, allowedDirectory, and expectedBasename are required.");
  }
  const resolvedDirectory = resolve(allowedDirectory);
  const resolvedFile = resolve(filePath);
  const pathFromDirectory = relative(resolvedDirectory, resolvedFile);
  if (pathFromDirectory.startsWith("..") || isAbsolute(pathFromDirectory)) {
    throw new Error("Refusing to write outside the allowed directory.");
  }
  if (basename(resolvedFile) !== expectedBasename) {
    throw new Error(`Refusing to write a file other than ${expectedBasename}.`);
  }
  return resolvedFile;
}

export function mergeEmulatorSecretPlaceholders(source, placeholders) {
  const placeholderEntries = Object.entries(placeholders);
  for (const [name, placeholder] of placeholderEntries) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
      throw new Error("Invalid emulator secret name.");
    }
    if (typeof placeholder !== "string" || !placeholder.endsWith("emulator_placeholder")) {
      throw new Error(`Refusing a non-placeholder replacement for ${name}.`);
    }
  }

  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const seen = new Set();

  const nextLines = lines.map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/);
    if (!match) return line;

    const [, name, currentValue] = match;
    const normalizedCurrentValue = currentValue.trim().replace(/^(?:"([^"]*)"|'([^']*)')$/, "$1$2");
    if (!Object.hasOwn(placeholders, name)) {
      if (normalizedCurrentValue && !normalizedCurrentValue.endsWith("emulator_placeholder")) {
        throw new Error(`Refusing non-placeholder value for ${name} in the emulator secret file.`);
      }
      return line;
    }
    if (seen.has(name)) {
      throw new Error(`Refusing duplicate ${name} entries in the emulator secret file.`);
    }
    seen.add(name);
    const placeholder = placeholders[name];
    if (normalizedCurrentValue && normalizedCurrentValue !== placeholder) {
      throw new Error(`Refusing to replace non-placeholder value for ${name}.`);
    }
    return `${name}=${placeholder}`;
  });

  for (const [name, placeholder] of placeholderEntries) {
    if (!seen.has(name)) nextLines.push(`${name}=${placeholder}`);
  }

  return `${nextLines.join("\n")}\n`;
}
