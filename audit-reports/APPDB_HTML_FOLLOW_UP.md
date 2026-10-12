# AppDB and HTML follow-up: 0.1.2 candidate

Date: 2026-10-12. Branch: `codex/appdb-offline-validation`.

The published 0.1.1 release detected AppDB markers but did not validate collection declarations, and treated every HTML entry point as incomplete source. The 0.1.2 candidate adds local collection validation and HTML script analysis.

## Changes

- Validate `collectionsMapping` entries, optional IDs and synchronization flags, and schema column shapes. Report duplicate collection and column names. Accept unknown properties and future column type strings.
- Compare literal AppDB document requests and immutable top-level string tables with declared collection names or IDs. Leave mutable, escaped, shadowed, dynamic, and unsupported expressions unresolved. Unknown client receivers remain unverified.
- Consolidate live AppDB verification into one project-level notice. Comments alone no longer trigger AppDB detection.
- Parse HTML script elements with parse5, preserve source positions, and check available local script assets. Report remote or missing scripts, base URL changes, event handlers, JavaScript URLs, embedded frame documents, and incomplete script elements as unverified.
- Bound extracted HTML source to the original input size, reuse the project asset index, traverse syntax trees iteratively, and bound constant-resolution ancestor walks. Preserve existing filesystem, privacy, input-size, and output protections.
- Use parse5 7.3 rather than 8 to preserve the existing Node 20 engine range; parse5 8 pulls in a dependency requiring Node 20.19 or newer.
- Extend the installed-tarball smoke test to exercise HTML and AppDB diagnostics through the packaged CLI.

## POD_DEMO result

The local candidate scanned POD_DEMO using its existing `domo-doctor.config.json`, which selects `public/manifest.json`. Application source, manifest, and installed dependency versions were not changed during this follow-up.

| Result     | Published 0.1.1 | Local 0.1.2 candidate |
| ---------- | --------------- | --------------------- |
| Errors     | 0               | 0                     |
| Warnings   | 0               | 0                     |
| Passed     | 4               | 6                     |
| Skipped    | 3               | 4                     |
| Unverified | 10              | 2                     |

Evidence: [candidate scan](evidence/candidate-012-pod-demo.json). The remaining unverified items are live AppDB access and proxy ID validity. Dynamic collection arguments and wrapper behavior still need runtime testing. No Domo requests or database writes were made.

## Validation and release boundary

The final `npm run prepublishOnly` gate passed: 114 regression tests, 30 self-test assertions, type checking, lint, formatting, fresh tarball CLI/library installation, and a production dependency audit reporting zero vulnerabilities. Coverage: 95.83% statements, 92.19% branches, 98.08% functions, and 96.49% lines, above the existing 90% thresholds.

The regression suite includes malformed declarations, duplicate names, static requests, mutable and shadowed string tables, HTML source positions, remote and missing scripts, unsupported embedded code, and large HTML inputs. An initial larger HTML stress fixture caused two concurrent CLI tests to exceed their five-second test timeout; the smaller bounded fixture passed the full suite. No security assertions or coverage thresholds were weakened.

The candidate is local and unpublished. Run the existing Linux, macOS, and Windows CI matrix before merging and publishing 0.1.2. Successful offline checks do not establish live permissions, deployed collection schemas, proxy authentication, or end-to-end CRUD correctness.
