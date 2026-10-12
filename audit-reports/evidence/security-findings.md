# Independent security findings (pre-fix)

Environment: Windows win32, Node v22.22.0. Source/local built version 0.1.1. Run: `node audit-reports/evidence/security/probes.mjs` from repository root. Only disposable synthetic OS temporary directories used and removed. Full commands, outputs, exit codes and elapsed times are in `security/security-probes.json`; test implementation is `security/probes.mjs`. This is local-source behavior, not a claim about current npm distribution.

## SEC-01 — High: bearer credentials leak in all report formats — VERIFIED FAILURE

Affected: src/core/scanner.ts sanitizeDiagnostic (near lines 618–640); src/analyzers/source-code.ts diagnostic alias interpolation. Source input `domo.get("/data/v1/Authorization: Bearer SYNTHETIC_BEARER_1");` emits `Authorization: [redacted] SYNTHETIC_BEARER_1` in terminal verbose, JSON and SARIF. A suppression reason `Authorization: Bearer SYNTHETIC_BEARER_2` leaks identically. All six executed report cases contain the synthetic credential. Regex's unquoted value branch stops at whitespace and replaces only Bearer. Raw source is not generally dumped, but recognizable credential content flowing into diagnostics is exposed. A source/config author must place such strings in an alias/suppression reason; environment variables are not automatically echoed.

Fix: centralized sanitization covering entire Authorization value including Bearer/Basic; sanitize all user-controlled report fields and error messages, escape terminal controls. Avoid printing unknown config keys verbatim. Regression: assert absence of complete unique synthetic token in terminal normal/verbose, JSON, SARIF and library reports; include quoted/unquoted header values, mixed case, whitespace, and suppression reasons.

## SEC-02 — Medium: errors bypass sanitization — VERIFIED FAILURE

Affected: src/core/scanner.ts unknownRuleIds error (near 143); src/cli/index.ts runCli catch (near 439). Config `{"rules":{"token=SYNTHETIC_RULE_SECRET":"off"}}` exits 2 with stderr `Unknown diagnostic rule ID: token=SYNTHETIC_RULE_SECRET`. Diagnostic sanitizer is not called on this error path. Fix: safe generic validation errors or centralized error redaction. Regression: test malicious unknown rule/suppression identifiers with token/password/Authorization contents and ensure stderr omits synthetic secret.

## SEC-03 — High impact, P1: report output silently overwrites input or existing files — VERIFIED FAILURE

Affected: src/cli/index.ts executeScan output write (near 354–360). Run scan with `--output <project>/manifest.json`; success exit 0 and manifest replaced by JSON scan report. `--output <project>/outlink/report.json`, where outlink is a junction to a synthetic outside directory, also returns 0 and overwrites an outside existing report. Only explicitly supplied --output triggers writing; default scan is read-only. Evidence includes before synthetic manifest semantics, post-overwrite report and changed flag for junction target. Fix: reject input collisions and existing targets using exclusive atomic no-clobber create, reject symlink/junction ancestors, avoid partial files, document behavior. Regression: pre-existing report, manifest/config/source collision and junction parent each fail safely with original content unchanged; newly created plain output succeeds.

## SEC-04 — Medium: input size bounds do not bound parser stack depth — VERIFIED FAILURE

Affected: src/core/scanner.ts ts.createSourceFile before runRules; src/analyzers/manifest.ts jsonc-parser fallback. A 6009-byte source expression with 3000 opening/closing parentheses exits 2 `Maximum call stack size exceeded`. A 10006-byte malformed manifest with 10000 opening brackets and broken suffix exits 2 with same message. No raw secret appears in these observed exceptions, and CLI safely exits rather than hangs; embedded scan rejects and no structured report is generated. Promise-based rule timeout cannot interrupt synchronous parser work and applies after parsing. Fix: parser isolation/bounded structural depth and friendly errors; ensure synchronous work cannot monopolize process. Regression: deep valid/invalid source and manifest under size cap should return clear bounded diagnostic without uncaught RangeError.

