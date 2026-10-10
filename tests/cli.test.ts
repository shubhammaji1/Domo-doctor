import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { runCli } from "../dist/cli/index.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliPath = path.join(repositoryRoot, "dist", "cli", "index.js");

async function invoke(args: string[], cwd = repositoryRoot) {
  const previousCwd = process.cwd();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    process.chdir(cwd);
    const code = await runCli([process.execPath, cliPath, ...args]);
    return { status: code, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    process.chdir(previousCwd);
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

describe("compiled CLI", () => {
  it("scans a healthy app with exit code 0 and identifies rule IDs", async () => {
    const result = await invoke(["scan", "examples/healthy-app", "--no-color"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DD-MAN-004");
    expect(result.stdout).toContain("0 errors");
  });

  it("returns exit code 1 for confirmed broken findings and supports JSON output", async () => {
    const result = await invoke([
      "scan",
      "examples/broken-app",
      "--format",
      "json",
    ]);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      diagnostics: Array<{ ruleId: string; status: string }>;
    };
    expect(
      parsed.diagnostics.some(
        (item) => item.ruleId === "DD-MAN-004" && item.status === "failed",
      ),
    ).toBe(true);
  });

  it("returns code 2 on invalid arguments and writes SARIF output to a file", async () => {
    const invalid = await invoke(["scan", "--format", "not-a-format"]);
    expect(invalid.status).toBe(2);
    const output = await temporaryDirectory();
    try {
      const result = await invoke([
        "scan",
        "examples/healthy-app",
        "--format",
        "sarif",
        "--output",
        path.join(output.root, "report.sarif"),
      ]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Wrote sarif report");
      const sarif = JSON.parse(
        await readFile(path.join(output.root, "report.sarif"), "utf8"),
      ) as { version: string };
      expect(sarif.version).toBe("2.1.0");
    } finally {
      await output.cleanup();
    }
  });

  it("runs the fixture test command", async () => {
    const result = await invoke(["test", "examples"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 passed | 0 failed");
  });
});
