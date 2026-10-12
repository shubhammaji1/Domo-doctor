import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const evidence = path.join(root, "audit-reports", "evidence", "qa");
await mkdir(evidence, { recursive: true });
const temporaryBase = await realpath(os.tmpdir());
const temporary = await mkdtemp(path.join(temporaryBase, "domo-doctor-audit-"));
const cli = path.join(root, "dist", "cli", "index.js");
const results = [];
function execute(args, cwd = root) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    command: [process.execPath, cli, ...args],
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
    elapsedMs: performance.now() - start,
  };
}
async function test(name, expected, action) {
  try {
    const actual = await action();
    results.push({ name, expected, result: "VERIFIED PASS", actual });
  } catch (error) {
    results.push({
      name,
      expected,
      result: "VERIFIED FAILURE",
      actual: String(error),
      stack: error.stack,
    });
  }
}
async function hashes(directory) {
  const values = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory())
      Object.assign(
        values,
        Object.fromEntries(
          Object.entries(await hashes(full)).map(([name, hash]) => [
            entry.name + "/" + name,
            hash,
          ]),
        ),
      );
    else if (entry.isFile())
      values[entry.name] = createHash("sha256")
        .update(await readFile(full))
        .digest("hex");
  }
  return values;
}
try {
  const project = path.join(temporary, "Domo demo café 数据");
  await mkdir(project);
  await writeFile(
    path.join(project, "manifest.json"),
    JSON.stringify({
      name: "Synthetic app",
      mapping: [{ alias: "sales", dataSetId: "fake-id", fields: [] }],
    }),
  );
  await writeFile(path.join(project, "app.ts"), 'domo.get("/data/v1/sales");');
  await writeFile(
    path.join(project, ".env"),
    "DOMO_TOKEN=SYNTHETIC_ENV_SECRET_DO_NOT_USE",
  );
  for (const args of [
    ["--help"],
    ["--version"],
    ["rules", "list"],
    ["explain", "DD-MAN-005"],
    ["scan", "--help"],
    ["check", "--help"],
    ["test", "--help"],
    ["init", "--help"],
  ]) {
    await test(args.join(" "), "exit 0 and nonempty stdout", () => {
      const result = execute(args);
      assert.equal(result.status, 0);
      assert.ok(result.stdout.length);
      return result;
    });
  }
  for (const args of [
    ["explain", "DD-UNKNOWN"],
    ["check", "unknown", project],
    ["scan", project, "--format", "bad"],
    ["scan", project, "--severity", "bad"],
    ["scan", project, "--config", "missing.json"],
    ["not-a-command"],
    ["test", project],
  ]) {
    await test(
      args.slice(0, 2).join(" "),
      "exit 2 with useful stderr and no stack trace",
      () => {
        const result = execute(args);
        assert.equal(result.status, 2);
        assert.ok(result.stderr.length);
        assert.ok(!result.stderr.includes("at async"));
        return result;
      },
    );
  }
  const before = await hashes(project);
  for (const format of ["terminal", "json", "sarif"]) {
    await test(
      `Unicode project ${format}`,
      "successful scan with no synthetic environment secret",
      () => {
        const result = execute([
          "scan",
          project,
          "--format",
          format,
          "--verbose",
          "--no-color",
        ]);
        assert.equal(result.status, 0);
        assert.ok(!result.stdout.includes("SYNTHETIC_ENV_SECRET"));
        if (format !== "terminal") {
          const parsed = JSON.parse(result.stdout);
          assert.equal(
            format === "sarif" ? parsed.version : parsed.schemaVersion,
            format === "sarif" ? "2.1.0" : "1.0.0",
          );
        }
        return result;
      },
    );
  }
  for (const target of ["manifest", "mappings", "appdb", "proxy"]) {
    await test(`check ${target}`, "exit 0; selected categories only", () => {
      const result = execute(["check", target, project, "--format", "json"]);
      assert.equal(result.status, 0);
      const report = JSON.parse(result.stdout);
      assert.ok(report.rules.length > 0);
      return result;
    });
  }
  await test(
    "repeatability and scan immutability",
    "three reports agree apart from timing; every project file hash unchanged",
    async () => {
      const reports = Array.from({ length: 3 }, () => {
        const r = execute(["scan", project, "--format", "json"]);
        assert.equal(r.status, 0);
        const report = JSON.parse(r.stdout);
        return {
          diagnostics: report.diagnostics,
          summary: report.summary,
          rules: report.rules.map((rule) => {
            const copy = { ...rule };
            delete copy.durationMs;
            return copy;
          }),
        };
      });
      assert.deepEqual(reports[0], reports[1]);
      assert.deepEqual(reports[1], reports[2]);
      assert.deepEqual(await hashes(project), before);
      return { repetitions: 3, hashes: before };
    },
  );
  await writeFile(
    path.join(project, "app.ts"),
    'domo.get("/data/v1/missing");',
  );
  await test(
    "severity threshold",
    "unmapped alias warning exits 0 by default and 1 for --severity warning",
    () => {
      const normal = execute(["scan", project, "--format", "json"]);
      const strict = execute([
        "scan",
        project,
        "--severity",
        "warning",
        "--format",
        "json",
      ]);
      assert.equal(normal.status, 0);
      assert.equal(strict.status, 1);
      return { normal, strict };
    },
  );
  await writeFile(path.join(project, "app.ts"), 'domo.get("/data/v1/sales");');
  await test(
    "init and no overwrite",
    "first init succeeds; second exits 2; contents unchanged",
    async () => {
      const first = execute(["init", project]);
      assert.equal(first.status, 0);
      const initial = await readFile(
        path.join(project, "domo-doctor.config.json"),
        "utf8",
      );
      const second = execute(["init", project]);
      assert.equal(second.status, 2);
      assert.equal(
        await readFile(path.join(project, "domo-doctor.config.json"), "utf8"),
        initial,
      );
      return { first, second };
    },
  );
  await test(
    "explicit report writes",
    "valid SARIF is written to requested disposable path",
    async () => {
      const output = path.join(temporary, "doctor.sarif");
      const result = execute([
        "scan",
        project,
        "--format",
        "sarif",
        "--output",
        output,
      ]);
      assert.equal(result.status, 0);
      assert.equal(JSON.parse(await readFile(output, "utf8")).version, "2.1.0");
      return result;
    },
  );
  await test(
    "project code is never executed and scans use no network",
    "network call traps remain unused; source side-effect sentinel absent",
    async () => {
      const sentinel = path.join(project, "executed.txt");
      await writeFile(
        path.join(project, "app.ts"),
        `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(sentinel)}, 'executed'); fetch('https://synthetic.invalid'); domo.get('/data/v1/sales');`,
      );
      const program = `import http from 'node:http'; import https from 'node:https'; import net from 'node:net'; import tls from 'node:tls'; import dns from 'node:dns'; import {syncBuiltinESMExports} from 'node:module'; let attempts=0; const trap=()=>{attempts++; throw new Error('NETWORK_FORBIDDEN');}; http.request=trap; http.get=trap; https.request=trap; https.get=trap; net.connect=trap; net.createConnection=trap; tls.connect=trap; dns.lookup=trap; globalThis.fetch=trap; syncBuiltinESMExports(); const {scanProject}=await import(${JSON.stringify(pathToFileURL(path.join(root, "dist/core/scanner.js")).href)}); await scanProject({root:${JSON.stringify(project)}}); console.log(JSON.stringify({attempts}));`;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", program],
        { encoding: "utf8", timeout: 30_000 },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).attempts, 0);
      assert.ok(!(await readdir(project)).includes("executed.txt"));
      return { status: result.status, stdout: result.stdout };
    },
  );
  await test(
    "alternate config",
    "explicit config selects JSON and only overrides selected rules",
    async () => {
      const config = path.join(project, "alternate.json");
      await writeFile(
        config,
        JSON.stringify({ reporter: "json", rules: { "DD-PROXY-001": "off" } }),
      );
      const result = execute(["scan", project, "--config", config]);
      assert.equal(result.status, 0);
      assert.equal(
        JSON.parse(result.stdout).diagnostics.find(
          (d) => d.ruleId === "DD-PROXY-001",
        ).status,
        "skipped",
      );
      return result;
    },
  );
  await test(
    "simple deterministic schema fuzz",
    "100 synthetic malformed JSON shapes yield reports or controlled errors within 30 seconds",
    async () => {
      const program = `import {writeFile} from 'node:fs/promises'; import {scanProject} from ${JSON.stringify(pathToFileURL(path.join(root, "dist/core/scanner.js")).href)}; const values=[null,[],{},true,42,'x',{mapping:[null]},{mapping:[{},null,42]},{size:{width:-1},ignore:42},{mapping:[{alias:'__proto__',dataSetId:'fake',fields:[]}]}]; let reports=0,errors=0; for(let i=0;i<100;i++){ await writeFile(${JSON.stringify(path.join(project, "manifest.json"))},JSON.stringify(values[i%values.length])); try{await scanProject({root:${JSON.stringify(project)}});reports++;}catch{errors++;} } console.log(JSON.stringify({reports,errors,polluted:({}).polluted??false}));`;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", program],
        { encoding: "utf8", timeout: 30_000 },
      );
      assert.equal(result.status, 0, result.stderr);
      const counts = JSON.parse(result.stdout);
      assert.equal(counts.reports + counts.errors, 100);
      assert.equal(counts.polluted, false);
      return counts;
    },
  );
} finally {
  assert.equal(path.dirname(temporary), temporaryBase);
  await rm(temporary, { recursive: true, force: true });
  await writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify(
      {
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
        },
        results,
      },
      null,
      2,
    ) + "\n",
  );
}
const failures = results.filter(
  (result) => result.result === "VERIFIED FAILURE",
);
console.log(
  JSON.stringify({
    cases: results.length,
    passed: results.length - failures.length,
    failures: failures.map((f) => ({ name: f.name, actual: f.actual })),
  }),
);
if (failures.length) process.exitCode = 1;
