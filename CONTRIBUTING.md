# Contributing

Contributions should keep offline behavior deterministic and preserve the distinction between confirmed findings, skipped checks, and unverified checks.

## Local workflow

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run format:check
```

Add a focused fixture and automated test for each new rule. Prefer official Domo documentation for behavior claims. Do not add live network access, telemetry, project code execution, or credential handling to the default scan. Keep CLI output deterministic and avoid printing source contents.

## Pull requests

Describe the rule behavior, evidence source, confidence limits, test coverage, and any new dependencies. Update the README rule catalog and limitations when behavior changes. Do not publish packages or use production Domo credentials as part of a contribution.
