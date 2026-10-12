# Distribution findings — 2026-10-12

## Scope and verdict

Independent distribution audit on Windows with Node 22.22.0, npm 10.9.4, and Yarn 1.22.22. Published package and local candidate are separate artifacts. No publishing, source changes, user-global installation, credential reads, or authenticated npm account queries were performed.

**Published `domo-doctor@0.1.0` is unusable and blocks public launch.** Registry latest still points to 0.1.0. The downloaded tarball has exactly LICENSE, package.json, CONTRIBUTING.md, README.md, SECURITY.md, with no dist tree. A clean isolated npm install itself succeeds, but direct CLI execution fails MODULE_NOT_FOUND and package ESM import fails ERR_MODULE_NOT_FOUND. This is reproduced evidence, not an inference from local source.

**Local candidate `0.1.1` passes tested installation/distribution workflows on this Windows/Node22 environment.** This alone does not establish security or cross-platform readiness. It has not been published. Parent audit owns implementation/security verdict and final release candidate validation.

## Published artifact evidence

- Current public registry metadata is retained in `evidence/distribution/npm-metadata.json`.
- Registry tarball URL: https://registry.npmjs.org/domo-doctor/-/domo-doctor-0.1.0.tgz
- SHA1: 1305093e5e89a0d247595dea32fbd614d13d3804.
- SHA512: sha512-86x1OioKPFgtJzmnsW3uxyJPwKm/s5/Zwu/COQ2+PokBxEwnsRKOfe84V53y1jMMj0r+okDtBM2tw82SOGK3Hg==.
- Downloaded bytes independently match both registry checksums (`integrity-review.json`).
- Tar entries are ordinary files with 0644 permissions; no published executable exists.
- Published scripts were inspected before execution: no preinstall/install/postinstall/prepare lifecycle hooks. Source build/test scripts exist in metadata but supporting source/scripts are absent from published files.
- Registry signatures are listed; published dist metadata contains no provenance attestation. Checksums and registry signatures establish artifact consistency, not code safety or maintainer identity assurance.
- Public maintainer/publisher metadata identifies one maintainer. Account 2FA, token scopes, recovery controls, domain ownership, and organization ownership cannot be verified from this public metadata; do not claim they were reviewed.

## Candidate artifact and install matrix

Candidate staged from current package metadata/docs/dist only and packed with `--ignore-scripts` so this independent audit did not run a concurrent root build. Snapshot has 61 files and no unexpected root entries; all files are distribution JS/declarations/maps plus the five documented metadata/doc files. SHA512 and full file list are saved in candidate-pack.json and candidate-file-list.txt. Parent changes after this snapshot require a new final release pack check.

| Check                                                                                       | Result                                                                  |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Upgrade isolated consumer 0.1.0 -> 0.1.1 tarball                                            | Pass                                                                    |
| Offline local npx --help / --version                                                        | Pass; reports 0.1.1                                                     |
| ESM package-name named import createDoctor                                                  | Pass; function                                                          |
| CommonJS require                                                                            | ERR_PACKAGE_PATH_NOT_EXPORTED; matches package's ESM-only import export |
| Candidate reinstall                                                                         | Pass                                                                    |
| Candidate uninstall and require.resolve absence                                             | Pass; MODULE_NOT_FOUND after uninstall                                  |
| Candidate clean fresh npm install                                                           | Pass                                                                    |
| Isolated `npm --global --prefix evidence/distribution/global-prefix` install/help/uninstall | Pass; never user-global                                                 |
| Normal npm install after lifecycle inspection                                               | Pass                                                                    |
| Yarn1 isolated tarball install and offline CLI version                                      | Pass                                                                    |
| pnpm                                                                                        | Unavailable: installed shim points to missing pnpm 12.6.0 module        |
| Linux/macOS                                                                                 | Not tested                                                              |
| Node20/Node24                                                                               | Not tested; only Node22 runtime available in inspected installation     |

Candidate CLI starts with `#!/usr/bin/env node`. Tar metadata reports 0644 for the CLI. Windows npm/yarn shims work; Unix executable behavior must be verified in Linux/macOS CI rather than inferred from Windows. npm normally chmods installed bin targets, but that was not independently exercised here. Require support must not be advertised as implemented; consumers can use dynamic import from CommonJS if appropriate.

## Dependency and supply-chain results

Candidate production dependency audit on the fresh consumer reports 0 known vulnerabilities. Resolution is not frozen for downstream installs: package metadata uses caret ranges and package-lock.json is not included in the tarball. Current resolution includes commander14.0.3 and zod4.6.6, which differ from minimum declared versions. Retain final consumer lock evidence and rerun audit before publishing.

Root lockfile is version3, all resolved entries use https://registry.npmjs.org and have integrity digests. The only hasInstallScript flag is optional dev dependency fsevents; this is not a candidate production dependency. Final installed production dependencies were inspected and have no preinstall/install/postinstall/prepare hooks. npm audit signatures verified 6 registry dependency signatures and 1 dependency attestation; the locally installed tarball itself is not a registry-published/provenanced candidate. Do not attribute the dependency attestation to domo-doctor.

## Evidence interpretation

`checks.log` contains one failed audit-helper enumeration caused by an empty scoped directory left after upgrading away from fast-glob. This was an audit helper issue, not package execution; corrected dependency enumeration is retained separately in `installed-dependencies.json`. All substantive candidate commands listed above passed. `run-checks.ps1` reproduces the isolation strategy. Installation evidence folders retain node_modules to permit follow-up examination and are audit artifacts, not project runtime dependencies.

Recommended release gates: finish source/security review; run Linux/macOS and Node20/22/24 package smoke checks; pack final exact candidate after all edits; install/test that tarball in pod_demo; publish corrected version only after explicit release authorization, then verify exact registry bytes and CLI/import behavior anew. Existing 0.1.0 remains broken until the corrected release updates latest.
