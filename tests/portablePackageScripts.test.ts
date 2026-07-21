import { readFileSync } from "node:fs";
import { win32, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  findWindowsExecutable,
  mergeEnvironment,
  parseRunArguments,
  resolveSpawnInvocation,
} from "../scripts/run-with-env.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const wrapperPath = resolve(repositoryRoot, "scripts", "run-with-env.mjs");
const packageJsonPath = resolve(repositoryRoot, "package.json");

describe("portable package command wrapper", () => {
  it("parses environment values without splitting spaces or additional equals signs", () => {
    expect(
      parseRunArguments([
        "FIRST=value with spaces",
        "SECOND=a=b",
        "--",
        "node",
        "script.mjs",
      ]),
    ).toEqual({
      additions: {
        FIRST: "value with spaces",
        SECOND: "a=b",
      },
      requestedCommand: "node",
      commandArgs: ["script.mjs"],
    });
  });

  it("rejects malformed assignments and missing commands", () => {
    expect(() => parseRunArguments(["lower=value", "--", "node"])).toThrow(
      /uppercase NAME=value/,
    );
    expect(() => parseRunArguments(["FLAG=value", "--"])).toThrow(/Usage:/);
  });

  it("deduplicates case-insensitive Windows environment keys and pins NODE_BINARY", () => {
    const env = mergeEnvironment(
      { Path: "C:\\old", node_binary: "C:\\old-node.exe" },
      { PATH: "C:\\new" },
      { platform: "win32", execPath: "C:\\runtime\\node.exe" },
    );

    expect(env).toEqual({
      PATH: "C:\\new",
      NODE_BINARY: "C:\\runtime\\node.exe",
    });
  });

  it("finds Windows executables through case-insensitive PATH and PATHEXT keys", () => {
    const visited: string[] = [];
    const result = findWindowsExecutable(
      "firebase",
      { Path: "C:\\Tools", PathExt: ".EXE;.CMD" },
      {
        cwd: "C:\\repo",
        isFile: (candidate) => {
          visited.push(candidate);
          return candidate === "C:\\Tools\\firebase.cmd";
        },
      },
    );

    expect(result).toBe("C:\\Tools\\firebase.cmd");
    expect(visited).toEqual([
      "C:\\Tools\\firebase.exe",
      "C:\\Tools\\firebase.cmd",
    ]);
  });

  it("resolves an npm-style Firebase .cmd shim to Node without a shell", () => {
    const shimPath = "C:\\Tools\\firebase.cmd";
    const nodeEntry = win32.resolve(
      win32.dirname(shimPath),
      "node_modules\\firebase-tools\\lib\\bin\\firebase.js",
    );
    const commandString =
      "node scripts/seed-emulator.mjs && node scripts/seed-ats-preview.mjs";
    const shim = String.raw`@ECHO off
SETLOCAL
SET "_prog=node"
endLocal & "%_prog%" "%dp0%\node_modules\firebase-tools\lib\bin\firebase.js" %*`;

    const invocation = resolveSpawnInvocation({
      requestedCommand: "firebase",
      commandArgs: [
        "emulators:exec",
        "--project",
        "demo-careercopilot",
        commandString,
      ],
      env: { PATH: "C:\\Tools", PATHEXT: ".CMD" },
      platform: "win32",
      execPath: "C:\\runtime\\node.exe",
      cwd: "C:\\repo",
      lookupExecutable: () => shimPath,
      readText: () => shim,
      isFile: (candidate) => candidate === nodeEntry,
    });

    expect(invocation).toEqual({
      command: "C:\\runtime\\node.exe",
      args: [
        nodeEntry,
        "emulators:exec",
        "--project",
        "demo-careercopilot",
        commandString,
      ],
      shell: false,
    });
  });

  it("refuses an unrecognized Windows batch launcher instead of invoking cmd.exe", () => {
    expect(() =>
      resolveSpawnInvocation({
        requestedCommand: "firebase",
        commandArgs: ["emulators:exec", "node safe.mjs && calc.exe"],
        env: { PATH: "C:\\Tools", PATHEXT: ".CMD" },
        platform: "win32",
        execPath: "C:\\runtime\\node.exe",
        lookupExecutable: () => "C:\\Tools\\firebase.cmd",
        readText: () => "@echo off\r\n%*",
        isFile: () => true,
      }),
    ).toThrow(/refusing unsafe shell execution/);
  });

  it("passes a command containing && as one literal argument", () => {
    const literalCommand =
      "node scripts/seed-emulator.mjs && node scripts/seed-ats-preview.mjs";
    const probe =
      "console.log(JSON.stringify({ value: process.env.PORTABLE_TEST, nodeBinary: process.env.NODE_BINARY, args: process.argv.slice(1) }))";
    const result = spawnSync(
      process.execPath,
      [
        wrapperPath,
        "PORTABLE_TEST=value with spaces",
        "--",
        "node",
        "-e",
        probe,
        literalCommand,
      ],
      {
        encoding: "utf8",
        env: process.env,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      value: "value with spaces",
      nodeBinary: process.execPath,
      args: [literalCommand],
    });
  });

  it("keeps every emulator script behind the shell-free wrapper", () => {
    const packageJsonText = readFileSync(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonText) as {
      scripts: Record<string, string>;
    };
    const emulatorScripts = Object.entries(packageJson.scripts).filter(([, command]) =>
      command.includes("firebase emulators:exec"),
    );

    expect(emulatorScripts.length).toBeGreaterThan(0);
    for (const [name, command] of emulatorScripts) {
      expect(command, name).toContain("node scripts/run-with-env.mjs");
    }
    expect(packageJsonText).not.toContain("/opt/homebrew/opt/openjdk");
    expect(packageJsonText).not.toMatch(/NODE_BINARY=\$\(/);
    expect(packageJsonText).not.toMatch(/(?:^|[" ])(?:JAVA_HOME|BILLING_SIMULATION|E2E_LLM_STUB)=[^ ]+ (?:npm|firebase)/m);

    const wrapperSource = readFileSync(wrapperPath, "utf8");
    expect(wrapperSource).toContain("shell: false");
    expect(wrapperSource).not.toMatch(/shell:\s*true/);
    expect(packageJson.scripts["seed:ats-preview"]).toContain(
      '"node scripts/seed-emulator.mjs && node scripts/seed-ats-preview.mjs"',
    );
  });
});
