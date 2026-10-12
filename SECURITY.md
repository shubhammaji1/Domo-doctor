# Security policy

Domo Doctor scans local files and source code statically. It does not evaluate
project code, make network requests, or read Domo credentials. Please report
security issues privately to the repository maintainers before public
disclosure. Do not include credentials, customer data, or tokens in reports.

If the repository offers GitHub private vulnerability reporting, use its
Security tab to report an issue. Otherwise contact a maintainer privately
through the contact details on their public profile; do not post exploit
details or secrets in a public issue. Include the exact package version,
operating system, Node version, a minimal synthetic reproduction, and impact.

The published 0.1.0 artifact lacks runtime files. The 0.1.1 security fixes are
currently an unreleased candidate; see `audit-reports/RELEASE_READINESS.md`
in the source repository for verification scope and remaining release gates.

Diagnostic redaction recognizes common credential patterns and is not a
guarantee that arbitrary confidential text is removed. Review reports before
sharing them. Scan a stable checkout: path checks are defense in depth, not a
sandbox against a privileged process concurrently changing the filesystem.
