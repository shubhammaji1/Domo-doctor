# Domo Doctor

**Diagnose. Test. Fix. Ship.**

Domo Doctor is an offline-first CLI and TypeScript library for finding verifiable configuration problems in Domo custom app projects. It reports exact source locations where static analysis can determine them, labels checks it cannot verify, and never edits project files during a scan.

This project is independently developed and is not affiliated with, endorsed by, or supported by Domo, Inc.

## What it checks

- Finds a missing `manifest.json`, reports JSON parse locations, and validates known documented manifest property shapes.
- Detects duplicate dataset aliases, duplicate field aliases within a dataset mapping, and malformed mapping entries.
- Uses the TypeScript Compiler API to compare literal `domo.get("/data/v1/<alias>")` paths with manifest mappings for JavaScript, JSX, TypeScript, and TSX.
- Marks dynamic `domo.get` paths unverified instead of assuming they are broken.
- Recognizes likely AppDB usage but keeps collection, permissions, and runtime checks unverified. Domo's published manifest reference does not describe an offline collection declaration to cross-check.
- Checks whether the `domo` executable is discoverable on `PATH` without executing it or reading Domo CLI credentials.
- Emits terminal, JSON, and SARIF 2.1.0 reports with separate passed, skipped, and unverified counts.

The manifest rules follow Domo's [manifest documentation](https://developer.domo.com/docs/tools/manifest) and [Dev Studio CLI documentation](https://developer.domo.com/docs/tools/dev-studio-cli). The documented `id` is added on first publish, empty `fields` arrays are valid, and `proxyId` is conditional on advanced proxy use. Domo Doctor does not reject unknown manifest properties or require a design ID in an unpublished project.

## Requirements and installation

- Node.js 20 or newer
- npm

Install in a Domo project:

```bash
npm install --save-dev domo-doctor
npx domo-doctor scan
```

Or run without adding it to the project:

```bash
npx domo-doctor scan ./my-domo-app
```

## Quick start

```bash
domo-doctor --help
domo-doctor scan
domo-doctor scan ./my-domo-app --format json --output doctor-report.json
domo-doctor check mappings
domo-doctor check appdb
domo-doctor check proxy
domo-doctor test examples
domo-doctor rules list
domo-doctor explain DD-MAN-005
domo-doctor init
```

Use `--severity error|warning|info` to choose the failure threshold for the exit code. The default threshold is `error`; it can also be set with `failOn` in configuration. `--verbose` adds passed-check details. `--no-color` disables terminal colors. JSON and SARIF are written without terminal decoration.

The scanner is also available as a library:

```ts
import { createDoctor } from "domo-doctor";

const doctor = createDoctor({ root: "./my-domo-app" });
const report = await doctor.scan();
console.log(report.summary);
```

Exit codes:

- `0`: scan completed without an unsuppressed failed finding at or above the configured threshold.
- `1`: scan completed and found an unsuppressed failed finding at or above the threshold.
- `2`: invalid arguments or configuration, or fatal scan execution error.

Skipped and unverified checks do not silently count as passed and do not fail the default error threshold.

## Supported projects

Domo custom app designs built with HTML, JavaScript, TypeScript, React, or similar front-end tooling are supported for offline manifest and static source checks. Source analysis recognizes direct `domo.get` calls. Other request wrappers, runtime-only behavior, and non-literal API paths may not be classifiable. The tool does not run project code or provide browser end-to-end testing.

## Commands

| Command                                  | Purpose                                                              |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `domo-doctor scan [directory]`           | Run all offline checks (default directory: current directory).       |
| `domo-doctor check manifest [directory]` | Validate the manifest and mappings.                                  |
| `domo-doctor check mappings [directory]` | Check mapping definitions and recognized source references.          |
| `domo-doctor check appdb [directory]`    | Identify AppDB source and explain offline verification limits.       |
| `domo-doctor check proxy [directory]`    | Check conditional `proxyId` configuration and Domo CLI availability. |
| `domo-doctor test [fixture-directory]`   | Run offline expectations from `*.doctor-test.json` files.            |
| `domo-doctor rules list`                 | List diagnostic IDs and scope.                                       |
| `domo-doctor explain <ruleId>`           | Explain a diagnostic rule and its evidence limits.                   |
| `domo-doctor init [directory]`           | Create a starter config; refuses to overwrite an existing file.      |

Options for `scan` and `check`:

```text
--config <path>           Configuration file
--format <terminal|json|sarif>
--output <file>           Write the selected report to a file
--severity <error|warning|info>  Failure threshold for exit code
--no-color
--verbose
```

## Configuration

Run `domo-doctor init` or create `domo-doctor.config.json`:

```json
{
  "root": ".",
  "manifest": "manifest.json",
  "rules": {
    "DD-MAN-004": "error",
    "DD-MAN-005": "error",
    "DD-MAP-001": "warning",
    "DD-MAP-002": "off"
  },
  "ignore": ["generated/**"],
  "reporter": "terminal",
  "failOn": "error",
  "ruleTimeoutMs": 5000,
  "suppressions": [
    {
      "ruleId": "DD-MAP-001",
      "file": "src/legacy.js",
      "reason": "This path is assembled by a runtime route table."
    }
  ]
}
```

