---
id: security-report
name: Security Report
kind: file
producer: security-auditor
schema:
  requiredFiles:
    - security-report.md
  requiredFields:
    - findings
---

# Security-report artifact contract

The security-auditor agent's ranked audit findings: `findings[]` (`severity`,
`cvss`, `category` ∈ secret|injection|dependency|insecure-default|crypto,
`location`, `message`, `remediation`) plus a `## Verdict` line (`clean` |
`findings`). Emitted by the standalone `security-scan` flow or a `security-audit`
node inserted into a cycle.

- **Producer:** security-auditor.
- **Consumer:** the operator (security-scan is disposable) or a downstream gate.
