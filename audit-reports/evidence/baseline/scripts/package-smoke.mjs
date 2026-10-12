import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), "domo-doctor-package-"));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run this check through npm run pack:check.");

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  const output = run(
    process.execPath,
    [npmCli, "pack", "--json", "--pack-destination", temporary],
    repository,
  );
  const packed = JSON.parse(output.slice(output.indexOf("[")))[0];
  for (const required of [
    "dist/cli/index.js",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    assert.ok(
      packed.files.some((file) => file.path === required),
      `Missing ${required}`,
    );
  }
  assert.ok(
    packed.files.every(
      (file) => !/^(?:src|tests|work|node_modules)\//.test(file.path),
    ),
  );
  const consumer = path.join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(
    path.join(consumer, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  run(
    process.execPath,
    [
      npmCli,
      "install",
      path.join(temporary, packed.filename),
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ],
    consumer,
  );
  const installed = path.join(consumer, "node_modules", "domo-doctor");
  const cli = path.join(installed, "dist", "cli", "index.js");
  assert.ok((await readFile(cli, "utf8")).startsWith("#!/usr/bin/env node\n"));
  const version = run(
    process.execPath,
    [npmCli, "exec", "--offline", "--", "domo-doctor", "--version"],
    consumer,
  ).trim();
  assert.equal(version, packed.version);
  const project = path.join(temporary, "project");
  await mkdir(project);
  await writeFile(
    path.join(project, "manifest.json"),
    '{"name":"Smoke test","mapping":[]}',
  );
  const report = JSON.parse(
    run(process.execPath, [cli, "scan", project, "--format", "json"], consumer),
  );
  assert.equal(report.summary.errors, 0);
  const { createDoctor } = await import(
    pathToFileURL(path.join(installed, "dist", "index.js")).href
  );
  assert.equal(
    (await createDoctor({ root: project }).scan()).summary.errors,
    0,
  );
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { createDoctor } from "domo-doctor"; if (typeof createDoctor !== "function") process.exit(1);',
    ],
    consumer,
  );
  console.log(
    `Package smoke test passed: domo-doctor@${packed.version}, ${packed.files.length} files, CLI and library verified.`,
  );
} finally {
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith("domo-doctor-package-"));
  await rm(temporary, { recursive: true, force: true });
}
