import { describe, expect, it } from "vitest";
import { formatJson } from "../src/reporters/json.js";
import { createSarif } from "../src/reporters/sarif.js";
import {
  diagnosticLocation,
  formatTerminal,
} from "../src/reporters/terminal.js";
import type { Diagnostic, ScanReport } from "../src/core/types.js";

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
  it("puts failures and pending verification ahead of passed checks", () => {
    const variant = {
      ...report,
      diagnostics: [
        {
          ruleId: "DD-MAN-001",
          severity: "info" as const,
          status: "passed" as const,
          message: "Manifest found.",
          explanation: "Present.",
        },
        ...report.diagnostics,
      ],
    };
    const output = formatTerminal(variant, { color: false });
    expect(output.indexOf("Needs attention")).toBeLessThan(
      output.indexOf("Requires verification"),
    );
    expect(output.indexOf("Requires verification")).toBeLessThan(
      output.indexOf("Passed checks"),
    );
    expect(output.indexOf("1 errors")).toBeLessThan(
      output.indexOf("Needs attention"),
    );
    expect(output).toContain("Action required");
    expect(output).not.toContain("Why: Runtime value.");
    expect(formatTerminal(variant, { color: false, verbose: true })).toContain(
      "Why: Runtime value.",
    );
  });

  it.each([32, 64, 88, 120])(
    "wraps diagnostics and long paths at %i columns",
    (columns) => {
      const variant = {
        ...report,
        scan: { ...report.scan, project: "project/".repeat(35) },
        diagnostics: [
          {
            ...report.diagnostics[0]!,
            message: "A long diagnostic message ".repeat(15),
            file: "source/".repeat(40),
            documentationUrl: "https://example.com/" + "long-path/".repeat(40),
          },
        ],
      };
      const output = formatTerminal(variant, {
        color: false,
        verbose: true,
        columns,
      });
      expect(output.split("\n").every((line) => line.length <= columns)).toBe(
        true,
      );
      expect(output).toContain("DD-MAN-004");
    },
  );

  it("keeps skipped details available in verbose mode and avoids false pass banners", () => {
    const variant = {
      ...report,
      summary: { ...report.summary, errors: 0, skipped: 1 },
      diagnostics: [
        {
          ruleId: "DD-MAN-006",
          severity: "info" as const,
          status: "skipped" as const,
          message: "No mappings.",
          explanation: "No mapping property.",
        },
        report.diagnostics[1]!,
      ],
    };
    const output = formatTerminal(variant, { color: false });
    expect(output).toContain("Offline scan complete");
    expect(output).not.toContain("Offline checks passed");
    expect(output).not.toContain("DD-MAN-006");
    expect(formatTerminal(variant, { color: false, verbose: true })).toContain(
      "DD-MAN-006",
    );
    expect(
      formatTerminal(
        { ...variant, summary: { ...variant.summary, unverified: 0 } },
        { color: false, columns: Number.NaN },
      ),
    ).toContain("Offline checks passed");
  });

  it("retains severity, suppression justification and optional locations in SARIF", () => {
    const diagnostics: Diagnostic[] = [
      {
        ruleId: "x",
        severity: "warning" as const,
        status: "failed" as const,
        message: "warning",
        file: "space name.js",
        line: 3,
        suppressed: true,
        suppressionReason: "Reviewed",
        confidence: "high" as const,
        documentationUrl: "https://example.com/rule",
      },
      {
        ruleId: "x",
        severity: "info" as const,
        status: "failed" as const,
        message: "info",
      },
      {
        ruleId: "y",
        severity: "info" as const,
        status: "passed" as const,
        message: "passed",
        file: "a.js",
      },
      {
        ruleId: "z",
        severity: "info" as const,
        status: "skipped" as const,
        message: "skipped",
      },
    ].map((item) => ({ ...item, explanation: "" }));
    const variant = { ...report, diagnostics };
    const results = createSarif(variant).runs[0]?.results;
    expect(results?.map((item) => item.level)).toEqual(["warning", "note"]);
    expect(results?.[0]?.suppressions?.[0]?.justification).toBe("Reviewed");
    expect(results?.[1]?.locations).toBeUndefined();
    expect(results?.[0]?.locations?.[0]?.physicalLocation?.region).toEqual({
      startLine: 3,
    });
    const text = formatTerminal(variant, { color: true, verbose: true });
    expect(text).toContain("Suppression reason: Reviewed");
    expect(text).toContain("Rules executed:");
    expect(diagnosticLocation(diagnostics[0]!)).toBe("space name.js:3");
    expect(diagnosticLocation(diagnostics[1]!)).toBeUndefined();
    expect(diagnosticLocation(diagnostics[2]!)).toBe("a.js");
    expect(diagnosticLocation({ ...diagnostics[0]!, column: 4 })).toBe(
      "space name.js:3:4",
    );
    expect(
      diagnosticLocation({ ...diagnostics[0]!, propertyPath: "mapping[0]" }),
    ).toBe("space name.js (mapping[0])");
  });
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
