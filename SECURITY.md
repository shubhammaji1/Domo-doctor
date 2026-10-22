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

Use the latest published release for security and diagnostic coverage fixes.
The 0.1.0 artifact lacks runtime files. Release 0.1.4 addresses the independent
0.1.3 audit findings about call coverage, linked source, ancestor junctions,
suppression case, and receiver identity. See the packaged CHANGELOG.md for
release details and the [versioned changelog](https://github.com/shubhammaji1/Domo-doctor/blob/v0.1.4/CHANGELOG.md).

Diagnostic redaction recognizes common credential patterns and is not a
guarantee that arbitrary confidential text is removed. Review reports before
sharing them. Scan a stable checkout: path checks are defense in depth, not a
sandbox against a privileged process concurrently changing the filesystem.
