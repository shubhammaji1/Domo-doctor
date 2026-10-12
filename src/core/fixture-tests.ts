import path from "node:path";
import { lstat } from "node:fs/promises";
import {
  assertSafePath,
  isInside,
  listProjectFiles,
  readProjectFile,
} from "./filesystem.js";
import { z } from "zod";
import { scanProject } from "./scanner.js";
import type { CheckStatus } from "./types.js";
import { assertJsonNesting } from "./input-limits.js";
import { safeDiagnosticText } from "./privacy.js";

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
  .strict()
  .refine(
    (value) => value.expect.length + value.forbid.length > 0,
    "At least one expectation or forbidden rule is required.",
  );

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
  const fixtureFiles = (
    await listProjectFiles(root, ["**/node_modules/**", "**/.git/**"], false)
  ).filter((file) => file.endsWith(".doctor-test.json"));
  if (fixtureFiles.length === 0)
    throw new Error(
      `No *.doctor-test.json fixtures found in ${safeDiagnosticText(fixtureDirectory)}.`,
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
      const text = await readProjectFile(root, file);
      assertJsonNesting(text);
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Fixture ${toPosix(fixturePath)} is not valid JSON.`);
    }
    const projectValue =
      typeof raw === "object" && raw !== null && "project" in raw
        ? raw.project
        : undefined;
    if (
      typeof projectValue === "string" &&
      !isInside(
        root,
        path.resolve(root, path.dirname(fixturePath), projectValue),
      )
    ) {
      throw new Error(
        "Fixture project must stay inside the fixture directory.",
      );
    }
    const parsed = fixtureSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        "Invalid fixture: check supported properties, value types, and at least one expectation.",
      );
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
    await assertSafePath(root, project);
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
          safeDiagnosticText(
            `Expected ${expectation.ruleId}${expectation.status ? ` with status ${expectation.status}` : ""}.`,
          ),
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
          safeDiagnosticText(
            `Expected no failed or unverified finding for ${ruleId}.`,
          ),
        );
      }
    }
    cases.push({
      file: toPosix(fixturePath),
      name: safeDiagnosticText(parsed.data.name ?? path.basename(fixturePath)),
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

function toPosix(value: string): string {
  return safeDiagnosticText(value.replaceAll("\\", "/"));
}

export type FixtureExpectedStatus = CheckStatus;
