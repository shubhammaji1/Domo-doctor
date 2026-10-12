import type { Log, ReportingDescriptor, Result, Run } from "sarif";
import type { Diagnostic, ScanReport, Severity } from "../core/types.js";

export type SarifLog = Log;

export function createSarif(report: ScanReport): SarifLog {
  const rules = new Map<string, ReportingDescriptor>();
  for (const item of report.diagnostics) {
    if (rules.has(item.ruleId)) continue;
    rules.set(item.ruleId, {
      id: item.ruleId,
      shortDescription: { text: item.message },
      ...(item.explanation
        ? { fullDescription: { text: item.explanation } }
        : {}),
      ...(item.documentationUrl ? { helpUri: item.documentationUrl } : {}),
    });
  }
  const results: Result[] = report.diagnostics
    .filter((item) => item.status === "failed" || item.status === "unverified")
    .map(toSarifResult);
  const run: Run = {
    tool: {
      driver: {
        name: report.tool.name,
        version: report.tool.version,
        rules: [...rules.values()],
      },
    },
    results,
    properties: {
      scanStatus: report.scan.status,
      durationMs: report.scan.durationMs,
      summary: report.summary,
    },
  };
  return {
    version: "2.1.0",
    $schema:
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    runs: [run],
  };
}

function toSarifResult(item: Diagnostic): Result {
  const level: NonNullable<Result["level"]> =
    item.status === "unverified" ? "note" : severityToLevel(item.severity);
  const location: NonNullable<Result["locations"]>[number] | undefined =
    item.file
      ? {
          physicalLocation: {
            artifactLocation: {
              uri: item.file.split("/").map(encodeURIComponent).join("/"),
            },
            ...(item.line !== undefined
              ? {
                  region: {
                    startLine: item.line,
                    ...(item.column !== undefined
                      ? { startColumn: item.column }
                      : {}),
                  },
                }
              : {}),
          },
          ...(item.propertyPath
            ? { logicalLocations: [{ fullyQualifiedName: item.propertyPath }] }
            : {}),
        }
      : undefined;
  return {
    ruleId: item.ruleId,
    level,
    ...(item.status === "unverified" ? { kind: "review" } : {}),
    message: { text: item.message },
    ...(location ? { locations: [location] } : {}),
    properties: {
      status: item.status,
      ...(item.confidence ? { confidence: item.confidence } : {}),
    },
    ...(item.suppressed && item.suppressionReason
      ? {
          suppressions: [
            {
              kind: "external",
              status: "accepted",
              justification: item.suppressionReason,
            },
          ],
        }
      : {}),
  };
}

function severityToLevel(severity: Severity): NonNullable<Result["level"]> {
  return severity === "error"
    ? "error"
    : severity === "warning"
      ? "warning"
      : "note";
}
