# Release readiness — 12 October 2026

Update: subsequent CI exposed a Unix CLI symlink startup defect, now fixed locally with a regression test. Secret scans passed on the PR commit. See [CI follow-up](CI_FOLLOW_UP.md) for evidence and the required rerun; the historical score below does not override that release gate.

**Public npm 0.1.0: NOT READY. Local unreleased 0.1.1: INSUFFICIENT EVIDENCE for a general production launch.**

An external developer cannot use the published release today: its five-file tarball omits `dist`, so the declared CLI and library entry points fail. Local packaging and confirmed security/correctness defects have been fixed and tested. Those changes are not published. The local candidate works in the tested Windows/Node22 environment, but the promised compatibility matrix and remote secret-scanning gates have not run.

## Candidate scorecard

These are reviewer judgments about the strength of available evidence, not probabilities of safety or measured application health. They score the corrected local candidate only; no score overrides a release blocker.

| Category                               |   Weight | Score / 100 | Evidence and remaining uncertainty                                                                                                      |
| -------------------------------------- | -------: | ----------: | --------------------------------------------------------------------------------------------------------------------------------------- |
| Security and privacy                   |      25% |          90 | Confirmed leaks/write/parser/race probes blocked; production audit clean; secret scan and cross-platform filesystem behavior unverified |
| Functional correctness                 |      20% |          88 | Regression suite, CLI scenarios and mapping fixes pass; source binding/endpoint coverage deliberately limited                           |
| Real-world reliability                 |      20% |          75 | Synthetic scenarios and configured pod_demo offline scan pass; live Domo/browser operation untested                                     |
| npm packaging and compatibility        |      15% |          85 | Candidate fresh/install/upgrade/library checks pass; Windows Node22 only, pnpm unavailable, new package provenance absent               |
| Performance and stability              |      10% |          80 | Three-run workloads stable and bounded; no cold-cache or cross-machine guarantee, synchronous parsing remains                           |
| Documentation and developer experience |      10% |          85 | Explicit limitations/changelog/reports; default manifest location required config in pod_demo; upstream reference routes need renewal   |
| **Weighted total**                     | **100%** |   **84.35** | `90*.25 + 88*.20 + 75*.20 + 85*.15 + 80*.10 + 85*.10`                                                                                   |

## Release gates

1. Run the configured Linux/macOS/Windows × Node20/22/24 CI matrix and inspect packed CLI permissions/import behavior on Unix. Local success does not establish all `node >=20` versions work.
2. Run the configured Gitleaks job and resolve findings; verify repository required checks/branch protection. Neither secret scan nor branch protection is confirmed by adding YAML alone.
3. Review pod_demo's ten unverified results and test the final tarball in an isolated project checkout. Live collection, permissions and browser tests require separate authorized Domo validation; this package does not implement them.
4. Confirm npm account 2FA, token scope and release process. Decide and verify provenance/signing for publication; dependency signatures are not this candidate's provenance.
5. After approval to release, publish 0.1.1, then install **the registry artifact** in a fresh consumer and recheck CLI/import/scan and integrity. Do not assume local packing proves registry delivery.

No npm publish or Git push occurred. Current changes are reviewable on `codex/production-audit-20261012`. The prepublish hook blocks on typecheck, lint, self-tests, full-source coverage, formatting, packed-artifact smoke test and production dependency audit. Remote CI gates need to be required by repository settings; local hooks can be bypassed and are not access controls.

## Evidence index

- [Security audit](SECURITY_AUDIT.md), [test results](TEST_RESULTS.md), [real-world scenarios](REAL_WORLD_SCENARIOS.md), [performance](PERFORMANCE_REPORT.md), [roadmap](IMPROVEMENT_ROADMAP.md).
- [Published artifact/distribution analysis](distribution-findings.md), [original platform findings](platform-findings.md), [final command statuses](evidence/final-commands.json).

Readiness is scoped to an offline diagnostics tool. Authentication, rate limiting, live API response compatibility and application deployment are not passing claims for unimplemented features.
