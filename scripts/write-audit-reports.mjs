import { readFile, writeFile } from "node:fs/promises";

const directory = new URL("../audit-reports/", import.meta.url);
const read = async (name) =>
  JSON.parse(await readFile(new URL(name, directory), "utf8"));
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const cell = (value) =>
  String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll(/\r?\n/g, " ");
const table = (headers, rows) =>
  [
    "| " + headers.join(" | ") + " |",
    "| " + headers.map(() => "---").join(" | ") + " |",
    ...rows.map((row) => "| " + row.map(cell).join(" | ") + " |"),
  ].join("\n");
const baseline = await read("evidence/performance/baseline.json");
const final = await read("evidence/performance/final.json");
const performanceRows = ["help", "small", "medium", "large"].map((workload) => {
  const before = baseline.runs.filter((run) => run.workload === workload);
  const after = final.runs.filter((run) => run.workload === workload);
  return [
    workload,
    median(before.map((run) => run.wallMs)).toFixed(1),
    median(after.map((run) => run.wallMs)).toFixed(1),
    workload === "help"
      ? "N/A"
      : median(after.map((run) => run.scanMs)).toFixed(1),
    median(
      after.map(
        (run) =>
          (run.cpuUsageMicroseconds.user + run.cpuUsageMicroseconds.system) /
          1000,
      ),
    ).toFixed(1),
    (Math.max(...after.map((run) => run.resourceUsage.maxRSS)) / 1024).toFixed(
      1,
    ),
    after.every((run) => run.exitCode === 0)
      ? "VERIFIED PASS"
      : "VERIFIED FAILURE",
  ];
});
await writeFile(
  new URL("PERFORMANCE_REPORT.md", directory),
  `# Performance report

Measured on Windows ${final.environment.osRelease} x64, Node ${final.environment.node}, Intel Core i5-10210U (eight logical CPUs), ${(final.environment.totalMemoryBytes / 2 ** 30).toFixed(2)} GiB installed RAM. Three repetitions per workload; 30-second child timeout and 512 MiB V8 old-space limit (not a total RSS cap). Inputs are fake healthy dataset requests, not customer data.

${table(["Workload", "Baseline median wall ms", "Final median wall ms", "Final median scan ms", "Final median CPU ms", "Final maximum peak RSS MiB", "Result"], performanceRows)}

Workloads: small = 10 files × 50 lines (25,900 source bytes); medium = 100 × 100 (519,000 bytes); large = 1,000 × 50 (2,590,000 bytes). Help measures CLI startup/imports without a project scan. Wall includes startup, imports, scan and instrumentation; CPU is child user+system CPU. RSS is process peak resident memory; heap snapshots and full per-run metrics remain in JSON.

All three final reports for each scan workload were identical after removing timestamps/durations: ${JSON.stringify(final.stableReports)}. Build SHA256 was unchanged throughout final runs: ${final.buildUnchangedDuringRuns}; hash ${final.buildBeforeSha256}. Inputs include saved hashes. Reproduce with 'node scripts/audit-benchmark.mjs final' after building; do not rebuild concurrently.

[Baseline measurements](evidence/performance/baseline.json), [final measurements](evidence/performance/final.json), [run output](evidence/final-benchmark.log). Baseline is the saved local candidate before the expanded fixes, not the unusable published release. The baseline ran amid heavier audit contention. Caches were not cleared, background activity was not controlled, and this is one machine: lower final wall times do not prove an optimization caused the difference. No cold-cache, macOS/Linux, multi-machine, long-running leak, concurrent scan or production load guarantee is claimed.

Observed bottlenecks/opportunities: CLI help eagerly imports the TypeScript/scanner dependency tree; larger projects retain parsed ASTs and show higher RSS. Profile lazy command imports and parse/storage lifetime before changing architecture. Bounds stop known excessive-size/depth cases, but synchronous parsers cannot be interrupted by Promise timeouts. Worker isolation can strengthen hard deadlines. Set performance budgets only after collecting less-contended cross-platform samples.
`,
);

