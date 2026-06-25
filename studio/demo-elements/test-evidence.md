---
id: test-evidence
name: Test evidence
phase: verify
description: Runs the project's quality gate and shows the real result as proof the change is sound.
configHint: The gate command to run (defaults to the project's quality_gate_cmd, e.g. "npm test").
---

# Demo element — Test evidence

A skill-creating skill. Author a project-side element-skill at
`.forge/skills/demo/test-evidence/SKILL.md` that runs the project's quality gate on
the changed code and renders ONE HTML fragment presenting the REAL result as
verification that the initiative's change is sound.

The generated element-skill must:
- Run the configured gate (or the project's `quality_gate_cmd`) with Bash on the
  changed tree and capture the real summary (pass/fail counts, key lines). Never
  fake a green run; if it fails, show the failure honestly.
- Emit an HTML fragment using the Forge demo classes — a compact result row
  (`.badge-ok` / `.badge-warn`) plus the salient output in a `pre`, inside a
  `.demo-card`, led by a one-line caption ("the change is proven by …").
- This is evidence, not a test-name table: show the actual run.
