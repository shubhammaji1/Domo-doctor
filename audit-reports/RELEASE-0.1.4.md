# 0.1.4 release validation — 14 October 2026

Addresses all six findings in the independent 0.1.3 audit:

- F1: Shared Domo receiver/method classification recognizes static element access, optional calls, and window/globalThis receivers. Missing paths and computed methods produce unverified diagnostics.
- F2: Linked project entries remain untraversed; non-ignored links are recorded as incomplete source coverage for dataset, AppDB, and proxy checks.
- F3: Safe-path checks inspect ancestors from the filesystem root, including ancestors above the selected project root.
- F4: Exact suppression scopes preserve filename case and normalize path separators. A portable rule-engine regression checks distinct diagnostic paths; a Linux-only integration regression creates both case-distinct files.
- F5: Receiver writes, destructuring assignments, loop assignments, deleted globals, shadowed globals, and unsupported ryuu imports downgrade identity confidence. Dataset and AppDB analysis share receiver classification.
- F6: Security guidance is updated; CHANGELOG.md is packaged and installed documentation is checked in the package smoke test.

Validation executed on Windows with Node 22:

- Typecheck, lint, formatting, and git diff whitespace checks passed.
- Self-test: 30 assertions passed.
- Vitest: 166 passed, one Linux-only test skipped, across 13 files.
- Coverage: statements 96.03%, branches 92.93%, functions 98.24%, lines 96.73%; configured thresholds passed.
- Packed consumer installation, CLI launch/version, ESM exports, library scan, and packaged documentation checks passed.
- Runtime dependency advisory scan: zero known vulnerabilities at validation time.

The restricted Windows process could not perform temporary-directory realpath checks. Filesystem and junction tests passed when executed outside that restriction. Linux/macOS and other Node versions were not executed locally; the repository CI matrix covers those environments when run.

Publication is pending npm authentication: registry latest was 0.1.3, and npm whoami returned 401 Unauthorized. No claim of a published 0.1.4 is made by this report.
