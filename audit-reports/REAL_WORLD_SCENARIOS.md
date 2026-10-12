# Real-world scenarios

All synthetic scenarios use disposable directories and fake identifiers. Commands, expected behavior, actual stdout/stderr and exit codes are retained in [QA results](evidence/qa/results.json). Reproduce with `node scripts/audit-validation.mjs` after building.

| Developer scenario                  | Setup / steps                                                                                  | Observed outcome                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| New user installs npm latest        | Isolated consumer installs public 0.1.0, executes CLI and imports package                      | VERIFIED FAILURE: installation succeeds but missing `dist` prevents use                            |
| New user installs candidate         | Pack local 0.1.1, fresh npm consumer, offline npm exec version/help, named ESM import and scan | VERIFIED PASS on Windows/Node22; final `pack:check` repeats exact artifact validation              |
| Upgrade/reinstall/remove            | Isolated prefix and consumer; upgrade 0.1.0 to candidate, reinstall, uninstall                 | VERIFIED PASS in [distribution findings](distribution-findings.md); user-global packages untouched |
| Yarn/pnpm consumer                  | Yarn1 isolated tarball install/version; inspect pnpm availability                              | Yarn VERIFIED PASS; pnpm NOT TESTED because host shim points to absent module                      |
| Unicode path and CI reports         | Project name includes spaces, accented and Chinese characters; terminal/JSON/SARIF             | VERIFIED PASS; structured reports parse; fake environment credential omitted                       |
| Healthy/broken manifest and aliases | Example fixtures and realistic null/shadowed/dynamic requests                                  | VERIFIED PASS assertions in analyzer suite; unsupported/runtime cases remain unverified            |
| Strict CI threshold                 | Unmapped literal alias; default vs `--severity warning`                                        | VERIFIED PASS: warning defaults to exit0, stricter threshold exit1                                 |
| Repeatable local diagnosis          | Three identical scans, remove timing fields, hash all input files                              | VERIFIED PASS: diagnostics/order stable and synthetic project hashes unchanged                     |
| Safe configuration/output           | Alternate config, init twice, new SARIF path, existing report/input collision                  | VERIFIED PASS: supported configuration, no clobbering, safe fresh writes                           |
| Hostile contributor files           | Throwing application code, fake `.env`, network/process traps, bounded fuzz inputs             | VERIFIED PASS within recorded cases; no application execution/network calls                        |
| Large checkout                      | 1,000 synthetic files / 50,000 lines                                                           | VERIFIED PASS; report stability and resource measurements in performance report                    |

## pod_demo validation

The corrected local CLI was run read-only against `D:\GWC\Projects\POCs\pod_demo`. The first default scan returned exit1 / DD-MAN-001 because this project stores its manifest under `public/manifest.json`, rather than the default project-root location. This is a configuration mismatch, not proof that its manifest is missing everywhere.

An audit-owned external config containing `{"manifest":"public/manifest.json"}` was then supplied:

```powershell
node dist/cli/index.js scan D:\GWC\Projects\POCs\pod_demo --config audit-reports/evidence/pod-demo.config.json --format json
```

VERIFIED PASS for offline execution: exit0, zero errors/warnings, four passed, three skipped and ten unverified diagnostics. [Result](evidence/pod-demo-configured-result.json), [report](evidence/pod-demo-configured-scan.json). Git status was unchanged before/after both scans. This verifies Git-visible state, not a complete hash of every ignored file; the independent synthetic hash checks supply the stronger immutability control. No files were edited in pod_demo and its application was not executed.

Ten unverified findings are work to review, not ten passing checks. Its collection declarations and runtime permissions are outside this release's validation. Live AppDB CRUD, Domo publication, browser behavior and actual dataset access remain NOT TESTED. Next validation should review these findings with the app owner, then test the packed candidate in an isolated pod_demo checkout and perform authorized live/browser checks separately.

Review of those ten results found one proxy-ID validity notice, three source-coverage notices for `index.html`, and six AppDB detection notices in application/test source. These indicate the tool's stated verification limits; no confirmed application defect follows from those notices alone. The offline scan cannot resolve proxy validity or collection permissions.

## Compatibility and usability limits

Only Windows/Node22 ran locally. OS/Node CI is configured, not completed. ESM named imports are supported; CommonJS `require` is not an exported entry point. Source analysis is conservative: uncertain bindings are unverified across the whole file; wrappers, renamed clients, Vue/Svelte bodies, encoded aliases and additional SQL/Files endpoint patterns need further precision work. HTML inline code and parse failures are explicitly disclosed. Direct datastore markers identify possible AppDB use without proving correctness. Legacy Domo documentation routes were inaccessible during direct retrieval, so current API dialect compatibility is not certified. No healthy offline report establishes deployment readiness.
