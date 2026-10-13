# Automatic manifest discovery

Date: 2026-10-13. Release candidate: 0.1.3.

The scanner previously assumed `manifest.json` was in the project root. This caused valid projects with `public/manifest.json` to report a missing manifest unless each user created a configuration file.

## Behavior

- An explicit `manifest` setting always wins. Missing or malformed configured files are reported without falling back to a different manifest.
- With no manifest setting, a root `manifest.json` takes precedence.
- Otherwise, a single manifest in `public`, `src`, or `static` is selected automatically.
- Multiple source candidates produce an actionable ambiguity error. Generated `dist` and `build` copies are never selected automatically; users can explicitly scan a built directory or configure a custom path.
- The selected project-relative path is included in the manifest result.
- Existing regular-file, symlink/junction, project-boundary, and input-size protections remain enforced.

## Verification

`npm run prepublishOnly` passed: 133 tests, 30 self-test assertions, type checking, lint, formatting, coverage thresholds, installed-tarball CLI/library smoke checks, and a production dependency audit with zero vulnerabilities. The tarball smoke fixture now uses `public/manifest.json` with no configuration file.

The temporary `pod_demo/domo-doctor.config.json` workaround was removed. Scanning the actual POD_DEMO project with the local candidate automatically selected `public/manifest.json` and returned zero errors, zero warnings, six passed, four skipped, and two unverified live checks. Application source and the installed 0.1.2 dependency were not changed.

The fix is local and unpublished. Until 0.1.3 is published and installed, the existing 0.1.2 package retains its root-only default behavior.
