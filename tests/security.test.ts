import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { listProjectFiles, readProjectFile } from "../src/core/filesystem.js";
import { runFixtureTests } from "../src/core/fixture-tests.js";
import { scanProject } from "../src/core/scanner.js";
import { temporaryDirectory } from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];
async function directories() {
  const temporary = await temporaryDirectory();
  cleanup.push(temporary.cleanup);
  const selected = path.join(temporary.root, "selected");
  const outside = path.join(temporary.root, "outside");
  await mkdir(selected);
  await mkdir(outside);
  await writeFile(path.join(outside, "manifest.json"), "{}");
  return { selected, outside };
}
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((remove) => remove()));
});

describe("filesystem and input security", () => {
  it("reports untraversed linked source without a mapping pass", async () => {
    const { selected, outside } = await directories();
    await writeFile(path.join(selected, "manifest.json"), '{"mapping":[]}');
    await writeFile(
      path.join(outside, "app.js"),
      "domo.get('/data/v1/missing')",
    );
    await symlink(
      outside,
      path.join(selected, "src"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const report = await scanProject({ root: selected });
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        ruleId: "DD-MAP-001",
        status: "unverified",
        file: "src",
      }),
    );
    expect(
      report.diagnostics.some(
        (item) => item.ruleId === "DD-MAP-001" && item.status === "passed",
      ),
    ).toBe(false);
  });
  it("does not report explicitly ignored linked entries", async () => {
    const { selected, outside } = await directories();
    await writeFile(path.join(selected, "manifest.json"), "{}");
    await symlink(
      outside,
      path.join(selected, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const report = await scanProject({ root: selected });
    expect(
      report.diagnostics.some((item) => item.file === "node_modules"),
    ).toBe(false);
  });
  it("rejects a selected root beneath an ancestor junction", async () => {
    const { selected, outside } = await directories();
    await mkdir(path.join(outside, "child"));
    await writeFile(path.join(outside, "child", "manifest.json"), "{}");
    await symlink(
      outside,
      path.join(selected, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const root = path.join(selected, "alias", "child");
    await expect(scanProject({ root })).rejects.toThrow(
      /symbolic links or junctions/,
    );
    await expect(listProjectFiles(root, [])).rejects.toThrow(
      /symbolic links or junctions/,
    );
    await expect(runFixtureTests(root)).rejects.toThrow(
      /symbolic links or junctions/,
    );
  });
  it("rejects configured roots outside the selected project and fixture roots", async () => {
    const { selected } = await directories();
    await writeFile(
      path.join(selected, "domo-doctor.config.json"),
      JSON.stringify({ root: "../outside" }),
    );
    await expect(scanProject({ root: selected })).rejects.toThrow(
      /inside the selected project root/,
    );
    await writeFile(
      path.join(selected, "escape.doctor-test.json"),
      JSON.stringify({ project: ".", expect: [{ ruleId: "DD-MAN-001" }] }),
    );
    await expect(runFixtureTests(selected)).rejects.toThrow(
      /inside the selected project root/,
    );
  });

  it("resolves relative project arguments once and allows contained subdirectories", async () => {
    const { selected } = await directories();
    await writeFile(path.join(selected, "domo-doctor.config.json"), "{}");
    expect(
      (await loadConfig({ cwd: path.dirname(selected), rootArg: "selected" }))
        .config.root,
    ).toBe(selected);
    await mkdir(path.join(selected, "app"));
    await writeFile(
      path.join(selected, "domo-doctor.config.json"),
      '{"root":"app"}',
    );
    expect((await loadConfig({ cwd: selected })).config.root).toBe(
      path.join(selected, "app"),
    );
  });

  it("rejects parent junctions in manifest and config paths and fixture projects", async () => {
    const { selected, outside } = await directories();
    await symlink(
      outside,
      path.join(selected, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await writeFile(path.join(outside, "domo-doctor.config.json"), "{}");
    await writeFile(
      path.join(selected, "domo-doctor.config.json"),
      '{"manifest":"link/manifest.json"}',
    );
    await expect(scanProject({ root: selected })).rejects.toThrow(
      /symbolic links or junctions/,
    );
    await expect(
      loadConfig({ cwd: selected, configArg: "link/domo-doctor.config.json" }),
    ).rejects.toThrow(/symbolic links or junctions/);
    await writeFile(
      path.join(selected, "escape.doctor-test.json"),
      JSON.stringify({ project: "link", expect: [{ ruleId: "DD-MAN-001" }] }),
    );
    await expect(runFixtureTests(selected)).rejects.toThrow(
      /symbolic links or junctions/,
    );
  });

  it("omits malformed JSON and invalid config contents from errors", async () => {
    const { selected } = await directories();
    for (const contents of [
      "synthetic-private-value",
      '{"synthetic-private-value":true}',
    ]) {
      await writeFile(path.join(selected, "domo-doctor.config.json"), contents);
      await expect(loadConfig({ cwd: selected })).rejects.toThrow(/Invalid/);
      try {
        await loadConfig({ cwd: selected });
      } catch (error) {
        expect(String(error)).not.toContain("synthetic-private-value");
      }
    }
  });

  it("bounds input files and rejects pathological ignore patterns", async () => {
    const { selected } = await directories();
    const file = path.join(selected, "large.json");
    await writeFile(file, "x".repeat(1_048_577));
    await expect(readProjectFile(selected, file)).rejects.toThrow(/size limit/);
    await expect(
      listProjectFiles(selected, ["{".repeat(6000)]),
    ).rejects.toThrow(/1024/);
    await expect(
      listProjectFiles(selected, ["{".repeat(9) + "x" + "}".repeat(9)]),
    ).rejects.toThrow(/nesting/);
    await expect(
      listProjectFiles(selected, Array<string>(129).fill("x")),
    ).rejects.toThrow(/Too many/);
    await expect(listProjectFiles(selected, ["{)".repeat(9)])).rejects.toThrow(
      /nesting/,
    );
  });

  it("keeps glob ignores working and skips links and nested dependencies", async () => {
    const { selected, outside } = await directories();
    await mkdir(path.join(selected, "src", "node_modules"), {
      recursive: true,
    });
    await writeFile(path.join(selected, "src", "app.ts"), "");
    await writeFile(path.join(selected, "src", "generated.js"), "");
    await writeFile(path.join(selected, "src", "node_modules", "dep.js"), "");
    await symlink(
      outside,
      path.join(selected, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(
      await listProjectFiles(selected, [
        "**/node_modules/**",
        "**/generated.{js,ts}",
      ]),
    ).toEqual(["src/app.ts"]);
  });

  it("requires fixture assertions but supports forbid-only fixtures", async () => {
    const { selected } = await directories();
    const file = path.join(selected, "check.doctor-test.json");
    await writeFile(file, '{"project":".","expect":[],"forbid":[]}');
    await expect(runFixtureTests(selected)).rejects.toThrow(/Invalid fixture/);
    await writeFile(file, '{"project":".","forbid":["DD-MAN-004"]}');
    expect((await runFixtureTests(selected)).passed).toBe(1);
  });
});