Rule values are `error`, `warning`, `info`, or `off`. Suppressions require a reason and can apply to one rule across the project or one exact project-relative file. Suppressed findings remain visible in reports but do not trigger the exit threshold. The configured root must stay inside the directory selected on the command line or through the library. Manifest and configuration paths cannot contain symbolic links or directory junctions. Ignore patterns and suppression file scopes cannot traverse outside the project root. The default ignore list skips dependency/build folders, VCS metadata, environment files, and common credential or key files.

## Rule catalog

| ID             | Severity              | Check                                                                                 |
| -------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `DD-MAN-001`   | error                 | Manifest file exists.                                                                 |
| `DD-MAN-002`   | error                 | Manifest is valid JSON; parser location is included where available.                  |
| `DD-MAN-003`   | error                 | Documented manifest properties have valid shapes; unknown properties are allowed.     |
| `DD-MAN-004`   | error                 | Dataset aliases are unique.                                                           |
| `DD-MAN-005`   | error                 | Field aliases are unique within each dataset mapping.                                 |
| `DD-MAN-006`   | error                 | Mapping entries have documented non-empty values and valid field shapes.              |
| `DD-MAN-007`   | warning or unverified | Advanced request markers are checked against conditional proxy configuration.         |
| `DD-MAP-001`   | warning               | A literal `data/v1` request names an alias absent from the manifest.                  |
| `DD-MAP-002`   | warning or unverified | A computed `domo.get` path cannot be statically matched.                              |
| `DD-APPDB-001` | warning or unverified | AppDB references are detected; live collection and permission checks are not claimed. |
| `DD-PROXY-001` | warning               | `domo` executable is not discoverable on `PATH`; authentication is not checked.       |

## Example

The repository includes a [healthy example](examples/healthy-app) and a [broken example](examples/broken-app). Try:

```bash
npx domo-doctor scan examples/healthy-app
npx domo-doctor scan examples/broken-app
```

The broken sample intentionally repeats a dataset alias and field alias, has an incomplete mapping, references an undeclared dataset in source, and includes a dynamic request. The tool points to the manifest property or source line and explains which conclusion is confirmed and which remains unverified. Rename one of the aliases, complete the mapping, and make the request match the intended alias; then re-run the scan.

Fixture files use a project-relative `project` directory plus expected rule IDs and statuses. Projects must remain inside the fixture directory, including after configuration is loaded, and the runner never executes their source. Each fixture must contain at least one entry in `expect` or `forbid`:

```json
{
  "name": "broken sample",
  "project": "broken-app",
  "expect": [{ "ruleId": "DD-MAN-004", "status": "failed" }]
}
```

## Reports and CI

JSON contains the package version, sanitized project marker, execution status for each rule, findings, severity counts, check status counts, and duration. SARIF output uses version 2.1.0 and is suitable for supported code-scanning upload actions.

Example GitHub Actions job in a Domo app repository:

```yaml
name: Domo Doctor
on: [push, pull_request]
permissions:
  contents: read
  security-events: write
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx --yes domo-doctor scan --format sarif --output domo-doctor.sarif
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: domo-doctor.sarif
```

No Domo credential is needed for this offline scan. Pin action versions to your organization's approved revisions before using the example in production.

## Offline checks, privacy, and limits

The standard scan makes no network requests or telemetry requests. It reads the selected manifest and project source files, parses source as syntax trees, and never evaluates application code. It does not modify project files. It does not inspect, decode, print, or export Domo CLI credentials. Report paths are project-relative and diagnostic strings are redacted for common credential patterns.

The MVP does not authenticate to Domo, query datasets, validate AppDB permissions or collection existence, execute DQL, detect schema drift, or test a browser session. `DD-PROXY-001` only checks executable availability; it does not establish login state. Dynamic source paths and advanced integrations may require live verification. No overall application health percentage is calculated.

Input limits prevent accidental resource exhaustion: configuration, manifest, and fixture JSON files are limited to 1 MiB each; source files above 1 MiB are reported as unverified. A scan accepts up to 32 MiB of source, 50,000 directory entries, and 64 directory levels. Ignore patterns are limited to 128 entries including defaults, 1,024 characters each, and eight nesting levels. Exceeding a whole-scan limit returns a fatal error rather than a successful partial report.

## Development

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run test:vitest
npm run format:check
npm run build
npm run pack:check
```

`npm test` runs the built package's offline self-test suite, including CLI status behavior. `npm run test:vitest` runs the detailed Vitest suite and `npm run test:coverage` measures rule-engine and manifest coverage. Tests use local fixtures and temporary directories; they require no Domo account. `npm run pack:check` builds and packs the package, installs that tarball into a temporary consumer project, and verifies the installed CLI, library exports, and version. This release check needs npm registry access to install dependencies. The `prepack` hook also builds automatically for `npm pack` and `npm publish`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [SECURITY.md](SECURITY.md) for security reporting.

## Roadmap

1. Extend source analysis for additional documented Domo client patterns.
2. Add an opt-in schema snapshot format backed by local fixtures.
3. Add external response compatibility fixtures and reusable test helpers.
4. Add opt-in live checks only after documenting official API requirements and read-only request behavior.
5. Consider optional browser checks and AI explanations as separate modules with explicit isolation and consent.

## License

MIT. Domo and Domo product names are used only to describe compatibility; this independent tool is not an official Domo product.
