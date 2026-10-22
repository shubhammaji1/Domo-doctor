import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { temporaryDirectory } from "./helpers.js";
import { runCli } from "../src/cli/index.js";
import { VERSION } from "../src/version.js";

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

describe("CLI", () => {
  it("starts through an npm-style symlink and prints its version", async () => {
    const fixture = await temporaryDirectory();
    try {
      const linkedDirectory = path.join(fixture.root, "cli-link");
      await symlink(
        path.dirname(cliPath),
        linkedDirectory,
        process.platform === "win32" ? "junction" : "dir",
      );
      const result = spawnSync(
        process.execPath,
        [path.join(linkedDirectory, "index.js"), "--version"],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(VERSION);
      expect(result.stderr).toBe("");
    } finally {
      await fixture.cleanup();
    }
  }, 15000);
  it("supports discovery commands and controlled usage failures", async () => {
    for (const args of [
      ["--help"],
      ["--version"],
      ["rules", "list"],
      ["explain", "DD-MAN-001"],
      ["explain", "DD-PROXY-001"],
    ]) {
      const result = await invoke(args);
      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    }
    for (const args of [
      ["explain", "unknown"],
      ["check", "unknown"],
      ["invalid"],
      ["scan", "--severity", "bad"],
    ])
      expect((await invoke(args)).status).toBe(2);
  });

  it("runs every focused category and respects config defaults and CLI overrides", async () => {
    for (const target of ["manifest", "mappings", "appdb", "proxy"]) {
      const result = await invoke([
        "check",
        target,
        "examples/healthy-app",
        "--format",
        "json",
      ]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).diagnostics.length).toBeGreaterThan(0);
    }
    const fixture = await temporaryDirectory();
    try {
      await writeFile(path.join(fixture.root, "manifest.json"), "{}");
      expect((await invoke(["init"], fixture.root)).status).toBe(0);
      expect((await invoke(["init"], fixture.root)).status).toBe(2);
      await writeFile(
        path.join(fixture.root, "domo-doctor.config.json"),
        JSON.stringify({ reporter: "sarif", failOn: "warning" }),
      );
      expect(
        JSON.parse((await invoke(["scan"], fixture.root)).stdout).version,
      ).toBe("2.1.0");
      expect(
        JSON.parse(
          (
            await invoke(
              ["scan", "--format", "json", "--severity", "error"],
              fixture.root,
            )
          ).stdout,
        ).schemaVersion,
      ).toBe("1.0.0");
      expect(
        (await invoke(["init", "missing-directory"], fixture.root)).status,
      ).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns failure for unmet fixture expectations", async () => {
    const fixture = await temporaryDirectory();
    try {
      await writeFile(path.join(fixture.root, "manifest.json"), "{}");
      await writeFile(
        path.join(fixture.root, "bad.doctor-test.json"),
        JSON.stringify({
          project: ".",
          expect: [{ ruleId: "DD-MAN-001", status: "failed" }],
        }),
      );
      expect((await invoke(["test", fixture.root])).status).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });
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
