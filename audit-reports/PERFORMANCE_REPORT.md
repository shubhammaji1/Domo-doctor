# Performance report

Measured on Windows 10.0.26200 x64, Node v22.22.0, Intel Core i5-10210U (eight logical CPUs), 15.79 GiB installed RAM. Three repetitions per workload; 30-second child timeout and 512 MiB V8 old-space limit (not a total RSS cap). Inputs are fake healthy dataset requests, not customer data.

| Workload | Baseline median wall ms | Final median wall ms | Final median scan ms | Final median CPU ms | Final maximum peak RSS MiB | Result        |
| -------- | ----------------------- | -------------------- | -------------------- | ------------------- | -------------------------- | ------------- |
| help     | 4307.6                  | 1499.3               | N/A                  | 1749.0              | 83.5                       | VERIFIED PASS |
| small    | 4576.9                  | 1547.5               | 320.5                | 1812.0              | 95.5                       | VERIFIED PASS |
| medium   | 4939.5                  | 2196.9               | 928.2                | 3499.0              | 135.7                      | VERIFIED PASS |
| large    | 10931.4                 | 5345.2               | 4253.4               | 8859.0              | 244.9                      | VERIFIED PASS |

Workloads: small = 10 files × 50 lines (25,900 source bytes); medium = 100 × 100 (519,000 bytes); large = 1,000 × 50 (2,590,000 bytes). Help measures CLI startup/imports without a project scan. Wall includes startup, imports, scan and instrumentation; CPU is child user+system CPU. RSS is process peak resident memory; heap snapshots and full per-run metrics remain in JSON.

All three final reports for each scan workload were identical after removing timestamps/durations: {"small":true,"medium":true,"large":true}. Build SHA256 was unchanged throughout final runs: true; hash 60a6f814798509c312ecbca65e59b51545efcf88d060ff20d7a6d467ad4f8577. Inputs include saved hashes. Reproduce with 'node scripts/audit-benchmark.mjs final' after building; do not rebuild concurrently.

[Baseline measurements](evidence/performance/baseline.json), [final measurements](evidence/performance/final.json), [run output](evidence/final-benchmark.log). Baseline is the saved local candidate before the expanded fixes, not the unusable published release. The baseline ran amid heavier audit contention. Caches were not cleared, background activity was not controlled, and this is one machine: lower final wall times do not prove an optimization caused the difference. No cold-cache, macOS/Linux, multi-machine, long-running leak, concurrent scan or production load guarantee is claimed.

Observed bottlenecks/opportunities: CLI help eagerly imports the TypeScript/scanner dependency tree; larger projects retain parsed ASTs and show higher RSS. Profile lazy command imports and parse/storage lifetime before changing architecture. Bounds stop known excessive-size/depth cases, but synchronous parsers cannot be interrupted by Promise timeouts. Worker isolation can strengthen hard deadlines. Set performance budgets only after collecting less-contended cross-platform samples.
