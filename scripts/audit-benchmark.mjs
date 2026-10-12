import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = fileURLToPath(new URL("..", import.meta.url));
const marker = "DOMO_BENCH_METRICS=";
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !["startedAt", "durationMs"].includes(key))
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}
const digest = (value) => createHash("sha256").update(value).digest("hex");

if (process.argv[2] === "--worker") {
  const kind = process.argv[3];
  let details = {};
  process.on("exit", () => {
    process.stderr.write(
      `${marker}${JSON.stringify({
        ...details,
        cpuUsageMicroseconds: process.cpuUsage(),
        resourceUsage: process.resourceUsage(),
        memoryUsageBytes: process.memoryUsage(),
      })}\n`,
    );
  });
  if (kind === "help") {
    const cli = path.join(repository, "dist/cli/index.js");
    process.argv = [process.execPath, cli, "--help"];
    await import(pathToFileURL(cli).href);
  } else {
    const { createDoctor } = await import(
      pathToFileURL(path.join(repository, "dist/index.js")).href
    );
    const cpuBefore = process.cpuUsage();
    const scanStart = performance.now();
    const report = await createDoctor({ root: process.argv[4] }).scan();
    details = {
      scanMs: performance.now() - scanStart,
      reportedScanMs: report.scan.durationMs,
      scanCpuUsageMicroseconds: process.cpuUsage(cpuBefore),
      summary: report.summary,
      stableReportSha256: digest(JSON.stringify(stable(report))),
    };
    process.stdout.write(`${JSON.stringify(details)}\n`);
  }
} else {
  const label = process.argv[2] ?? "baseline";
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid benchmark label.");
  const evidence = path.join(repository, "audit-reports/evidence/performance");
  const fixtures = path.join(evidence, "fixtures");
  await mkdir(fixtures, { recursive: true });
  const workloads = [
    { name: "small", files: 10, linesPerFile: 50 },
    { name: "medium", files: 100, linesPerFile: 100 },
    { name: "large", files: 1000, linesPerFile: 50 },
  ];
  for (const workload of workloads) {
    workload.root = path.join(fixtures, workload.name);
    await mkdir(workload.root, { recursive: true });
    const manifest = JSON.stringify({
      name: "Benchmark fixture",
      version: "1.0.0",
      fullpage: true,
      size: { width: 2, height: 2 },
      mapping: [
        {
          alias: "sales",
          dataSetId: "5168da8d-1c72-4e31-ba74-f609f73071dd",
          fields: [],
        },
      ],
    });
    await writeFile(path.join(workload.root, "manifest.json"), manifest);
    const inputHash = createHash("sha256").update(manifest);
    workload.sourceBytes = 0;
    for (let i = 0; i < workload.files; i++) {
      const name = `source-${String(i).padStart(4, "0")}.js`;
      const text =
        Array.from(
          { length: workload.linesPerFile },
          (_, line) =>
            `const request${line} = () => domo.get("/data/v1/sales");`,
        ).join("\n") + "\n";
      await writeFile(path.join(workload.root, name), text);
      workload.sourceBytes += Buffer.byteLength(text);
      inputHash.update(name).update(text);
    }
    workload.inputSha256 = inputHash.digest("hex");
  }
  async function hashBuild(dir) {
    const hash = createHash("sha256");
    async function visit(current, relative = "") {
      for (const entry of (
        await readdir(current, { withFileTypes: true })
      ).sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = path.posix.join(relative, entry.name);
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) await visit(absolute, rel);
        else hash.update(rel).update(await readFile(absolute));
      }
    }
    await visit(dir);
    return hash.digest("hex");
  }
  const buildBefore = await hashBuild(path.join(repository, "dist"));
  const runs = [];
  for (const workload of [{ name: "help" }, ...workloads]) {
    for (let repetition = 1; repetition <= 3; repetition++) {
      const start = performance.now();
      const child = spawnSync(
        process.execPath,
        [
          "--max-old-space-size=512",
          fileURLToPath(import.meta.url),
          "--worker",
          workload.name,
          ...(workload.root ? [workload.root] : []),
        ],
        {
          cwd: repository,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      const metrics = child.stderr
        ?.split(/\r?\n/)
        .find((line) => line.startsWith(marker));
      const run = {
        workload: workload.name,
        repetition,
        wallMs: performance.now() - start,
        exitCode: child.status,
        signal: child.signal,
        error: child.error?.message,
        ...(metrics ? JSON.parse(metrics.slice(marker.length)) : {}),
        stderr: child.stderr
          ?.split(/\r?\n/)
          .filter((line) => !line.startsWith(marker))
          .join("\n"),
      };
      runs.push(run);
      console.log(
        `${label} ${workload.name} rep${repetition}: wall=${run.wallMs.toFixed(1)}ms scan=${run.scanMs?.toFixed(1) ?? "n/a"}ms RSS=${run.resourceUsage?.maxRSS ?? "n/a"}KiB exit=${run.exitCode}`,
      );
    }
  }
  const buildAfter = await hashBuild(path.join(repository, "dist"));
  const result = {
    label,
    capturedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      cpuModel: os.cpus()[0]?.model,
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      availableMemoryAtEndBytes: os.freemem(),
    },
    settings: { repetitions: 3, childTimeoutMs: 30_000, maxOldSpaceMiB: 512 },
    limitations: [
      "Parent wall includes child Node startup, imports, scan, and instrumentation.",
      "maxRSS is the child process peak resident set size in KiB, not heap allocation; memoryUsage heap values are end snapshots.",
      "512 MiB flag limits V8 old space, not total process RSS.",
      "Workloads use healthy static dataset references and synthetic source, not arbitrary production workloads.",
      "Filesystem and OS caches were not cleared; this is not a guaranteed cold-cache measurement.",
      "Other audit activity and background processes may contend for CPU, storage, and memory.",
      "Report stability hashes omit startedAt and all durationMs fields but retain diagnostic order and content.",
    ],
    buildBeforeSha256: buildBefore,
    buildAfterSha256: buildAfter,
    buildUnchangedDuringRuns: buildBefore === buildAfter,
    workloads,
    runs,
    stableReports: Object.fromEntries(
      workloads.map((workload) => {
        const hashes = runs
          .filter((run) => run.workload === workload.name)
          .map((run) => run.stableReportSha256);
        return [
          workload.name,
          hashes.every(Boolean) && new Set(hashes).size === 1,
        ];
      }),
    ),
  };
  await writeFile(
    path.join(evidence, `${label}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  if (
    runs.some((run) => run.exitCode !== 0) ||
    !result.buildUnchangedDuringRuns
  )
    process.exitCode = 1;
}
