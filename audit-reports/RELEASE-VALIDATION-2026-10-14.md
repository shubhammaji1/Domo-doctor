# Release validation — 14 October 2026

## Decision

**domo-doctor 0.1.3: suitable for release to developers for its documented offline diagnostic scope.** The npm release is already public. No package code change or new publish was needed during this validation.

**POD_DEMO: local workflows pass, but production sign-off is pending.** Browser-side scoping and mutation guards do not enforce access against direct AppDB calls. Real Domo identity, document permissions, branch isolation, proxy configuration, and deployed collection access must be validated in a disposable staging app before introducing real users or customer records. This review did not modify a Domo deployment or any live AppDB records.

## Published artifact

- npm registry `latest`: **0.1.3**; local source version and POD_DEMO installed version: **0.1.3**.
- Downloaded the actual registry tarball, installed it in a separate consumer directory with installation scripts disabled, and verified its SHA-512 against registry metadata.
- Integrity: `sha512-VmoUJyC3c8isXlEdtuWiTuPKmxoFZ7aePEvhkGTDE3DJJhyelFGMUMzZf6ZJcLTnSY3suIFF2w6k+zP0cLIUrA==`.
- Tarball contains 73 files: runtime/declaration files and maps, package metadata, README, LICENSE, SECURITY, and CONTRIBUTING. No project environment files, test fixtures, work directories, or credentials were included in the package file list.
- No `preinstall`, `install`, `postinstall`, or `prepare` lifecycle hooks in the published manifest.
- All **17 published JavaScript runtime files exactly match the local rebuilt runtime**.
- Fresh consumer npm-exec invocation using a new cache returns `0.1.3`.
- Global-style installation using an isolated prefix produces a working Windows command shim returning `0.1.3`; the user's actual global installation was not changed.
- Running npm-exec inside the package's own source repository initially selected its local package context and could not locate a command shim. The same registry invocation succeeded in a clean consumer directory. Keep consumer distribution tests outside the package's own root.
- Registry metadata did not return a `dist.attestations` entry. Provenance publishing is a future supply-chain improvement; it was not verified for this release.

## Automated verification

| Check                                                                 | Result                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| domo-doctor typecheck and lint                                        | Pass                                                                  |
| domo-doctor self-test                                                 | 30 assertions pass                                                    |
| domo-doctor Vitest                                                    | 136 tests pass across 13 files                                        |
| Coverage                                                              | 96.66% lines, 92.63% branches                                         |
| Formatting                                                            | Pass                                                                  |
| Package smoke check                                                   | CLI, manifest discovery, AppDB static checks, ESM library import pass |
| Independent published-artifact checks                                 | 22 checks pass                                                        |
| Full domo-doctor dependency audit, including development dependencies | 0 reported vulnerabilities                                            |
| POD_DEMO lint/build                                                   | Pass                                                                  |
| POD_DEMO regression suite                                             | 35 tests pass                                                         |
| POD_DEMO production dependency audit                                  | 0 reported vulnerabilities                                            |
| GitHub main CI                                                        | 9 OS/Node combinations and secrets job pass                           |

