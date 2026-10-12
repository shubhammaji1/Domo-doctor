# Domo platform and analyzer correctness audit

Scope: local workspace version 0.1.1, built dist, 2026-10-12. No Domo credentials, application execution, authentication, API mutation, or publishing. The independent probe runs the built public library and writes synthetic files beneath audit-reports/evidence/platform/cases. These are analyzer behavior tests, not evidence of Domo service responses.

## Reproduction

Command: `node audit-reports/evidence/platform/probe.mjs`

Result: exit 0; 33 independent scan scenarios saved in `results.json`, with full per-case reports in `cases/<name>/report.json`. Exit 0 means probe execution completed, not that every scenario passed an assertion. The probe records observed outcomes for independent review. The executable-on-PATH check found this machine's Domo CLI; it was never invoked.

## Confirmed findings before remediation

### PLATFORM-01 — Null mapping crashes source rule (medium)

`src/analyzers/source-code.ts:17` dereferences mapping.alias without checking that each entry is an object. `mapping:[null]`, and `[null,{alias:"sales",dataSetId:"id"}]`, cause DD-MAP-001 to return "Diagnostic rule failed unexpectedly." The rule engine catches the TypeError and keeps the process alive, so this is not a process crash. DD-MAN-006 correctly diagnoses the invalid mapping entry, but the source rule loses the useful missing-alias finding. Regression: end-to-end scanner with null and mixed invalid/valid mapping entries must report DD-MAN-006, continue scanning valid entries, and emit no internal-rule failure.

### PLATFORM-02 — Identifier-only recognition creates high-confidence false positives (medium)

`src/analyzers/source-code.ts:164` recognizes any identifier spelled domo, with no binding/scope evidence. `const domo = new Map(); domo.get("/data/v1/missing");` emits DD-MAP-001 warning with high confidence although this is a JavaScript Map lookup. A function parameter named domo is treated identically. With warning thresholds this can reject unrelated code. Minimum fix: recognize obvious incompatible local bindings, and downgrade uncertain/shadowed receivers to unverified; future enhancement is scope/binding resolution. Regression should include global domo, supported import domo, parameter shadowing, unrelated local Map, and nested scopes.

### PLATFORM-03 — Direct AppDB endpoint missed (medium)

`src/analyzers/source-code.ts:86` only detects the word appdb or toolkit text, so `domo.get("/domo/datastores/v1/collections/a/documents")` gets DD-APPDB-001 skipped. DD-MAN-007 already recognizes the same endpoint as advanced proxy usage, demonstrating internal inconsistency. Fix endpoint recognition and keep result unverified: detecting a literal endpoint cannot prove permissions, collection existence, or valid request schema. Add direct GET and POST/PUT/DELETE path cases and dynamic templates.

### PLATFORM-04 — HTML inline and unsupported source forms have no coverage signal (medium docs/coverage)

`src/analyzers/source-code.ts:138`, `src/core/scanner.ts:71`: only JS/JSX/TS/TSX and c/m variants are parsed. An index.html containing an inline direct missing-alias request produces DD-MAP-001 passed and zero unverified source results. README:76 says HTML projects are supported for manifest and static source checks without noting inline scripts are excluded. Either parse inline scripts with accurate HTML offsets in a later feature, or explicitly document this exclusion and return unverified coverage where inline scripts were not inspected. Same broad limitation affects Vue/Svelte files. This does not imply malicious source execution: application code is never evaluated.

### PLATFORM-05 — Malformed source accepted without parser limitation signal (low/medium)

`src/core/scanner.ts:102` creates a TypeScript AST but does not inspect parse diagnostics. Source `const = ;` yields no errors or unverified findings. The product does not advertise a general compiler check, so it need not diagnose all application syntax, but analysis performed on a recovered tree should disclose its uncertainty rather than let users assume full source coverage. Regression: malformed syntax around a request should produce an explicit analysis limitation and continue unrelated healthy files.

### PLATFORM-06 — Invalid mapping type receives contradictory mapping-rule pass (low)

With `mapping:{}`, DD-MAN-003 correctly fails, but DD-MAN-006 reports passed "Dataset and field mapping definitions are well formed." `checkMappings` returns [] for non-array mapping, and rule engine interprets empty result as passed. DD-MAN-004 and 005 are skipped. Fix DD-MAN-006 to skip when structure is invalid. No overall successful scan occurs at the default threshold, but per-rule results misrepresent evidence.

### PLATFORM-07 — Documentation links/reference freshness (low documentation)

README and diagnostics use legacy developer.domo.com/docs/tools links. Direct retrieval of manifest and CLI links returned 404; search index still exposes official cached text. Current portal routes also failed in this tool (redirect to www.domo.com/docs inaccessible). Do not infer that Domo lacks current collectionsMapping documentation from an older reference or failed retrieval. README:15 and AppDB explanation should say collection validation is not implemented/supported in this release, rather than claim absence throughout Domo's published manifest reference. Verify current manifest dialects before adding rejection rules: unknown keys are currently allowed, which avoids rejecting newer Domo extensions.

## Scope limits and nonbugs

