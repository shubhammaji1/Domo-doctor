import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject } from "../src/core/scanner.js";
import { temporaryDirectory } from "./helpers.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((remove) => remove()));
});

async function project(files: Record<string, string>): Promise<string> {
  const fixture = await temporaryDirectory();
  cleanup.push(fixture.cleanup);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(fixture.root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return fixture.root;
}

const validManifest = JSON.stringify(
  {
    name: "Local fixture",
    mapping: [{ alias: "sales", dataSetId: "dataset-id", fields: [] }],
  },
  null,
  2,
);

describe("scanProject", () => {
  it.skipIf(process.platform !== "linux")(
    "suppresses only the intended case-distinct file",
    async () => {
      const root = await project({
        "manifest.json": validManifest,
        "src/App.js": "domo.get('/data/v1/missing')",
        "src/app.js": "domo.get('/data/v1/another')",
        "domo-doctor.config.json": JSON.stringify({
          suppressions: [
            {
              ruleId: "DD-MAP-001",
              file: "src/app.js",
              reason: "intentional fixture",
            },
          ],
        }),
      });
      const report = await scanProject({ root });
      expect(
        report.diagnostics.find(
          (item) => item.ruleId === "DD-MAP-001" && item.file === "src/App.js",
        )?.suppressed,
      ).toBeUndefined();
      expect(
        report.diagnostics.find(
          (item) => item.ruleId === "DD-MAP-001" && item.file === "src/app.js",
        )?.suppressed,
      ).toBe(true);
    },
  );
  it.each([
    "domo.get()",
    "window.domo.get()",
    "domo['get'](route)",
    "globalThis.domo?.get?.(route)",
    "domo[method]('/data/v1/sales')",
  ])("reports incomplete calls as unverified: %s", async (source) => {
    const root = await project({
      "manifest.json": validManifest,
      "app.js": source,
    });
    const report = await scanProject({ root });
    expect(
      report.diagnostics.some(
        (item) => item.ruleId === "DD-MAP-002" && item.status === "unverified",
      ),
    ).toBe(true);
  });
  it("scans a healthy project offline and keeps the project path sanitized", async () => {
    const root = await project({
      "manifest.json": validManifest,
      "src/app.ts": 'domo.get("/data/v1/sales");',
    });
    const report = await scanProject({ root });
    expect(report.scan.project).toBe(".");
    expect(report.summary.errors).toBe(0);
    expect(
      report.diagnostics.find((item) => item.ruleId === "DD-MAP-001")?.status,
    ).toBe("passed");
    expect(report.diagnostics.some((item) => item.file?.includes("\\"))).toBe(
      false,
    );
  });

  it("reports missing manifests and explicitly skips dependent checks", async () => {
    const root = await project({ "app.js": "domo.get('/data/v1/sales');" });
    const report = await scanProject({ root });
    expect(
      report.diagnostics.find((item) => item.ruleId === "DD-MAN-001")?.status,
    ).toBe("failed");
    expect(
      report.diagnostics.find((item) => item.ruleId === "DD-MAN-002")?.status,
    ).toBe("skipped");
    expect(
      report.diagnostics.find((item) => item.ruleId === "DD-MAP-001")?.status,
    ).toBe("skipped");
  });

  it("reports invalid JSON with a relative file and exact parser line", async () => {
    const root = await project({
      "manifest.json": '{\n  "name": "bad",\n  "mapping": [\n}',
    });
    const report = await scanProject({ root });
    const finding = report.diagnostics.find(
      (item) => item.ruleId === "DD-MAN-002",
    );
    expect(finding?.status).toBe("failed");
    expect(finding?.file).toBe("manifest.json");
    expect(finding?.line).toBe(4);
    expect(finding?.column).toBeGreaterThan(0);
    expect(
      report.diagnostics.find((item) => item.ruleId === "DD-MAN-003")?.status,
    ).toBe("skipped");
  });

  it("rejects a non-object JSON root as invalid manifest structure", async () => {
    const root = await project({ "manifest.json": "[]" });
    const report = await scanProject({ root });
    expect(
      report.diagnostics.find((item) => item.ruleId === "DD-MAN-003")?.status,
    ).toBe("failed");
  });

  it("uses AST locations for unknown literal and dynamic dataset paths", async () => {
    const root = await project({
      "manifest.json": validManifest,
      "src/nested/app.tsx":
        'const a = domo.get("/data/v1/missing");\nconst b = domo.get(makeUrl());',
    });
    const report = await scanProject({ root });
    const unknown = report.diagnostics.find(
      (item) => item.ruleId === "DD-MAP-001" && item.status === "failed",
    );
    const dynamic = report.diagnostics.find(
      (item) => item.ruleId === "DD-MAP-002" && item.status === "unverified",
    );
    expect(unknown?.file).toBe("src/nested/app.tsx");
    expect(unknown?.line).toBe(1);
    expect(dynamic?.line).toBe(2);
  });

  it("labels AppDB and proxy requirements unverified instead of claiming live success", async () => {
    const root = await project({
      "manifest.json": validManifest,
      "app.js":
        'import { appdb } from "@domoinc/toolkit";\nconst label = "AppDB";',
    });
    const report = await scanProject({ root });
    expect(
      report.diagnostics.find((item) => item.ruleId === "DD-APPDB-001")?.status,
    ).toBe("unverified");
    expect(
      report.diagnostics.find((item) => item.ruleId === "DD-MAN-007")?.status,
    ).toBe("unverified");
  });

  it("does not claim a present proxyId is valid", async () => {
    const root = await project({
      "manifest.json": JSON.stringify({
        proxyId: "configured-proxy-id",
        mapping: [{ alias: "sales", dataSetId: "source", fields: [] }],
      }),
      "app.js": 'const endpoint = "AppDB";',
    });
    const report = await scanProject({ root });
    expect(
      report.diagnostics.find((item) => item.ruleId === "DD-MAN-007")?.status,
    ).toBe("unverified");
  });

  it("reports oversized source files as unverified instead of treating them as checked", async () => {
    const root = await project({
      "manifest.json": validManifest,
      "large.js": `//${"x".repeat(1_050_000)}`,
    });
    const report = await scanProject({ root });
    expect(
      report.diagnostics.some(
        (item) => item.file === "large.js" && item.status === "unverified",
      ),
    ).toBe(true);
  });

  it("validates configuration and rejects root traversal or unknown rule IDs", async () => {
    const root = await project({ "manifest.json": validManifest });
    await writeFile(
      path.join(root, "domo-doctor.config.json"),
      JSON.stringify({ manifest: "../outside.json" }),
    );
    await expect(scanProject({ root })).rejects.toThrow(
      /inside the project root/,
    );
    await writeFile(
      path.join(root, "domo-doctor.config.json"),
      JSON.stringify({ rules: { "DD-UNKNOWN-001": "error" } }),
    );
    await expect(scanProject({ root })).rejects.toThrow(
      /Unknown diagnostic rule/,
    );
  });

  it("keeps sensitive-looking source aliases redacted in report text", async () => {
    const root = await project({
      "manifest.json": validManifest,
      "app.js": 'domo.get("/data/v1/password=never-print-this");',
    });
    const serialized = JSON.stringify(await scanProject({ root }));
    expect(serialized).not.toContain("never-print-this");
    expect(serialized).toContain("[redacted]");
  });

  it("supports project-relative suppression reasons and counts suppressed findings", async () => {
    const root = await project({
      "manifest.json": JSON.stringify({
        mapping: [
          { alias: "sales", dataSetId: "one", fields: [] },
          { alias: "sales", dataSetId: "two", fields: [] },
        ],
      }),
      "domo-doctor.config.json": JSON.stringify({
        suppressions: [
          {
            ruleId: "DD-MAN-004",
            file: "manifest.json",
            reason: "Legacy card mapping.",
          },
        ],
      }),
    });
    const report = await scanProject({ root });
    expect(report.summary.suppressed).toBe(1);
    expect(
      report.diagnostics.find((item) => item.ruleId === "DD-MAN-004")
        ?.suppressed,
    ).toBe(true);
  });

  it("marks unavailable Domo CLI as a warning and does not invoke it", async () => {
    const root = await project({ "manifest.json": validManifest });
    const previousPath = process.env.PATH;
    const previousPathExt = process.env.PATHEXT;
    try {
      process.env.PATH = "";
      process.env.PATHEXT = "";
      const report = await scanProject({ root, onlyCategories: ["proxy"] });
      const finding = report.diagnostics.find(
        (item) => item.ruleId === "DD-PROXY-001",
      );
      expect(finding?.severity).toBe("warning");
      expect(finding?.status).toBe("failed");
      expect(finding?.explanation).toContain("Authentication");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousPathExt === undefined) delete process.env.PATHEXT;
      else process.env.PATHEXT = previousPathExt;
    }
  });

  it("detects a Domo CLI executable on an isolated PATH without running it", async () => {
    const root = await project({ "manifest.json": validManifest });
    const binDirectory = path.join(root, "bin");
    await mkdir(binDirectory);
    const executable = path.join(
      binDirectory,
      process.platform === "win32" ? "domo.cmd" : "domo",
    );
    await writeFile(executable, "not executed", "utf8");
    if (process.platform !== "win32") {
      const { chmod } = await import("node:fs/promises");
      await chmod(executable, 0o755);
    }
    const previousPath = process.env.PATH;
    const previousPathExt = process.env.PATHEXT;
    try {
      process.env.PATH = binDirectory;
      process.env.PATHEXT = process.platform === "win32" ? ".CMD" : "";
      const report = await scanProject({ root, onlyCategories: ["proxy"] });
      expect(
        report.diagnostics.find((item) => item.ruleId === "DD-PROXY-001")
          ?.status,
      ).toBe("passed");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousPathExt === undefined) delete process.env.PATHEXT;
      else process.env.PATHEXT = previousPathExt;
    }
  });
});
