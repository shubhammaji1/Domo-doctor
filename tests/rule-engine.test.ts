import { describe, expect, it } from "vitest";
import { passesFailureThreshold, runRules } from "../src/core/rule-engine.js";
import type { Diagnostic, RuleDefinition } from "../src/core/types.js";
import { makeConfig, makeContext } from "./helpers.js";

function diag(
  status: Diagnostic["status"],
  severity: Diagnostic["severity"] = "error",
  file = "src/app.js",
): Diagnostic {
  return {
    ruleId: "DD-TEST-001",
    severity,
    status,
    message: "test result",
    file,
    explanation: "test",
  };
}

describe("rule engine", () => {
  it("runs rules deterministically and creates passed results for empty checks", async () => {
    const rules: RuleDefinition[] = [
      {
        id: "DD-TEST-001",
        description: "one",
        category: "manifest",
        run: () => [],
      },
      {
        id: "DD-TEST-002",
        description: "two",
        category: "mappings",
        run: () => [diag("failed", "warning", "z.js")],
      },
    ];
    const result = await runRules(rules, makeContext("."));
    expect(result.executions.map((item) => item.ruleId)).toEqual([
      "DD-TEST-001",
      "DD-TEST-002",
    ]);
    expect(result.diagnostics[0]?.status).toBe("passed");
    expect(result.diagnostics[1]?.file).toBe("z.js");
    expect(result.executions[1]?.status).toBe("failed");
  });

  it("marks disabled rules skipped and applies severity overrides", async () => {
    const rule: RuleDefinition = {
      id: "DD-TEST-001",
      description: "test",
      category: "manifest",
      run: () => [diag("failed")],
    };
    const disabled = await runRules(
      [rule],
      makeContext(".", {
        config: makeConfig(".", { rules: { "DD-TEST-001": "off" } }),
      }),
    );
    expect(disabled.diagnostics[0]?.status).toBe("skipped");
    const raised = await runRules(
      [rule],
      makeContext(".", {
        config: makeConfig(".", { rules: { "DD-TEST-001": "warning" } }),
      }),
    );
    expect(raised.diagnostics[0]?.severity).toBe("warning");
  });

  it("applies file-scoped suppressions case-insensitively and keeps findings visible", async () => {
    const rule: RuleDefinition = {
      id: "DD-TEST-001",
      description: "test",
      category: "manifest",
      run: () => [diag("failed", "error", "src/App.js")],
    };
    const result = await runRules(
      [rule],
      makeContext(".", {
        config: makeConfig(".", {
          suppressions: [
            {
              ruleId: "DD-TEST-001",
              file: "SRC/app.JS",
              reason: "Runtime route table",
            },
          ],
        }),
      }),
    );
    expect(result.diagnostics[0]?.suppressed).toBe(true);
    expect(result.diagnostics[0]?.suppressionReason).toBe(
      "Runtime route table",
    );
    expect(passesFailureThreshold(result.diagnostics, "error")).toBe(false);
  });

  it("does not suppress other files or non-failed statuses", async () => {
    const rule: RuleDefinition = {
      id: "DD-TEST-001",
      description: "test",
      category: "manifest",
      run: () => [
        diag("failed", "error", "other.js"),
        diag("unverified", "warning"),
      ],
    };
    const result = await runRules(
      [rule],
      makeContext(".", {
        config: makeConfig(".", {
          suppressions: [
            { ruleId: "DD-TEST-001", file: "src/app.js", reason: "Scoped" },
          ],
        }),
      }),
    );
    expect(result.diagnostics.every((item) => !item.suppressed)).toBe(true);
  });

  it("isolates thrown rule errors and timeouts", async () => {
    const broken: RuleDefinition = {
      id: "DD-TEST-001",
      description: "throw",
      category: "manifest",
      run: () => {
        throw new Error("secret=do-not-print");
      },
    };
    const timeout: RuleDefinition = {
      id: "DD-TEST-002",
      description: "hang",
      category: "manifest",
      timeoutMs: 5,
      run: () => new Promise<Diagnostic[]>(() => {}),
    };
    const result = await runRules([broken, timeout], makeContext("."));
    expect(result.diagnostics[0]?.message).toBe(
      "Diagnostic rule failed unexpectedly.",
    );
    expect(result.diagnostics[0]?.explanation).not.toContain("do-not-print");
    expect(
      result.diagnostics.some(
        (item) => item.message === "Diagnostic rule timed out.",
      ),
    ).toBe(true);
    expect(result.executions.every((item) => item.status === "failed")).toBe(
      true,
    );
  });

  it("respects category filtering and aggregates skipped or unverified outcomes", async () => {
    const rules: RuleDefinition[] = [
      {
        id: "DD-TEST-001",
        description: "skip",
        category: "manifest",
        run: () => [diag("skipped")],
      },
      {
        id: "DD-TEST-002",
        description: "unverified",
        category: "mappings",
        run: () => [diag("unverified", "warning")],
      },
    ];
    const filtered = await runRules(rules, makeContext("."), {
      onlyCategories: ["mappings"],
    });
    expect(filtered.executions.map((item) => item.ruleId)).toEqual([
      "DD-TEST-002",
    ]);
    expect(filtered.executions[0]?.status).toBe("unverified");
    const skipped = await runRules(
      [
        {
          id: "DD-TEST-003",
          description: "skipped result",
          category: "manifest",
          run: () => [diag("skipped")],
        },
      ],
      makeContext("."),
    );
    expect(skipped.executions[0]?.status).toBe("skipped");
  });

  it("uses the configured threshold only for failed unsuppressed results", () => {
    expect(passesFailureThreshold([diag("failed", "warning")], "error")).toBe(
      false,
    );
    expect(passesFailureThreshold([diag("failed", "warning")], "warning")).toBe(
      true,
    );
    expect(passesFailureThreshold([diag("failed", "info")], "info")).toBe(true);
    expect(passesFailureThreshold([diag("unverified", "error")], "error")).toBe(
      false,
    );
    expect(
      passesFailureThreshold(
        [{ ...diag("failed"), suppressed: true }],
        "error",
      ),
    ).toBe(false);
  });
});
