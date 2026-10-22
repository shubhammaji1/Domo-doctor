import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  analyzeAppDb,
  analyzeDatasetReferences,
  sourceReferencesAdvancedProxy,
} from "../src/analyzers/source-code.js";
import { makeContext } from "./helpers.js";

function context(
  source: string,
  mapping: unknown[] = [{ alias: "sales", dataSetId: "id" }],
) {
  return makeContext(".", {
    manifest: { mapping } as never,
    sourceFiles: [
      {
        path: "app.ts",
        sourceFile: ts.createSourceFile(
          "app.ts",
          source,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS,
        ),
      },
    ],
  });
}

describe("source analyzer regression cases", () => {
  it.each([
    "domo['get']('/data/v1/missing')",
    "window.domo.get('/data/v1/missing')",
    "globalThis['domo']['get']('/data/v1/missing')",
    "domo?.get?.('/data/v1/missing')",
    "window?.domo?.['get']?.('/data/v1/missing')",
  ])("recognizes static call variants: %s", (source) => {
    expect(analyzeDatasetReferences(context(source))[0]).toMatchObject({
      status: "failed",
      confidence: "high",
    });
    expect(
      analyzeDatasetReferences(context(source.replace("missing", "sales")))[0]
        ?.status,
    ).toBe("passed");
  });
  it.each([
    "domo = {}; domo.get('/data/v1/sales')",
    "({domo} = other); domo.get('/data/v1/sales')",
    "import {other as domo} from 'ryuu.js'; domo.get('/data/v1/sales')",
    "import * as domo from 'ryuu.js'; domo.get('/data/v1/sales')",
    "const window = other; window.domo.get('/data/v1/sales')",
    "globalThis.domo = other; globalThis.domo.get('/data/v1/sales')",
    "domo++; domo.get('/data/v1/sales')",
    "for (domo of clients) {} domo.get('/data/v1/sales')",
    "for (domo in clients) {} domo.get('/data/v1/sales')",
    "delete window.domo; window.domo.get('/data/v1/sales')",
  ])("downgrades uncertain receiver identities: %s", (source) => {
    expect(analyzeDatasetReferences(context(source))[0]).toMatchObject({
      status: "unverified",
      confidence: "low",
    });
    const findings = analyzeAppDb(
      context(
        source.replace(
          "/data/v1/sales",
          "/domo/datastores/v1/collections/missing",
        ),
      ),
    );
    expect(findings.some((item) => item.status === "failed")).toBe(false);
    expect(findings.some((item) => item.status === "unverified")).toBe(true);
  });
  it.each([
    "domo['get']('/domo/datastores/v1/collections/missing')",
    "window.domo.get('/domo/datastores/v1/collections/missing')",
    "globalThis.domo?.get?.('/domo/datastores/v1/collections/missing')",
    "window.domo.appdb.list('missing')",
    "globalThis['domo']['appdb']['list']('missing')",
  ])("shares receiver classification with AppDB: %s", (source) => {
    expect(
      analyzeAppDb(context(source)).some(
        (item) => item.status === "failed" && item.confidence === "high",
      ),
    ).toBe(true);
  });
  it("keeps computed HTTP methods unverified", () => {
    const findings = analyzeAppDb(
      context("domo[method]('/domo/datastores/v1/collections/missing')"),
    );
    expect(findings.some((item) => item.status === "failed")).toBe(false);
    expect(findings.some((item) => item.status === "unverified")).toBe(true);
  });
  it("discloses AppDB coverage gaps for unparsed files", () => {
    const input = makeContext(".", {
      manifest: {},
      sourceFilesSkipped: ["index.html"],
    });
    expect(analyzeAppDb(input)[0]).toMatchObject({
      status: "unverified",
      file: "index.html",
    });
    expect(analyzeDatasetReferences(input)[0]?.status).toBe("unverified");
  });
  it("reports direct missing aliases with source locations and accepts known aliases", () => {
    expect(
      analyzeDatasetReferences(context('domo.get("/data/v1/sales?limit=1")'))[0]
        ?.status,
    ).toBe("passed");
    const result = analyzeDatasetReferences(
      context('\ndomo.get("/data/v1/missing")'),
    );
    expect(result[0]).toMatchObject({
      status: "failed",
      confidence: "high",
      file: "app.ts",
      line: 2,
    });
  });

  it("continues valid alias checks around null and primitive mapping entries", () => {
    const input = context(
      'domo.get("/data/v1/missing");domo.get("/data/v1/sales")',
      [null, false, { alias: "sales", dataSetId: "id" }],
    );
    const result = analyzeDatasetReferences(input);
    expect(result).toHaveLength(1);
    expect(result[0]?.message).toContain('"missing"');
    expect(result[0]?.status).toBe("failed");
  });

  it("keeps direct AppDB requests and proxy configuration unverified", () => {
    const input = context(
      'domo.get("/domo/datastores/v1/collections/orders/documents")',
    );
    expect(analyzeAppDb(input)[0]?.status).toBe("unverified");
    expect(sourceReferencesAdvancedProxy(input)).toBe(true);
  });

  it.each([
    'const domo = new Map(); domo.get("/data/v1/missing")',
    'function f(domo: unknown) { domo.get("/data/v1/missing"); }',
    'const { client: domo } = other; domo.get("/data/v1/missing")',
    'import domo from "other-client"; domo.get("/data/v1/missing")',
  ])(
    "does not assert a missing Domo mapping for unresolved local bindings: %s",
    (source) => {
      expect(analyzeDatasetReferences(context(source))[0]).toMatchObject({
        status: "unverified",
        confidence: "low",
      });
    },
  );

  it.each([
    'const domo = window.domo; domo.get("/data/v1/missing")',
    'import domo from "ryuu.js"; domo.get("/data/v1/missing")',
  ])("retains recognized Domo binding forms: %s", (source) => {
    expect(analyzeDatasetReferences(context(source))[0]?.status).toBe("failed");
  });

  it("walks a deeply nested property chain without exhausting the JavaScript stack", () => {
    const input = context(
      'domo.get("/data/v1/missing"); root' +
        ".property".repeat(20000) +
        '; const marker = "AppDB";',
    );
    expect(analyzeDatasetReferences(input)[0]?.status).toBe("failed");
    expect(sourceReferencesAdvancedProxy(input)).toBe(true);
  });
});
