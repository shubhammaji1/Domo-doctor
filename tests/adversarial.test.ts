import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "../src/core/scanner.js";
import { formatTerminal } from "../src/reporters/terminal.js";
import { createSarif } from "../src/reporters/sarif.js";
import { redactSecrets } from "../src/core/privacy.js";
import { assertJsonNesting } from "../src/core/input-limits.js";
import { temporaryDirectory } from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];
const cli = fileURLToPath(new URL("../dist/cli/index.js", import.meta.url));
async function project() {
  const fixture = await temporaryDirectory();
  cleanup.push(fixture.cleanup);
  await writeFile(path.join(fixture.root, "manifest.json"), "{}");
  return fixture.root;
}
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((remove) => remove()));
});

describe("adversarial privacy and output regression", () => {
  it("redacts complete credentials in every report field and format and escapes controls", async () => {
    const root = await project();
    const marker = "SYNTHETIC_BEARER_PRIVATE";
    await writeFile(
      path.join(root, "token=SYNTHETIC_FILENAME_PRIVATE.js"),
      `domo.get(${JSON.stringify("/data/v1/Authorization: Bearer " + marker + "\u001b[2J")});`,
    );
    const report = await scanProject({ root });
    for (const output of [
      JSON.stringify(report),
      JSON.stringify(createSarif(report)),
      formatTerminal(report, { color: false }),
      formatTerminal(report, { color: false, verbose: true }),
    ]) {
      expect(output).not.toContain(marker);
      expect(output).not.toContain("SYNTHETIC_FILENAME_PRIVATE");
      expect(output).not.toContain(String.fromCharCode(27));
    }
    for (const value of [
      "Authorization: Basic SYNTHETIC_BASIC",
      "Cookie: session=SYNTHETIC_COOKIE",
      '"password":"SYNTHETIC_PASSWORD"',
      "api_key=SYNTHETIC_API",
    ])
      expect(redactSecrets(value)).not.toContain("SYNTHETIC_");
  });

  it("redacts suppression reasons and control characters without depending on colors", async () => {
    const root = await project();
    await writeFile(
      path.join(root, "manifest.json"),
      JSON.stringify({
        mapping: [
          { alias: "a", dataSetId: "1" },
          { alias: "a", dataSetId: "2" },
        ],
      }),
    );
    await writeFile(
      path.join(root, "domo-doctor.config.json"),
      JSON.stringify({
        suppressions: [
          {
            ruleId: "DD-MAN-004",
            reason: "Authorization: Bearer SYNTHETIC_REASON",
          },
        ],
      }),
    );
    const report = await scanProject({ root });
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC_REASON");
    expect(JSON.stringify(createSarif(report))).not.toContain(
      "SYNTHETIC_REASON",
    );
    await writeFile(
      path.join(root, "app.js"),
      `domo.get(${JSON.stringify("/data/v1/\u001b[2JFORGED")});`,
    );
    expect(
      formatTerminal(await scanProject({ root }), { color: false }),
    ).not.toContain(String.fromCharCode(27));
  });

  it("does not echo unknown rule or fixture keys in CLI errors", async () => {
    const root = await project();
    await writeFile(
      path.join(root, "domo-doctor.config.json"),
      JSON.stringify({ rules: { "token=SYNTHETIC_RULE_PRIVATE": "off" } }),
    );
    const rule = spawnSync(process.execPath, [cli, "scan", root], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(rule.status).toBe(2);
    expect(rule.stderr).not.toContain("SYNTHETIC_RULE_PRIVATE");
    await writeFile(
      path.join(root, "check.doctor-test.json"),
      JSON.stringify({
        project: ".",
        expect: [{ ruleId: "DD-MAN-001" }],
        "token=SYNTHETIC_FIXTURE_PRIVATE": "x",
      }),
    );
    const fixture = spawnSync(process.execPath, [cli, "test", root], {
      encoding: "utf8",
      timeout: 10000,
    });
    expect(fixture.status).toBe(2);
    expect(fixture.stderr).not.toContain("SYNTHETIC_FIXTURE_PRIVATE");
  });

  it("refuses to overwrite existing inputs and reports or traverse an output junction", async () => {
    const root = await project();
    const outside = await project();
    for (const name of ["manifest.json", "existing.json"]) {
      const file = path.join(root, name);
      await writeFile(file, "{}");
      const result = spawnSync(
        process.execPath,
        [cli, "scan", root, "--format", "json", "--output", file],
        { encoding: "utf8", timeout: 10000 },
      );
      expect(result.status).toBe(2);
      expect(await readFile(file, "utf8")).toBe("{}");
    }
    await symlink(
      outside,
      path.join(root, "outlink"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = spawnSync(
      process.execPath,
      [cli, "scan", root, "--output", path.join(root, "outlink", "new.json")],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(result.status).toBe(2);
  });

  it("marks HTML, broken syntax and excessive source nesting unverified", async () => {
    const root = await project();
    await writeFile(
      path.join(root, "index.html"),
      '<script>domo.get("/data/v1/hidden")</script>',
    );
    await writeFile(path.join(root, "bad.js"), "const = ;");
    await writeFile(
      path.join(root, "deep.js"),
      "const value=" + "(".repeat(3000) + "1" + ")".repeat(3000),
    );
    const report = await scanProject({ root });
    for (const file of ["index.html", "bad.js", "deep.js"])
      expect(
        report.diagnostics.some(
          (d) => d.file === file && d.status === "unverified",
        ),
      ).toBe(true);
    expect(
      report.diagnostics.find((d) => d.ruleId === "DD-MAN-007")?.status,
    ).toBe("unverified");
  });

  it("bounds JSON structural nesting but ignores brackets inside escaped strings", async () => {
    expect(() => assertJsonNesting("[".repeat(129))).toThrow(/128-level/);
    expect(() =>
      assertJsonNesting(JSON.stringify({ text: "[".repeat(1000) + '"\\end' })),
    ).not.toThrow();
    const root = await project();
    await writeFile(
      path.join(root, "manifest.json"),
      "[".repeat(10000) + "broken",
    );
    await expect(scanProject({ root })).rejects.toThrow(/nesting/);
  });

  it("does not call malformed mapping entries well formed", async () => {
    const root = await project();
    await writeFile(path.join(root, "manifest.json"), '{"mapping":{}}');
    expect(
      (await scanProject({ root })).diagnostics.find(
        (d) => d.ruleId === "DD-MAN-006",
      )?.status,
    ).toBe("skipped");
    await mkdir(path.join(root, "nested"));
  });
});
