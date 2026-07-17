# Security Policy

Forge Studio orchestrates autonomous agents that can hold **live credentials**
— GitHub (`gh`) and Azure DevOps (ADO) tokens, supplied per-project via a
gitignored `secrets.env` (see [`docs/getting-started.md`](./docs/getting-started.md)).
Treat any credential-handling, prompt-injection, or supply-chain finding as a
security issue, not an ordinary bug.

## Supported Versions

Forge Studio is pre-1.0 (`0.x`, see [`CHANGELOG.md`](./CHANGELOG.md)). Only
the latest `0.x` release on `main` receives security fixes — there is no
long-term-support branch yet.

| Version         | Supported |
| --------------- | --------- |
| `0.x` (latest)  | ✅         |
| `0.x` (older)   | ❌         |

## Reporting a Vulnerability

**Do not open a public issue for a security vulnerability.**

Report privately through GitHub's built-in advisory flow:

1. Go to the **Security** tab of this repository.
2. Select **Report a vulnerability**.
3. Describe the issue, the affected version or commit, and reproduction
   steps.

This opens a private security advisory visible only to the maintainer until
a fix ships. There is no monitored email address for this project — GitHub
private reporting is the only supported disclosure channel.

## What counts

- Leakage or mishandling of injected credentials (`secrets.env`, `gh` / ADO
  tokens) across the forge↔project boundary.
- Prompt-injection or tool-use vectors that let a managed project's content
  (issue text, PR bodies, source) escalate into unattended agent actions
  outside the forge↔project contract
  ([`docs/forge-project-contract.md`](./docs/forge-project-contract.md)).
- Anything that lets an agent-authored change bypass the three structural
  human gates (architect, review, reflect — see [`ARCHITECTURE.md`](./ARCHITECTURE.md)).
- Supply-chain issues in forge's own dependencies.

## What forge already does

- Secrets are never committed: `.gitignore` excludes `secrets.env` and
  `*.env` (keeping `*.env.example`), and the same convention is enforced in
  every onboarded managed project.
- CI runs with no live credentials — tests run against injected mocks with
  `FORGE_ARCHITECT_NO_SPAWN=1` set; the real-money regression harness
  (`npm run verify:cycle`) is operator-gated and never runs in CI.

## Response

This is a single-maintainer project. Reports are acknowledged as promptly as
that allows; there is no formal SLA while the project is pre-1.0.
