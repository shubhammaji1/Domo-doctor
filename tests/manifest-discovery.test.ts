import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { scanProject } from "../src/core/scanner.js";
import { temporaryDirectory } from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((remove) => remove()));
});

async function project(files: Record<string, string> = {}) {
  const fixture = await temporaryDirectory();
  cleanup.push(fixture.cleanup);
  for (const [file, text] of Object.entries(files)) {
    const target = path.join(fixture.root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  return fixture.root;
}

describe("automatic manifest discovery", () => {
  it.each(["public", "src", "static"])(
    "scans %s/manifest.json without configuration",
    async (directory) => {
      const root = await project({
        [`${directory}/manifest.json`]: JSON.stringify({
          name: "App",
          mapping: [{ alias: "orders", dataSetId: "id" }],
        }),
        "app.js": 'domo.get("/data/v1/orders")',
      });
      const report = await scanProject({
        root,
        onlyCategories: ["manifest", "mappings"],
      });
      expect(report.summary.errors).toBe(0);
      expect(report.summary.warnings).toBe(0);
      expect(
        report.diagnostics.find((item) => item.ruleId === "DD-MAN-001"),
      ).toMatchObject({ status: "passed", file: `${directory}/manifest.json` });
      expect(
        report.diagnostics.find((item) => item.ruleId === "DD-MAP-001")?.status,
      ).toBe("passed");
    },
  );

  it.each(["public", "src", "static"])(
    "discovers %s/manifest.json when the Domo CLI is absent",
    async (directory) => {
      const root = await project({ [`${directory}/manifest.json`]: "{}" });
      vi.stubEnv("PATH", "");
      try {
        const report = await scanProject({ root });
        expect(report.summary.errors).toBe(0);
        expect(report.summary.warnings).toBe(1);
        expect(
          report.diagnostics.filter((item) => item.status === "failed"),
        ).toEqual([
          expect.objectContaining({
            ruleId: "DD-PROXY-001",
            severity: "warning",
          }),
        ]);
        expect(
          report.diagnostics.find((item) => item.ruleId === "DD-MAN-001"),
        ).toMatchObject({
          status: "passed",
          file: `${directory}/manifest.json`,
        });
        const focused = await scanProject({
          root,
          onlyCategories: ["manifest", "mappings"],
        });
        expect(focused.summary.errors).toBe(0);
        expect(focused.summary.warnings).toBe(0);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("preserves root precedence over other manifests", async () => {
    const root = await project({
      "manifest.json": "{}",
      "public/manifest.json": "broken",
      "src/manifest.json": "broken",
    });
    expect((await loadConfig({ cwd: root })).config.manifest).toBe(
      path.join(root, "manifest.json"),
    );
    expect((await scanProject({ root })).summary.errors).toBe(0);
  });

  it("ignores generated and dependency copies when finding a source manifest", async () => {
    const root = await project({
      "public/manifest.json": "{}",
      "dist/manifest.json": "broken",
      "build/manifest.json": "broken",
      "node_modules/example/manifest.json": "broken",
    });
    expect((await loadConfig({ cwd: root })).config.manifest).toBe(
      path.join(root, "public", "manifest.json"),
    );
    expect((await scanProject({ root })).summary.errors).toBe(0);
  });

  it("does not substitute generated output when source manifests are absent", async () => {
    const root = await project({
      "dist/manifest.json": "{}",
      "build/manifest.json": "{}",
    });
    expect(
      (await scanProject({ root })).diagnostics.find(
        (item) => item.ruleId === "DD-MAN-001",
      ),
    ).toMatchObject({ status: "failed", file: "manifest.json" });
  });

  it("requires an explicit selection for multiple source manifests", async () => {
    const root = await project({
      "public/manifest.json": "{}",
      "static/manifest.json": "{}",
    });
    await expect(scanProject({ root })).rejects.toThrow(
      /Multiple source manifests/,
    );
    await writeFile(
      path.join(root, "domo-doctor.config.json"),
      JSON.stringify({ manifest: "static/manifest.json" }),
    );
    expect((await scanProject({ root })).summary.errors).toBe(0);
  });

  it("respects explicit paths even when the selected manifest is missing", async () => {
    const root = await project({
      "domo-doctor.config.json": JSON.stringify({ manifest: "custom.json" }),
      "public/manifest.json": "{}",
    });
    expect(
      (await scanProject({ root })).diagnostics.find(
        (item) => item.ruleId === "DD-MAN-001",
      ),
    ).toMatchObject({ status: "failed", file: "custom.json" });
  });

  it("discovers a manifest when configuration only contains unrelated options", async () => {
    const root = await project({
      "domo-doctor.config.json": JSON.stringify({ reporter: "json" }),
      "public/manifest.json": "{}",
    });
    expect((await loadConfig({ cwd: root })).config.manifest).toBe(
      path.join(root, "public", "manifest.json"),
    );
  });

  it("resolves discovery inside the selected or configured project root", async () => {
    const root = await project({
      "domo-doctor.config.json": JSON.stringify({ root: "app" }),
      "app/public/manifest.json": "{}",
    });
    expect(
      (
        await scanProject({
          cwd: path.dirname(root),
          root: path.basename(root),
        })
      ).diagnostics.find((item) => item.ruleId === "DD-MAN-001")?.file,
    ).toBe("public/manifest.json");
  });

  it("reports malformed discovered JSON at its actual location", async () => {
    const root = await project({
      "public/manifest.json": "broken",
      "dist/manifest.json": "{}",
    });
    expect(
      (await scanProject({ root })).diagnostics.find(
        (item) => item.ruleId === "DD-MAN-002",
      ),
    ).toMatchObject({ status: "failed", file: "public/manifest.json" });
  });

  it("rejects manifest directories and oversized discovered inputs", async () => {
    const root = await project();
    await mkdir(path.join(root, "public", "manifest.json"), {
      recursive: true,
    });
    await expect(scanProject({ root })).rejects.toThrow(/regular file/);
    const oversized = await project({
      "public/manifest.json": " ".repeat(1048577),
    });
    await expect(scanProject({ root: oversized })).rejects.toThrow(
      /size limit/,
    );
  });

  it("rejects junctions or symlinks in discovered paths", async () => {
    const outside = await project({ "manifest.json": "{}" });
    const root = await project();
    await symlink(
      outside,
      path.join(root, "public"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(scanProject({ root })).rejects.toThrow(
      /symbolic links|junctions/,
    );
  });
});