## Executed positive controls

- Invalid manifest/config including fake secrets did not echo fake parse secrets.
- Config root `..` rejected with exit 2.
- 1 MiB + 1 manifest rejected with size-limit error.
- Parent junction inside selected root pointing outside rejected for manifest reads.
- Prototype-named alias and __proto__ manifest object produced completed report, with no observed prototype pollution; no general proof of all prototype inputs.
- Ordinary root reached through ancestor junction was accepted. This illustrates incomplete ancestor checking but is not claimed to violate the user's chosen project root by itself.

## Static findings and limits

- No network, child process, eval or application module import exists in runtime src implementation; standard diagnostics parse text and inspect PATH filenames without running Domo CLI. Authentication, tenant isolation, API timeout/retry, TLS and API mutations are NOT APPLICABLE to current offline product. No live Domo credentials/API tests performed.
- readProjectFile checks lstat ancestors then opens using `open(file,"r")`; protection is subject to a time-of-check/time-of-use race. At this stage a natural race exploit is NOT TESTED; do not claim verified exploit without subsequent race evidence.
- Ignore patterns bounded to 128, length 1024 and nesting 8; directory enumeration capped at 50000/depth64, source text at 32 MiB, per-file 1 MiB. Dependency pattern engine complexity remains only partially tested.
- No source/test implementation was changed by this reviewer. Files here are evidence only.

## Additional pre-fix verification

- SEC-01/02 additional VERIFIED FAILURE: JSON `file` includes `token=SYNTHETIC_FILENAME_SECRET.js` unchanged. Fixture unknown key `token=SYNTHETIC_FIXTURE_SECRET` appears in CLI stderr in Zod validation details (fixture-tests.ts validation-message concatenation). `security/extra-probes.json` preserves exact commands/outputs. Extend centralized sanitization to file/propertyPath and fixture errors or omit unknown input keys.
- SEC-05 — Medium terminal control injection — VERIFIED FAILURE: source alias includes ESC[2J ESC[H; `--no-color` stdout preserves both controls and `FORGED_PASS`. Terminal can be cleared or restyled by malicious source text. Strip/escape C0/C1 and ANSI/OSC controls before rendering untrusted text; JSON should escape content and remain parseable. Regress with CSI clear-screen and OSC hyperlinks/control strings; assert no raw ESC in --no-color stdout.
- SEC-06 — Medium/high in attacker-writable concurrent checkout: read boundary race — VERIFIED UNDER DETERMINISTIC INSTRUMENTATION. `node audit-reports/evidence/security/race-proof.mjs` patches the OS file-open call only to schedule a disposable parent-directory rename and replacement junction between validation and open. Unmodified readProjectFile then returns `OUTSIDE_SYNTHETIC_CONTENT`. `security/race-proof.json` contains result. This proves the check/open gap can accept a replaced ancestor, not the scheduling likelihood or a real adversarial natural race. A process able to mutate the checked directory concurrently is required. Mitigate with canonical-path and opened-file identity validation at read time; robust directory-handle relative opens may require platform-specific implementation. Regress using deterministic injected boundary or racing fixture and assert no outside contents returned. Do not claim ordinary static junction regression covers this race.
- VERIFIED PASS in `security/passive-proof.json`: instrumented http/https/net/dns/fetch/child_process methods were called zero times; default programmatic scan completed, project filename/content SHA-256 snapshots remained identical; deliberately throwing source was parsed without executing, fake process DOMO_TOKEN and .env credential values absent from report. This is one realistic offline invocation plus static source review, not exhaustive proof of third-party runtime behavior.
- Optional scanners NOT TESTED: gitleaks, semgrep, and osv-scanner were unavailable on PATH. Explicit availability results in `security/scanner-tools.json`. No remote scanner installation or unreviewed external scanner execution performed.
