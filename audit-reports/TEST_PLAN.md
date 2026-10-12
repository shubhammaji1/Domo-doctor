# Audit plan — 12 October 2026

Scope: the npm release retrieved during this audit and the local 0.1.1 candidate. Starting commit: `dcd9d816766f4020d11b4e8adca93354f494fd78`, with the preceding fixes preserved as uncommitted changes on `codex/production-audit-20261012`.

1. Preserve source and configuration hashes before additional fixes.
2. Independently inspect published metadata, tarball contents, dependency lifecycle scripts, local/global-prefix installation, CLI execution, library exports, and uninstall/reinstall behavior.
3. Exercise implemented commands: scan, focused checks, fixture tests, init, rules list, explain, help and version. Check exit codes, JSON/SARIF, severity, suppressions, config precedence and invalid arguments.
4. Use synthetic hostile files for traversal, junctions, oversized inputs, malformed schemas, secret redaction, terminal controls, regex/parser resource limits and explicit output writes.
5. Verify direct dataset rules against official Domo documentation and distinguish unsupported wrappers and live platform validation from confirmed diagnostics.
6. Run existing checks, meaningful regression tests, coverage, dependency auditing, secret checks and packed-artifact checks. Retain command stdout, stderr, exit status and expected results.
7. Benchmark startup, scan wall time, process CPU and peak RSS on synthetic small/medium/large workloads with bounded child processes. Compare repeated scans after removing timestamps and duration fields.
8. Treat live Domo authentication, permissions, HTTP responses and customer-data mutation as NOT APPLICABLE to the offline implementation; do not invent mocks of APIs the product does not call. Record unavailable OS/runtime/tools as NOT TESTED.
9. Document findings before targeted fixes, then retain both before and after evidence. Generate all six requested reports. No publish, push, or real Domo API operation is authorized by this audit.

Evidence labels: VERIFIED PASS, VERIFIED FAILURE, PARTIALLY TESTED, NOT TESTED, NOT APPLICABLE. Coverage numbers describe only the files instrumented, and readiness scores cannot override release blockers.