GitHub CI evidence: [successful main run](https://github.com/shubhammaji1/Domo-doctor/actions/runs/38380265113), commit `6f6c08fcde56aa76dd5ecfd631a03144889a2842`. The matrix covers Windows, Ubuntu, and macOS with Node 20, 22, and 24. This is source CI evidence; the downloaded npm artifact was independently exercised locally on Windows/Node 22.22.0.

The first restricted test attempt failed when resolving the sandbox temporary directory. The full release gate passed when rerun with normal temporary-directory access. The first restricted dependency-audit request could not resolve the registry; the network-enabled retry completed successfully. These were execution-environment failures, not failing product assertions.

POD_DEMO build retains two warnings: its classic Domo SDK script is not bundled as an ES module, and its main JavaScript bundle exceeds the 500 kB warning threshold. Neither prevented the build. Bundle-size work remains an optimization opportunity.

## Independent published CLI checks

Tests use only isolated synthetic projects, except the read-only POD_DEMO scan:

- Version/help/rule list/explanations.
- Automatic `public/manifest.json` discovery without a custom config.
- Valid local AppDB declaration plus honest live-access `unverified` result.
- Missing and invalid manifests return exit 1.
- Unknown dataset aliases and undeclared AppDB collections fail the warning threshold.
- Dynamic data requests remain unverified.
- Project JavaScript containing a thrown error is parsed without executing it.
- All four focused checks: manifest, mappings, appdb, proxy.
- Parseable JSON and SARIF 2.1.0; plain terminal output contains no ANSI color codes.
- Invalid arguments return exit 2.
- Repository fixture examples pass using the published CLI.
- Config initialization refuses to overwrite an existing file.
- Synthetic environment-file content is excluded from scan output.
- Published ESM library API imports and scans successfully.
- POD_DEMO source/public hashes are unchanged after scanning.

The full source regression suite also passed its existing adversarial, path-containment, privacy, configuration, source-analysis, and reporting cases. These tests and a clean dependency audit are supporting evidence, not proof that every possible security issue is absent.

## POD_DEMO scan

The fresh npm installation correctly discovers `public/manifest.json`:

| Errors | Warnings | Passed | Skipped | Unverified |
| ------ | -------- | ------ | ------- | ---------- |
| 0      | 0        | 6      | 4       | 2          |

The two unverified checks are **live AppDB access** and **proxy-ID validity**. They remain deliberately unverified because an offline scanner cannot establish deployed existence, identity, permissions, or runtime request correctness. They do not make the scanner broken, and passing static checks is not deployment certification.

## Browser end-to-end rehearsal

Executed against the existing local `?demo=1` workspace, preserving its earlier sample data:

| Workflow                              | Observed result                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Admin uses searchable assignee picker | Searching Avery shows name, email, and Team member role                                                     |
| Assignment creation                   | `Release QA 2026-10-14` created for Avery Shah                                                              |
| Member access                         | Assignment appears on Avery's personal desk; admin management navigation absent                             |
| Status changes                        | Not started → In progress → Complete                                                                        |
| Completion history                    | Test assignment appears in member Completed view                                                            |
| Daily update                          | Member submits a dated check-in with an unresolved synthetic blocker                                        |
| Head dashboard                        | Riley Chen sees Avery checked in, the completed assignment reflected in workload, and the new blocker       |
| Head drill-down                       | Avery's check-in opens with the correct member filter                                                       |
| Escalation                            | Head follow-up escalates to Alex Morgan; Alex's inbox shows one escalation                                  |
| Other lead                            | Jordan Lee's dashboard shows no escalation from this test and only his own heads                            |
| Resolution                            | Alex resolves the blocker; it disappears from the open-filtered report and escalation inbox                 |
| Admin dual role                       | Admin retains management controls and My lead overview after reload                                         |
| Persistence                           | Admin sees 45 total/15 completed assignments and Avery's Solved check-in after reload                       |
| Admin search                          | Work queue search returns the single test assignment, owner Avery, status Complete                          |
| CSV download confirmation             | Inconclusive: browser download-event confirmation stalled; no successful downloaded-file validation claimed |

One completed assignment and one resolved check-in were retained as clearly labeled release-QA sample evidence. No real users were contacted. No live Domo data was created, changed, or deleted.

Earlier checks in this same work session verified keyboard assignee selection, name/email/role filtering, empty search state, distinct Lead/Head layouts, attendance expansion, and desktop/narrow-screen table layout. They were not all repeated in this run. Other regression tests cover mock/AppDB-adapter mutations, authorization guards, member identity changes and rollback, hierarchy, pagination, and demo-mode isolation; mocked AppDB is not a live Domo integration test.

## Fix made during validation

POD_DEMO README referenced `npm run dev:demo`, which does not exist in the current package scripts. It now documents `npm run dev:appdb` and `http://127.0.0.1:5175/?demo=1`, and explicitly describes its permissions as client-side checks.

## Next release requirements

For **domo-doctor**, users can use published 0.1.3 now for offline diagnostics, with the documented limits. Recommend a small developer pilot and collect reproducible projects for unsupported layouts/wrappers. No additional npm publish is required for the tested package.

For **POD_DEMO**, complete these before production approval:

1. Use a separate staging Domo app and disposable records. Verify the installed app uses the intended collection mappings and proxy.
2. Verify Admin, admin-plus-lead, Lead, Head, and Member using actual separate Domo identities.
3. Verify server-side read/write denial for out-of-branch reads, non-admin people/assignment creation, and editing another person's work/check-ins. Browser filtering alone does not satisfy this.
4. Repeat create → assign → member complete → check-in → head escalate → lead resolve, then reload and verify persistence in staging.
5. Validate downloaded CSV content in an interactive browser and check search, pagination, and date filters against staging data.
6. Commit/review the app changes and release only the tested build after these results pass. This run did not push, merge, publish npm packages, or deploy the app.

## Evidence

- `work/release-e2e-20261014/verify-published.mjs`: repeatable published-artifact test script; requires the downloaded tarball and consumer install described above.
- `work/release-e2e-20261014/published-results.json`: 22 pass results and POD_DEMO summary.
- `work/release-e2e-20261014/pod-demo-report.json`: published scanner JSON output.
- `work/release-e2e-20261014/dependency-audit.json`: full package audit result.
- `work/release-e2e-20261014/github-ci.json` and `github-jobs.json`: CI snapshot.
- `work/release-e2e-20261014/release-gates.log`: local release gate output (ignored by Git).

Generated caches, installs, extracted tarballs, synthetic fixtures, and prefixes are ignored within the evidence directory and excluded from npm packaging.