const commands = await read("evidence/final-commands.json");
const qa = await read("evidence/qa/results.json");
const qaCases = Array.isArray(qa) ? qa : qa.results;
let unitRows = [];
try {
  const units = await read("evidence/final-vitest.json");
  unitRows = units.testResults.flatMap((file) =>
    file.assertionResults.map((assertion) => [
      assertion.fullName,
      assertion.status === "passed" ? "VERIFIED PASS" : "VERIFIED FAILURE",
      "Assertion expectations met if passed; exact source in tests/" +
        file.name.split(/[\\/]/).at(-1),
    ]),
  );
} catch {
  unitRows = [
    [
      "See final coverage log",
      "PARTIALLY TESTED",
      "JSON test inventory not yet generated",
    ],
  ];
}
await writeFile(
  new URL("TEST_RESULTS.md", directory),
  `# Test results — 12 October 2026

Environment: Windows 11 x64, Node22.22.0, npm10.9.4, Yarn1.22.22. No live Domo credentials or APIs. Tests use disposable synthetic projects except the read-only configured pod_demo scan. Latest statuses below are generated from retained command/test evidence; previous failed verification attempts are retained separately.

## Final verification commands

${table(
  ["Command", "Exit", "Status", "Log"],
  commands.map((command) => [
    command.command,
    command.exitCode,
    command.exitCode === 0 ? "VERIFIED PASS" : "VERIFIED FAILURE",
    "[log](" + command.log.replace("audit-reports/", "") + ")",
  ]),
)}

Typecheck expects no TypeScript errors; lint/format expect no violations; self-test and Vitest expect all assertions to pass; full-source coverage requires at least 90% statements/branches/functions/lines; pack smoke expects installed CLI version, scan and named ESM import to work; production audit expects zero known production vulnerabilities. Coverage includes 'src/**/*.ts', rather than only manifest/rule-engine files. Exact percentages/counts are in [coverage output](evidence/final-test-coverage.log). These results do not claim every branch is tested.

## Individual automated assertions

[Machine-readable Vitest inventory](evidence/final-vitest.json) includes test names, statuses and failures. Assertions in the referenced test files define each expected outcome; successful execution means those assertions were met.

${table(["Test", "Status", "Expected / actual interpretation"], unitRows)}

## CLI and realistic synthetic cases

Every case retains command arguments, expected result, stdout/stderr, status and elapsed time in [QA JSON](evidence/qa/results.json). 'node scripts/audit-validation.mjs' executed ${qaCases.length} cases. A controlled error during shape fuzzing is an accepted bounded behavior, not proof that invalid inputs have useful diagnostic coverage.

${table(
  ["Case", "Expected", "Actual"],
  qaCases.map((item) => [item.name, item.expected, item.result]),
)}

## Additional executed checks

- Published/fresh/upgrade/reinstall/uninstall/global-prefix/Yarn checks: [distribution findings](distribution-findings.md), [commands](evidence/distribution/checks.log), [file list](evidence/distribution/candidate-file-list.txt). Published CLI/import VERIFIED FAILURE; staged candidate VERIFIED PASS in the tested environment. Final pack smoke supersedes the earlier staged candidate for current source.
- Security before/after: [security audit](SECURITY_AUDIT.md) enumerates each reproduced input and expected rejection/redaction. Final probes record no tested credential/control leaks, no outside output overwrite and rejection of the instrumented read swap. Passive network/execution/immutability control is [recorded](evidence/security/passive-proof.json).
- Independent platform probe: 33 observed scenarios in [baseline platform results](evidence/platform/results.json), with per-case reports. Probe exit0 denotes completed observation, not all assertions passed. Confirmed defects and follow-up regression fixes are in [platform findings](platform-findings.md) and source-code/adversarial tests; old observations were preserved rather than rewritten as passes.
- Benchmarks: 12 bounded final runs, all exit0; stable repeated reports for three project sizes. Metrics and limitations: [performance report](PERFORMANCE_REPORT.md).
- pod_demo: initial default manifest lookup exit1, then configured manifest exit0; zero errors/warnings and ten unverified results; Git status unchanged. [Real-project interpretation](REAL_WORLD_SCENARIOS.md).
- Dependency signatures: retained distribution audit verifies six dependency signatures and one dependency attestation; it does not verify candidate provenance. Final npm audit is time-specific, not a proof of no vulnerabilities.

## Tests not completed / not applicable

NOT TESTED: Linux/macOS, Node20/24, pnpm (broken host shim), remote Actions matrix/Gitleaks, npm 2FA/token scope, branch protection, new release provenance, long-duration leak/concurrency stress. Gitleaks/Semgrep/OSV were absent locally; no local scanner success is claimed. Configured workflow is reviewable but has not run or been pushed.

NOT APPLICABLE to implemented features: live login/token refresh, HTTP401/403/429 handling, tenant/API permissions, AppDB CRUD and DQL execution. Application browser/runtime behavior is NOT TESTED and cannot be inferred from offline findings.

Earlier verification found test-helper lint/type/format errors and insufficient full-source branch coverage. Those failures were corrected through code/test changes and rerun, without lowering the 90% thresholds. Retained first gate logs are in 'evidence/verification-attempt1/'; earlier coverage failures are summarized from execution output in [historical verification](evidence/historical-verification.json). Not every intermediate attempt retained a full log. Do not interpret historical failures as current successes or omit them from the audit history.
`,
);
