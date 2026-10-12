import { describe, expect, it } from "vitest";
import { formatJson } from "../src/reporters/json.js";
import { createSarif } from "../src/reporters/sarif.js";
import { formatTerminal } from "../src/reporters/terminal.js";
import type { ScanReport } from "../src/core/types.js";

const report: ScanReport = {
  schemaVersion: "1.0.0",
  tool: { name: "domo-doctor", version: "0.1.0" },
  scan: {
    status: "completed",
    project: ".",
    startedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 5,
  },
  summary: {
    errors: 1,
    warnings: 0,
    infos: 0,
    passed: 1,
    skipped: 0,
    unverified: 1,
    suppressed: 0,
  },
  rules: [
    {
      ruleId: "DD-MAN-004",
      description: "Dataset alias",
      status: "failed",
      durationMs: 1,
    },
  ],
  diagnostics: [
    {
      ruleId: "DD-MAN-004",
      severity: "error",
      status: "failed",
      message: "Duplicate alias.",
      file: "manifest.json",
      propertyPath: "mapping[1].alias",
      explanation: "Ambiguous.",
      suggestion: "Rename it.",
    },
    {
      ruleId: "DD-MAP-002",
      severity: "warning",
      status: "unverified",
      message: "Dynamic path.",
      file: "src/app.ts",
      line: 4,
      column: 8,
      explanation: "Runtime value.",
    },
  ],
};

describe("reporters", () => {
  it("writes stable JSON with status counts and diagnostics", () => {
    const parsed = JSON.parse(formatJson(report)) as ScanReport;
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.summary.unverified).toBe(1);
    expect(parsed.diagnostics[0]?.propertyPath).toBe("mapping[1].alias");
  });

  it("writes SARIF 2.1.0 with code locations, rules, and note-level unverified results", () => {
    const sarif = createSarif(report);
    expect(sarif.version).toBe("2.1.0");
    const run = sarif.runs[0] as {
      results: Array<{
        ruleId: string;
        level: string;
        kind?: string;
        locations?: unknown[];
      }>;
    };
    expect(run.results).toHaveLength(2);
    expect(run.results[0]?.ruleId).toBe("DD-MAN-004");
    expect(run.results[1]?.level).toBe("note");
    expect(run.results[1]?.kind).toBe("review");
    expect(run.results[1]?.locations).toBeDefined();
  });

  it("prints rule IDs, separate skipped/unverified counts, and supports no-color mode", () => {
    const output = formatTerminal(report, { color: false });
    expect(output).toContain("DD-MAN-004");
    expect(output).toContain("1 unverified");
    expect(output).not.toContain("\u001b[");
  });
});
