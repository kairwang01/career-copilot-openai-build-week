#!/usr/bin/env node

/**
 * Cross-platform replacement for POSIX-only `NAME=value command` package scripts.
 * Values are never printed, and child arguments never pass through an outer shell.
 * Java remains an explicit workstation/CI prerequisite for Firebase emulators.
 */

import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSIGNMENT_NAME = /^[A-Z][A-Z0-9_]*$/;
const WINDOWS_BATCH_EXTENSIONS = new Set(['.bat', '.cmd']);
const DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd'];

function getEnvironmentValue(env, requestedName, platform) {
  if (platform !== 'win32') {
    return env[requestedName];
  }

  const matchedName = Object.keys(env).find(
    (name) => name.toLowerCase() === requestedName.toLowerCase(),
  );
  return matchedName ? env[matchedName] : undefined;
}

function setEnvironmentValue(env, name, value, platform) {
  if (platform === 'win32') {
    for (const existingName of Object.keys(env)) {
      if (existingName.toLowerCase() === name.toLowerCase()) {
        delete env[existingName];
      }
    }
  }
  env[name] = value;
}

function defaultIsFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function parseRunArguments(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error('Usage: node scripts/run-with-env.mjs [NAME=value ...] -- command [args ...]');
  }

  const additions = {};
  for (const assignment of argv.slice(0, separator)) {
    const equals = assignment.indexOf('=');
    const name = equals > 0 ? assignment.slice(0, equals) : '';
    if (!ASSIGNMENT_NAME.test(name)) {
      throw new Error('Environment assignments must use uppercase NAME=value syntax.');
    }
    additions[name] = assignment.slice(equals + 1);
  }

  const [requestedCommand, ...commandArgs] = argv.slice(separator + 1);
  return { additions, requestedCommand, commandArgs };
}

export function mergeEnvironment(
  baseEnv,
  additions,
  { platform = process.platform, execPath = process.execPath } = {},
) {
  const env = { ...baseEnv };
  for (const [name, value] of Object.entries(additions)) {
    setEnvironmentValue(env, name, value, platform);
  }
  setEnvironmentValue(env, 'NODE_BINARY', additions.NODE_BINARY || execPath, platform);
  return env;
}

export function findWindowsExecutable(
  command,
  env,
  { cwd = process.cwd(), isFile = defaultIsFile } = {},
) {
  const containsSeparator = /[\\/]/.test(command);
  const pathValue = getEnvironmentValue(env, 'PATH', 'win32') || '';
  const directories = containsSeparator
    ? ['']
    : pathValue.split(';').filter((entry) => entry.length > 0);
  const commandExtension = win32.extname(command);
  const configuredExtensions = (getEnvironmentValue(env, 'PATHEXT', 'win32') || '')
    .split(';')
    .filter(Boolean)
    .map((extension) => extension.toLowerCase());
  const extensions = commandExtension
    ? ['']
    : configuredExtensions.length > 0
      ? configuredExtensions
      : DEFAULT_WINDOWS_EXECUTABLE_EXTENSIONS;

  for (const directory of directories) {
    const base = containsSeparator
      ? win32.isAbsolute(command)
        ? command
        : win32.resolve(cwd, command)
      : win32.join(directory.replace(/^"|"$/g, ''), command);
    for (const extension of extensions) {
      const candidate = `${base}${extension}`;
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

export function parseWindowsNodeShim(shimText, shimPath) {
  const selectsNode = /SET\s+"?_prog=(?:%dp0%\\node\.exe|node)"?/i.test(shimText);
  const entryMatches = [
    ...shimText.matchAll(/"%dp0%\\([^"\r\n]+)"\s+%\*(?:\s|$)/gi),
  ];
  const relativeEntry = entryMatches.at(-1)?.[1];

  if (!selectsNode || !relativeEntry || relativeEntry.includes('%')) {
    throw new Error(
      'Windows .cmd/.bat launchers must be npm-compatible Node shims; refusing unsafe shell execution.',
    );
  }

  return win32.resolve(win32.dirname(shimPath), relativeEntry);
}

export function resolveSpawnInvocation({
  requestedCommand,
  commandArgs,
  env,
  platform = process.platform,
  execPath = process.execPath,
  cwd = process.cwd(),
  lookupExecutable = findWindowsExecutable,
  readText = (path) => readFileSync(path, 'utf8'),
  isFile = defaultIsFile,
}) {
  const normalizedCommand = requestedCommand.toLowerCase();
  if (normalizedCommand === 'node' || normalizedCommand === 'node.exe') {
    return { command: execPath, args: commandArgs, shell: false };
  }

  if (normalizedCommand === 'npm' || normalizedCommand === 'npm.cmd') {
    const npmCli = getEnvironmentValue(env, 'npm_execpath', platform);
    if (npmCli) {
      return { command: execPath, args: [npmCli, ...commandArgs], shell: false };
    }
  }

  if (platform !== 'win32') {
    return { command: requestedCommand, args: commandArgs, shell: false };
  }

  const executable = lookupExecutable(requestedCommand, env, { cwd, isFile });
  if (!executable) {
    throw new Error('Unable to locate the requested command on PATH.');
  }

  if (!WINDOWS_BATCH_EXTENSIONS.has(win32.extname(executable).toLowerCase())) {
    return { command: executable, args: commandArgs, shell: false };
  }

  const nodeEntry = parseWindowsNodeShim(readText(executable), executable);
  if (!isFile(nodeEntry)) {
    throw new Error('The Windows command shim points to a missing Node entry point.');
  }
  return { command: execPath, args: [nodeEntry, ...commandArgs], shell: false };
}

export function runWithEnvironment(argv = process.argv.slice(2)) {
  let parsed;
  let env;
  let invocation;
  try {
    parsed = parseRunArguments(argv);
    env = mergeEnvironment(process.env, parsed.additions);
    invocation = resolveSpawnInvocation({
      requestedCommand: parsed.requestedCommand,
      commandArgs: parsed.commandArgs,
      env,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unable to prepare the command.');
    process.exitCode = 2;
    return;
  }

  const child = spawn(invocation.command, invocation.args, {
    env,
    stdio: 'inherit',
    shell: false,
  });

  child.once('error', () => {
    console.error('Unable to start the requested command. Verify it is installed and on PATH.');
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    if (signal) {
      console.error(`The requested command terminated with signal ${signal}.`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}

const currentModulePath = resolve(fileURLToPath(import.meta.url));
const requestedModulePath = process.argv[1] ? resolve(process.argv[1]) : '';
if (currentModulePath === requestedModulePath) {
  runWithEnvironment();
}
