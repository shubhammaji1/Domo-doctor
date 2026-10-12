# Published 0.1.1 verification — 12 October 2026

The registry initially returned latest 0.1.0 and E404 for 0.1.1 while npm reported processing the publication. A subsequent public registry check returned latest 0.1.1 with that version available. Publication availability was verified; the earlier unreleased-candidate assessment is historical.

A fresh isolated consumer installed `domo-doctor@0.1.1` from npm using `--ignore-scripts --no-audit --no-fund`. Seven packages were added. Installed `npm exec --offline -- domo-doctor --version` returned 0.1.1. A package-name ESM import exposed `createDoctor` successfully. This checks the public release, rather than the local build.

The installed registry CLI scanned pod_demo with an external configuration selecting `public/manifest.json`: exit0, version0.1.1, zero errors/warnings, four passed, three skipped and ten unverified results. [Report](evidence/published-011-pod-demo.json). No application code or live Domo API was executed; pod_demo's Git status remained clean. The ten unverified findings retain the previously documented HTML, AppDB and proxy limits.

The exact npx command still returned “not recognized” when run inside Domo-doctor's own package repository. The same command succeeded from pod_demo:

```powershell
Set-Location D:\GWC\Projects\POCs\pod_demo
npx --yes --prefer-online domo-doctor@0.1.1 --version
```

Actual stdout: `0.1.1`, exit0. This distinguishes npm's local project resolution behavior from a missing published executable. There is no evidence from this failure that the new registry tarball lacks its CLI. Source-repository development can use `node dist/cli/index.js --version` after building.

The isolated consumer was removed after verification. No package republish, dist-tag change, Git push, or pod_demo file edit was performed. Live Domo runtime correctness remains outside this offline verification.
