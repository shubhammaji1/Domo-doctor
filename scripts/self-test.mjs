import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDoctor, runFixtureTests } from "../dist/index.js";
import { scanProject } from "../dist/core/scanner.js";
import { runRules, passesFailureThreshold } from "../dist/core/rule-engine.js";
import { createSarif } from "../dist/reporters/sarif.js";
import { runCli } from "../dist/cli/index.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tempRoot = await mkdtemp(
  path.join(await realpath(os.tmpdir()), "domo-doctor-self-test-"),
);
let assertions = 0;

function check(condition, message) {
  assert.ok(condition, message);
  assertions += 1;
}

async function writeProject(name, files) {
  const root = path.join(tempRoot, name);
  await mkdir(root, { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  return root;
}

async function captureCli(args) {
  const stdout = [];
  const stderr = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    stdout.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr.push(String(chunk));
    return true;
  };
  try {
    const status = await runCli([
      process.execPath,
      path.join(projectRoot, "dist", "cli", "index.js"),
      ...args,
    ]);
    return { status, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

try {
  const healthy = await createDoctor({
    root: path.join(projectRoot, "examples", "healthy-app"),
  }).scan();
  check(healthy.summary.errors === 0, "healthy example has no errors");
  check(
    healthy.diagnostics.find((item) => item.ruleId === "DD-MAN-004")?.status ===
      "passed",
    "healthy mapping alias rule passes",
  );

  const broken = await scanProject({
    root: path.join(projectRoot, "examples", "broken-app"),
  });
  for (const id of ["DD-MAN-004", "DD-MAN-005", "DD-MAN-006", "DD-MAP-001"]) {
    check(
      broken.diagnostics.some(
        (item) => item.ruleId === id && item.status === "failed",
      ),
      `${id} detected in broken example`,
    );
  }
  check(
    broken.diagnostics.some(
      (item) => item.ruleId === "DD-MAP-002" && item.status === "unverified",
    ),
    "dynamic path remains unverified",
  );
  check(
    broken.diagnostics.some(
      (item) => item.ruleId === "DD-APPDB-001" && item.status === "unverified",
    ),
    "AppDB remains unverified",
  );
  check(
    broken.diagnostics.find((item) => item.ruleId === "DD-MAN-005")
      ?.propertyPath === "mapping[0].fields[1].alias",
    "duplicate field has exact property path",
  );

  const validManifest = JSON.stringify({
    mapping: [{ alias: "sales", dataSetId: "fixture", fields: [] }],
  });
  const missingRoot = await writeProject("missing-manifest", {
    "app.js": "domo.get('/data/v1/sales')",
  });
  const missing = await scanProject({ root: missingRoot });
  check(
    missing.diagnostics.find((item) => item.ruleId === "DD-MAN-001")?.status ===
      "failed",
    "missing manifest is an error",
  );
  check(
    missing.diagnostics.find((item) => item.ruleId === "DD-MAN-002")?.status ===
      "skipped",
    "missing manifest JSON check is skipped",
  );

  const invalidRoot = await writeProject("invalid-json", {
    "manifest.json": '{\n  "name": "bad",\n  "mapping": [\n}',
  });
  const invalid = await scanProject({ root: invalidRoot });
  const jsonIssue = invalid.diagnostics.find(
    (item) => item.ruleId === "DD-MAN-002",
  );
  check(
    jsonIssue?.status === "failed" &&
      jsonIssue.line === 4 &&
      Boolean(jsonIssue.column),
    "invalid JSON reports parser line and column",
  );

  const nonObject = await writeProject("non-object", { "manifest.json": "[]" });
  check(
    (await scanProject({ root: nonObject })).diagnostics.some(
      (item) => item.ruleId === "DD-MAN-003" && item.status === "failed",
    ),
    "non-object JSON root is rejected",
  );

  const sourceRoot = await writeProject("source-check", {
    "manifest.json": validManifest,
    "src/app.tsx":
      'domo.get("/data/v1/password=supersecret");\ndomo.get(makePath());\nconst appdb = "AppDB";',
  });
  const sourceReport = await scanProject({ root: sourceRoot });
  check(
    sourceReport.diagnostics.some(
      (item) => item.ruleId === "DD-MAP-001" && item.status === "failed",
    ),
    "unknown static source alias is detected",
  );
  check(
    sourceReport.diagnostics.some(
      (item) => item.ruleId === "DD-MAP-002" && item.status === "unverified",
    ),
    "dynamic source path is unverified",
  );
  check(
    sourceReport.diagnostics.some(
      (item) => item.ruleId === "DD-APPDB-001" && item.status === "unverified",
    ),
    "AppDB marker is not claimed validated",
  );
  check(
    !JSON.stringify(sourceReport).includes("supersecret"),
    "secret-looking source path is redacted",
  );

  const cfgRoot = await writeProject("suppression", {
    "manifest.json": JSON.stringify({
      mapping: [
        { alias: "x", dataSetId: "one", fields: [] },
        { alias: "x", dataSetId: "two", fields: [] },
      ],
    }),
    "domo-doctor.config.json": JSON.stringify({
      suppressions: [
        {
          ruleId: "DD-MAN-004",
          file: "manifest.json",
          reason: "Reviewed legacy mapping.",
        },
      ],
    }),
  });
  const suppressed = await scanProject({ root: cfgRoot });
  check(
    suppressed.summary.suppressed === 1,
    "suppressed diagnostics remain reported and counted",
  );
  check(
    !passesFailureThreshold(suppressed.diagnostics, "error"),
    "suppressed finding does not fail threshold",
  );

  const traversalRoot = await writeProject("unsafe-config", {
    "manifest.json": validManifest,
    "domo-doctor.config.json": JSON.stringify({ manifest: "../outside.json" }),
  });
  await assert.rejects(
    scanProject({ root: traversalRoot }),
    /inside the project root/,
  );
  assertions += 1;

  const engineConfig = {
    root: ".",
    manifest: "manifest.json",
    rules: {},
    ignore: [],
    reporter: "terminal",
    failOn: "error",
    suppressions: [],
    ruleTimeoutMs: 15,
  };
  const engineContext = {
    root: ".",
    manifestPath: "manifest.json",
    files: [],
    sourceFiles: [],
    sourceFilesSkipped: [],
    config: engineConfig,
  };
  const rules = [
    {
      id: "DD-SELF-001",
      description: "throws",
      category: "manifest",
      run: () => {
        throw new Error("password=hidden");
      },
    },
    {
      id: "DD-SELF-002",
      description: "times out",
      category: "manifest",
      timeoutMs: 3,
      run: () => new Promise(() => {}),
    },
  ];
  const engineResult = await runRules(rules, engineContext);
  check(
    engineResult.diagnostics.some(
      (item) => item.message === "Diagnostic rule failed unexpectedly.",
    ),
    "rule exceptions are isolated",
  );
  check(
    engineResult.diagnostics.some(
      (item) => item.message === "Diagnostic rule timed out.",
    ),
    "rule timeout is surfaced",
  );

  const sarif = createSarif(broken);
  check(sarif.version === "2.1.0", "SARIF version is correct");
  check(sarif.runs[0]?.results.length > 0, "SARIF contains findings");
  check(
    sarif.runs[0]?.results.some((result) => result.kind === "review"),
    "SARIF unverified results are marked for review",
  );
  const fixtureReport = await runFixtureTests("examples", projectRoot);
  check(
    fixtureReport.total === 2 && fixtureReport.failed === 0,
    "healthy and broken fixture expectations pass",
  );

  const healthyCli = await captureCli([
    "scan",
    path.join(projectRoot, "examples", "healthy-app"),
    "--format",
    "json",
  ]);
  check(
    healthyCli.status === 0 &&
      JSON.parse(healthyCli.stdout).schemaVersion === "1.0.0",
    "CLI healthy scan emits JSON and exits zero",
  );
  const brokenCli = await captureCli([
    "scan",
    path.join(projectRoot, "examples", "broken-app"),
    "--no-color",
  ]);
  check(
    brokenCli.status === 1 && brokenCli.stdout.includes("DD-MAN-004"),
    "CLI broken scan exits one and prints rule ID",
  );
  const invalidCli = await captureCli(["scan", "--format", "invalid"]);
  check(invalidCli.status === 2, "CLI invalid arguments exit two");
  const fixtureCli = await captureCli([
    "test",
    path.join(projectRoot, "examples"),
  ]);
  check(
    fixtureCli.status === 0 && fixtureCli.stdout.includes("2 passed"),
    "CLI fixture test command exits zero",
  );

  process.stdout.write(`Self-test passed (${assertions} assertions).\n`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
