import path from "node:path";
import type {
  Diagnostic,
  RuleDefinition,
  RuleExecution,
  ScanConfig,
  ScanContext,
  Severity,
} from "./types.js";

export interface RuleEngineResult {
  diagnostics: Diagnostic[];
  executions: RuleExecution[];
}

export async function runRules(
  rules: readonly RuleDefinition[],
  context: ScanContext,
  options: { onlyCategories?: readonly RuleDefinition["category"][] } = {},
): Promise<RuleEngineResult> {
  const diagnostics: Diagnostic[] = [];
  const executions: RuleExecution[] = [];
  for (const rule of rules) {
    if (
      options.onlyCategories &&
      !options.onlyCategories.includes(rule.category)
    )
      continue;
    const override = context.config.rules[rule.id];
    if (override === "off") {
      const skippedDiagnostic: Diagnostic = {
        ruleId: rule.id,
        severity: "info",
        status: "skipped",
        message: "Rule is disabled in configuration.",
        explanation: rule.description,
        confidence: "high",
      };
      diagnostics.push(skippedDiagnostic);
      executions.push({
        ruleId: rule.id,
        description: rule.description,
        status: "skipped",
        durationMs: 0,
      });
      continue;
    }
    const started = performance.now();
    let current: Diagnostic[];
    try {
      current = await withTimeout(
        Promise.resolve().then(() => rule.run(context)),
        rule.timeoutMs ?? context.config.ruleTimeoutMs,
      );
      if (current.length === 0)
        current = [
          {
            ruleId: rule.id,
            severity: "info",
            status: "passed",
            message: rule.description,
            explanation: "No problems were detected by this check.",
            ...(rule.documentationUrl
              ? { documentationUrl: rule.documentationUrl }
              : {}),
            confidence: "high",
          },
        ];
      current = current.map((diagnostic) => ({
        ...diagnostic,
        ...(override ? { severity: override } : {}),
        ...applySuppression(diagnostic, context.config),
      }));
      diagnostics.push(...current);
      executions.push({
        ruleId: rule.id,
        description: rule.description,
        status: aggregateStatus(current),
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      const timedOut = error instanceof RuleTimeoutError;
      const failed: Diagnostic = {
        ruleId: rule.id,
        severity: override ?? "error",
        status: "failed",
        message: timedOut
          ? "Diagnostic rule timed out."
          : "Diagnostic rule failed unexpectedly.",
        explanation: timedOut
          ? `The check exceeded its ${rule.timeoutMs ?? context.config.ruleTimeoutMs} ms limit. No result was inferred.`
          : "The check encountered an internal error. Project data and exception details were omitted from output.",
        ...(rule.documentationUrl
          ? { documentationUrl: rule.documentationUrl }
          : {}),
        confidence: "high",
      };
      diagnostics.push(failed);
      executions.push({
        ruleId: rule.id,
        description: rule.description,
        status: "failed",
        durationMs: Math.round(performance.now() - started),
      });
    }
  }
  diagnostics.sort(compareDiagnostics);
  return { diagnostics, executions };
}

export function passesFailureThreshold(
  diagnostics: readonly Diagnostic[],
  failOn: Severity,
): boolean {
  const ranks: Record<Severity, number> = { info: 1, warning: 2, error: 3 };
  return diagnostics.some(
    (item) =>
      item.status === "failed" &&
      !item.suppressed &&
      ranks[item.severity] >= ranks[failOn],
  );
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    (left.file ?? "").localeCompare(right.file ?? "") ||
    (left.line ?? 0) - (right.line ?? 0) ||
    (left.column ?? 0) - (right.column ?? 0) ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.message.localeCompare(right.message)
  );
}

function aggregateStatus(
  diagnostics: readonly Diagnostic[],
): Diagnostic["status"] {
  if (diagnostics.some((item) => item.status === "failed")) return "failed";
  if (diagnostics.some((item) => item.status === "unverified"))
    return "unverified";
  if (diagnostics.every((item) => item.status === "skipped")) return "skipped";
  return "passed";
}

function applySuppression(
  diagnostic: Diagnostic,
  config: ScanConfig,
):
  Pick<Diagnostic, "suppressed" | "suppressionReason"> | Record<string, never> {
  if (diagnostic.status !== "failed") return {};
  const normalizedFile = diagnostic.file
    ? normalizePath(diagnostic.file)
    : undefined;
  const suppression = config.suppressions.find(
    (item) =>
      item.ruleId === diagnostic.ruleId &&
      (item.file === undefined ||
        (normalizedFile !== undefined &&
          normalizePath(item.file) === normalizedFile)),
  );
  return suppression
    ? { suppressed: true, suppressionReason: suppression.reason }
    : {};
}

function normalizePath(value: string): string {
  return path.posix.normalize(value.replaceAll("\\", "/"));
}

class RuleTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RuleTimeoutError()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