- Literal domo.get('/data/v1/missing'), optional property/call variants, and no-substitution template literals are recognized with source locations.
- A known alias plus query parameters passes. Aliases are compared exactly, preserving case.
- Dynamic template, variable argument and parenthesized literal are unverified; no attempt at constant folding. Parenthesized literals are an avoidable precision limitation, not a false assertion of breakage.
- Bracket access, window.domo, renamed imports and wrappers are missed. README explicitly limits to direct domo.get patterns and excludes other wrappers. Their absence is a coverage limitation rather than an invented support requirement. Prefer coverage disclosure.
- '/data/v2' and SQL/DQL request aliases are not validated. README promises only data/v1 alias checks; do not claim data/v2 or SQL compatibility.
- '/sql/v1/sales' and '/domo/files/v1/files' are not recognized as advanced proxy markers by current matching. Official CLI reference explicitly mentions Files API as advanced; a future proxy classifier should cover documented concrete routes. The audit does not prove these calls succeed at a live service.
- '%73ales' is compared as a raw alias and flagged even when sales is mapped. This is an observed normalization limitation, not a confirmed live-platform false positive: percent-decoding behavior was not verified with Domo.
- '**proto**' dataset and 'constructor' field aliases do not crash or cause pollution in this probe. Map/Set usage avoids dictionary-key collisions.
- Empty fields and optional fields are accepted, unpublished manifests need no id, unknown properties are tolerated. These agree with the retrieved legacy official reference.
- version:'banana' is accepted. Official reference recommends semantic versioning but README promises property shapes, so enforcing semver is an optional correctness improvement; no live publish rejection was verified.
- A source above 1 MiB gets mapping rules unverified, as documented. AppDB/proxy rules currently still skip/pass despite inaccessible source; unify coverage signaling as a future hardening task.

## Capability matrix for parent report

| Capability                                                                | Documented               | Implemented | Independently tested                                         | Result                                                               |
| ------------------------------------------------------------------------- | ------------------------ | ----------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Manifest JSON/object/type validation (DD-MAN-001..003)                    | Yes                      | Yes         | Selected synthetic type cases plus source review             | Partial: invalid source is outside scope; manifests handled          |
| Unique aliases/fields and mapping shape (DD-MAN-004..006)                 | Yes                      | Yes         | Null/primitive mapping entries, null fields, prototype names | Partial: contradictory DD-MAN-006 pass for non-array mapping         |
| Literal direct data/v1 alias comparison (DD-MAP-001)                      | Yes                      | Yes         | Healthy/missing/query/template/optional/case                 | Partial: null entry internal error and unrelated domo false positive |
| Dynamic direct GET disclosure (DD-MAP-002)                                | Yes                      | Yes         | Template, const variable, parenthesized literal              | Pass within documented scope                                         |
| JS/JSX/TS/TSX parsing                                                     | Yes                      | Yes         | JS scenarios; detailed repository tests cover TSX            | Pass narrowly; malformed AST recovery undisclosed                    |
| HTML inline script analysis                                               | Broad HTML support claim | No          | Inline script synthetic HTML                                 | Documentation/coverage gap                                           |
| Wrappers/window/bracket/renamed import coverage                           | Explicitly limited       | No          | Four synthetic forms                                         | Known limitation, not supported                                      |
| AppDB usage recognition (DD-APPDB-001)                                    | Yes, likely markers      | Heuristic   | Toolkit test source review; literal endpoint/comments probes | Partial: endpoint missed; comments false marker                      |
| Conditional proxy requirement (DD-MAN-007)                                | Yes                      | Heuristic   | Direct AppDB, files, SQL, comments, oversized                | Partial: endpoint coverage incomplete                                |
| Domo executable discovery (DD-PROXY-001)                                  | Yes                      | Yes         | Existing isolated PATH tests reviewed                        | Availability only; no login claim                                    |
| Live authentication/token refresh, 401/403/429, CORS, dataset permissions | Explicitly excluded      | No          | Not exercised against live Domo                              | Unsupported/unverified, not a passing QA result                      |
| AppDB schema, collection existence, CRUD, export, permissions             | Explicitly excluded      | No          | Static detection only                                        | Unsupported/unverified                                               |
| DQL execution, API response/schema compatibility, dataset schema drift    | Explicitly excluded      | No          | No service calls                                             | Unsupported/unverified                                               |
| Browser runtime / real Domo publishing                                    | Explicitly excluded      | No          | No browser/publish requests                                  | Unsupported/unverified                                               |

## Official reference sources and retrieval limits

Retrieved 2026-10-12 using web search, restricted conclusions to primary Domo developer sources. Search index text was available while direct opens failed; source freshness cannot be guaranteed from these old indexed references. No community answers were used as normative API specifications.

- https://developer.domo.com/docs/tools/manifest — indexed official manifest reference: mapping/dataSetId/fields, optional publish id, empty fields, size defaults, semver recommendation, conditional advanced proxy. Direct open returned 404. Relevant source claims summarized, not copied.
- https://developer.domo.com/docs/tools/dev-studio-cli?category=%2Fdocs%2Foverview%2Fbuild-apps — indexed official CLI reference: advanced local proxy for AppDB/Files, proxyId tied to app/card; login needed for dev/publish. Direct legacy no-query open returned 404.
- https://developer.domo.com/portal/af407395c766b-the-manifest-file — newer manifest route identified but not accessible in this web tool. Current collection declarations therefore not independently validated.
- https://developer.domo.com/portal/e947d87e17547-domo-js — newer client route attempted; redirects to https://www.domo.com/docs/portal/e947d87e17547-domo-js failed. Live request normalization and newer endpoint semantics unverified.

No assertion is made that a clean offline report establishes a working, authorized, production-ready Domo application.
