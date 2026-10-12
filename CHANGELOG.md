# Changelog

## 0.1.1 — unreleased

- Resolve the CLI launch path before checking its entry point so npm's Unix bin symlinks start the command correctly. Keep all CI matrix jobs running when one fails to retain compatibility evidence.

- Build distribution files before packing; verify installation, CLI execution and ESM exports from the packed artifact.
- Replace the vulnerable glob dependency chain with bounded picomatch matching.
- Constrain configured project roots and fixture paths; reject symbolic links and junctions within checked paths, bound reads and recheck opened file identity.
- Redact complete common credentials, including bearer/basic headers, diagnostic filenames and suppression reasons; escape terminal controls.
- Refuse existing output files and unsafe output paths. Reports now require a new filename; `init` continues to refuse existing configurations.
- Bound file size, aggregate source size, directory traversal, ignore patterns and parser nesting. Unsupported, malformed or excessive source becomes unverified rather than an apparent clean result.
- Handle invalid mapping entries without internal rule failures; avoid contradictory mapping passes and obvious unrelated `domo` binding diagnoses.
- Recognize direct datastore endpoints as unverified AppDB usage. Disclose HTML inline-script and scope-resolution limits.
- Expand regression tests and full-source coverage; configure OS/Node CI and secret scanning. See `audit-reports/RELEASE_READINESS.md` for executed checks and remaining release gates.
