# CI follow-up — 12 October 2026

PR [#1](https://github.com/shubhammaji1/Domo-doctor/pull/1), head `70770fca12393075c57a7e2b01c769c4a66a04a9`, ran both push and pull-request workflows. Each run had one failed Ubuntu verification job and eight cancelled matrix jobs. The secret-scanning jobs completed successfully. Cancellation is not evidence of a platform failure or pass.

## Confirmed failure

- [Ubuntu Node22 / pull request](https://github.com/shubhammaji1/Domo-doctor/actions/runs/38233370097/job/114757982335).
- [Ubuntu Node24 / push](https://github.com/shubhammaji1/Domo-doctor/actions/runs/38233305476/job/114757770953).

Both failed at `npm run pack:check`, `scripts/package-smoke.mjs:73`: installed `npm exec --offline -- domo-doctor --version` exited successfully but stdout was empty instead of `0.1.1`. Both jobs had already passed install, typecheck, lint, self-tests, all 69 regression tests, coverage, formatting and build. The following production audit step was skipped in those jobs.

Root cause: `src/cli/index.ts` detected direct execution using a lexical comparison between `process.argv[1]` and `import.meta.url`. Unix npm bin commands use a symlink; Node resolves the module path, while the launch argument names the link. The comparison failed, so the CLI never called `runCli`.

## Local fix and validation

The startup guard now resolves the launch path with `realpathSync` before comparing it to the module path. A regression launches the built CLI through a symlink/junction and requires a successful exit, correct version, and empty stderr. CI now uses `fail-fast: false` so one failure does not cancel the remaining compatibility checks; every job still must pass its checks.

Local Windows/Node22 validation: 70/70 regression tests passed. Full-source coverage: 95.55% statements, 90.83% branches, 97.88% functions, 96.15% lines. [Coverage log](evidence/ci-symlink-coverage.log). Typecheck and lint passed; packed CLI/library smoke check passed. The changed code has not yet been verified by a new Linux/macOS CI run.

This updates the earlier audit's evidence: remote secret scans are now observed successful for the original PR commit, and Ubuntu's tests/coverage are verified there. General compatibility and the fixed Unix packed entry point still require the next full matrix run. The earlier audit reports describe the pre-CI assessment and must be read with this follow-up.

Next action: commit and push this local patch to the existing PR branch, then wait for all nine verification jobs and the secret scan to pass. Do not merge or publish based on cancelled checks. No push, merge or npm publication was performed during this repair.
