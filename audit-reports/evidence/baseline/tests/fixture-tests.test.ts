import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatFixtureTestReport,
  runFixtureTests,
} from "../src/core/fixture-tests.js";
import { temporaryDirectory } from "./helpers.js";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("offline fixture test runner", () => {
  it("runs the healthy and broken example scenarios", async () => {
    const report = await runFixtureTests("examples", repositoryRoot);
    expect(report.total).toBe(2);
    expect(report.passed).toBe(2);
    expect(formatFixtureTestReport(report)).toContain(
      "2 passed | 0 failed | 2 total",
    );
  });

  it("rejects empty, malformed, invalid, and path-escaping fixture sets", async () => {
    const fixture = await temporaryDirectory();
    try {
      await expect(runFixtureTests(fixture.root)).rejects.toThrow(
        /No \*\.doctor-test\.json/,
      );
      await writeFile(path.join(fixture.root, "bad.doctor-test.json"), "{");
      await expect(runFixtureTests(fixture.root)).rejects.toThrow(
        /not valid JSON/,
      );
      await writeFile(
        path.join(fixture.root, "bad.doctor-test.json"),
        JSON.stringify({ project: "../outside" }),
      );
      await expect(runFixtureTests(fixture.root)).rejects.toThrow(
        /must stay inside/,
      );
      await writeFile(
        path.join(fixture.root, "bad.doctor-test.json"),
        JSON.stringify({ project: "." }),
      );
      await expect(runFixtureTests(fixture.root)).rejects.toThrow(
        /Invalid fixture/,
      );
      await mkdir(path.join(fixture.root, "project"));
      await writeFile(
        path.join(fixture.root, "bad.doctor-test.json"),
        JSON.stringify({
          project: "project",
          expect: [{ ruleId: "DD-MAN-001", status: "failed" }],
        }),
      );
      const report = await runFixtureTests(fixture.root);
      expect(report.passed).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });
});
