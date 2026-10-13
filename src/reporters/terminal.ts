import pc from "picocolors";
import type { Diagnostic, ScanReport } from "../core/types.js";

export function formatTerminal(
  report: ScanReport,
  options: { color?: boolean; verbose?: boolean; columns?: number } = {},
): string {
  const color = pc.createColors(options.color ?? pc.isColorSupported);
  const requestedWidth = options.columns ?? process.stdout.columns ?? 88;
  const width = Number.isFinite(requestedWidth)
    ? Math.max(32, Math.min(120, Math.floor(requestedWidth)))
    : 88;
  const { errors, warnings, infos, passed, skipped, unverified, suppressed } =
    report.summary;
  const failure = errors + warnings + infos > 0;
  const divider = color.gray("─".repeat(width));
  const lines = [
    color.cyan(color.bold("DOMO DOCTOR")) +
      color.gray(`  v${report.tool.version}`),
    divider,
    ...wrap(`Project: ${report.scan.project}`, width),
    color.bold(
      failure
        ? color.red("Action required")
        : unverified || passed === 0
          ? color.cyan("Offline scan complete")
          : color.green("Offline checks passed"),
    ),
    "",
    ...wrap(
      `${errors} errors  ·  ${warnings} warnings  ·  ${infos} info`,
      width,
    ),
    ...wrap(
      `${passed} passed  ·  ${skipped} skipped  ·  ${unverified} unverified${suppressed ? `  ·  ${suppressed} suppressed` : ""}`,
      width,
    ),
    divider,
  ];
  const groups = [
    {
      title: "Needs attention",
      items: report.diagnostics.filter(
        (item) => item.status === "failed" && !item.suppressed,
      ),
    },
    {
      title: "Requires verification",
      items: report.diagnostics.filter(
        (item) => item.status === "unverified" && !item.suppressed,
      ),
    },
    {
      title: "Passed checks",
      items: report.diagnostics.filter(
        (item) => item.status === "passed" && !item.suppressed,
      ),
    },
    {
      title: "Skipped checks",
      items: options.verbose
        ? report.diagnostics.filter(
            (item) => item.status === "skipped" && !item.suppressed,
          )
        : [],
    },
    {
      title: "Suppressed findings",
      items: options.verbose
        ? report.diagnostics.filter((item) => item.suppressed)
        : [],
    },
  ];
  for (const group of groups) {
    if (!group.items.length) continue;
    lines.push("", color.bold(group.title), "");
    for (const item of group.items) {
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
        ? `${item.message} (suppressed)`
        : item.message;
      const prefix = `${icon} ${item.ruleId} `;
      const wrapped = wrap(message, width - item.ruleId.length - 3);
      lines.push(
        prefix + wrapped[0],
        ...wrapped
          .slice(1)
          .map((line) => " ".repeat(item.ruleId.length + 3) + line),
      );
      if (item.file) lines.push(...wrap(`File: ${item.file}`, width, "  "));
      if (item.propertyPath)
        lines.push(...wrap(`Location: ${item.propertyPath}`, width, "  "));
      else if (item.line !== undefined)
        lines.push(
          `  Location: ${item.line}${item.column !== undefined ? `:${item.column}` : ""}`,
        );
      const showDetails = item.status === "failed" || options.verbose;
      if (showDetails && item.explanation)
        lines.push(...wrap(`Why: ${item.explanation}`, width, "  "));
      if ((showDetails || item.status === "unverified") && item.suggestion)
        lines.push(
          ...wrap(
            `${item.status === "unverified" ? "Next check" : "Suggested fix"}: ${item.suggestion}`,
            width,
            "  ",
          ),
        );
      if (showDetails && item.suppressionReason)
        lines.push(
          ...wrap(`Suppression reason: ${item.suppressionReason}`, width, "  "),
        );
      if (showDetails && item.documentationUrl)
        lines.push(
          ...wrap(`Documentation: ${item.documentationUrl}`, width, "  "),
        );
    }
  }
  if (!options.verbose)
    lines.push(
      "",
      ...wrap(
        "Use --verbose for explanations, documentation, and skipped checks.",
        width,
      ),
    );
  lines.push(
    "",
    divider,
    ...wrap(
      failure
        ? "Status: Findings were detected."
        : "Status: Scan completed; deployment readiness was not verified.",
      width,
    ),
  );
  if (options.verbose)
    lines.push(
      ...wrap(
        `Rules executed: ${report.rules.length} | Duration: ${report.scan.durationMs} ms | Started: ${report.scan.startedAt}`,
        width,
      ),
    );
  return lines.join("\n");
}

function wrap(text: string, width: number, indent = ""): string[] {
  const available = Math.max(1, width - indent.length);
  const result: string[] = [];
  let remaining = text;
  while (remaining.length > available) {
    const space = remaining.lastIndexOf(" ", available);
    const end = space > 0 ? space : available;
    result.push(indent + remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  result.push(indent + remaining);
  return result;
}

export function diagnosticLocation(item: Diagnostic): string | undefined {
  if (!item.file) return undefined;
  return item.propertyPath
    ? `${item.file} (${item.propertyPath})`
    : item.line
      ? `${item.file}:${item.line}${item.column ? `:${item.column}` : ""}`
      : item.file;
}
