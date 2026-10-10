import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import fg from "fast-glob";
import { z } from "zod";
import { scanProject } from "./scanner.js";
import type { CheckStatus } from "./types.js";

const fixtureSchema = z
  .object({
    name: z.string().min(1).optional(),
    project: z.string().min(1),
    expect: z
      .array(
        z
          .object({
            ruleId: z.string().min(1),
            status: z
              .enum(["passed", "failed", "skipped", "unverified"])
              .optional(),
          })
          .strict(),
      )
      .default([]),
    forbid: z.array(z.string().min(1)).default([]),
  })
  .strict();

export interface FixtureTestCaseResult {
  file: string;
  name: string;
  passed: boolean;
  failures: string[];
}

export interface FixtureTestReport {
  fixtureDirectory: string;
  total: number;
  passed: number;
  failed: number;
  cases: FixtureTestCaseResult[];
}

export async function runFixtureTests(
  fixtureDirectory: string,
  cwd = process.cwd(),
): Promise<FixtureTestReport> {
  const root = path.resolve(cwd, fixtureDirectory);
  const rootStats = await lstat(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory())
    throw new Error("Fixture directory must be a real directory.");
  const fixtureFiles = await fg("**/*.doctor-test.json", {
    cwd: root,
    onlyFiles: true,
    dot: false,
    followSymbolicLinks: false,
    ignore: ["**/node_modules/**", "**/.git/**"],
  });
  fixtureFiles.sort((a, b) => a.localeCompare(b));
  if (fixtureFiles.length === 0)
    throw new Error(
      `No *.doctor-test.json fixtures found in ${fixtureDirectory}.`,
    );
  const cases: FixtureTestCaseResult[] = [];
  for (const fixturePath of fixtureFiles) {
    const file = path.join(root, fixturePath);
    const stats = await lstat(file);
    if (stats.isSymbolicLink() || !stats.isFile())
      throw new Error(
        `Fixture ${toPosix(fixturePath)} must be a regular file.`,
      );
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf8")) as unknown;
    } catch {
      throw new Error(`Fixture ${toPosix(fixturePath)} is not valid JSON.`);
    }
    const parsed = fixtureSchema.safeParse(raw);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid fixture ${toPosix(fixturePath)}: ${details}`);
    }
    const project = path.resolve(
      root,
      path.dirname(fixturePath),
      parsed.data.project,
    );
    if (!isInside(root, project))
      throw new Error(
        `Fixture ${toPosix(fixturePath)} project must stay inside ${fixtureDirectory}.`,
      );
    const report = await scanProject({ root: project, cwd: project });
    const failures: string[] = [];
    for (const expectation of parsed.data.expect) {
      const matching = report.diagnostics.some(
        (item) =>
          item.ruleId === expectation.ruleId &&
          (expectation.status === undefined ||
            item.status === expectation.status),
      );
      if (!matching)
        failures.push(
          `Expected ${expectation.ruleId}${expectation.status ? ` with status ${expectation.status}` : ""}.`,
        );
    }
    for (const ruleId of parsed.data.forbid) {
      if (
        report.diagnostics.some(
          (item) =>
            item.ruleId === ruleId &&
            (item.status === "failed" || item.status === "unverified"),
        )
      ) {
        failures.push(
          `Expected no failed or unverified finding for ${ruleId}.`,
        );
      }
    }
    cases.push({
      file: toPosix(fixturePath),
      name: parsed.data.name ?? path.basename(fixturePath),
      passed: failures.length === 0,
      failures,
    });
  }
  const passed = cases.filter((item) => item.passed).length;
  return {
    fixtureDirectory: toPosix(root),
    total: cases.length,
    passed,
    failed: cases.length - passed,
    cases,
  };
}

export function formatFixtureTestReport(report: FixtureTestReport): string {
  const lines = [
    "DOMO DOCTOR FIXTURE TESTS",
    `Fixtures: ${report.fixtureDirectory}`,
    "",
  ];
  for (const item of report.cases) {
    lines.push(`${item.passed ? "✓" : "✗"} ${item.name} (${item.file})`);
    for (const failure of item.failures) lines.push(`  ${failure}`);
  }
  lines.push(
    "",
    `${report.passed} passed | ${report.failed} failed | ${report.total} total`,
  );
  return `${lines.join("\n")}\n`;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function toPosix(value: string): string {
  return value.replaceAll("\\", "/");
}

export type FixtureExpectedStatus = CheckStatus;
