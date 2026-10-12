import pc from "picocolors";
import type { Diagnostic, ScanReport } from "../core/types.js";

export function formatTerminal(
  report: ScanReport,
  options: { color?: boolean; verbose?: boolean } = {},
): string {
  const color = pc.createColors(options.color ?? pc.isColorSupported);
  const lines = [
    color.cyan(color.bold("DOMO DOCTOR")),
    "Diagnose. Test. Fix. Ship.",
    "",
    `Scanning: ${report.scan.project}`,
    "",
  ];
  for (const item of report.diagnostics) {
    const icon =
      item.status === "passed"
        ? color.green("✓")
        : item.status === "skipped"
          ? color.gray("–")
          : item.status === "unverified"
            ? color.yellow("?")
            : item.severity === "error"
              ? color.red("✗")
              : item.severity === "warning"
                ? color.yellow("⚠")
                : color.cyan("ℹ");
    const message = item.suppressed
      ? `${item.message} ${color.gray("(suppressed)")}`
      : item.message;
    lines.push(`${icon} ${item.ruleId} ${message}`);
    if (item.file) lines.push(`  File: ${item.file}`);
    if (item.propertyPath) lines.push(`  Location: ${item.propertyPath}`);
    else if (item.line !== undefined)
      lines.push(
        `  Location: ${item.line}${item.column !== undefined ? `:${item.column}` : ""}`,
      );
    const showDetails =
      item.status === "failed" ||
      item.status === "unverified" ||
      options.verbose;
    if (showDetails && item.explanation)
      lines.push(`  Why: ${item.explanation}`);
    if (showDetails && item.suggestion)
      lines.push(`  Suggested fix: ${item.suggestion}`);
    if (showDetails && item.suppressionReason)
      lines.push(`  Suppression reason: ${item.suppressionReason}`);
    if (showDetails && item.documentationUrl)
      lines.push(`  Documentation: ${item.documentationUrl}`);
  }
  const { errors, warnings, infos, passed, skipped, unverified, suppressed } =
    report.summary;
  lines.push(
    "",
    "Diagnostics:",
    `${errors} errors | ${warnings} warnings | ${infos} info | ${passed} passed | ${skipped} skipped | ${unverified} unverified${suppressed ? ` | ${suppressed} suppressed` : ""}`,
  );
  const failure = errors + warnings + infos > 0;
  lines.push(
    "",
    failure
      ? "Status: Findings were detected."
      : "Status: Scan completed; deployment readiness was not verified.",
  );
  if (options.verbose)
    lines.push(
      `Rules executed: ${report.rules.length} | Duration: ${report.scan.durationMs} ms | Started: ${report.scan.startedAt}`,
    );
  return lines.join("\n");
}

export function diagnosticLocation(item: Diagnostic): string | undefined {
  if (!item.file) return undefined;
  return item.propertyPath
    ? `${item.file} (${item.propertyPath})`
    : item.line
      ? `${item.file}:${item.line}${item.column ? `:${item.column}` : ""}`
      : item.file;
}
