---
id: cli-capture
name: CLI before/after
phase: capture
description: Runs a command on the baseline and the changed code and shows the real stdout side-by-side.
configHint: The command to run (e.g. "node bin/mdtoc.js --write README.md").
---

# Demo element — CLI before/after

A skill-creating skill. Author a project-side element-skill at
`.forge/skills/demo/cli-capture/SKILL.md` that, given an initiative's before/after
(a baseline checkout/SHA and the changed tree) and the configured command, renders
ONE self-contained HTML fragment showing the command's REAL stdout on the baseline
vs the changed code, side by side.

The generated element-skill must:
- Run the exact configured command on both states with Bash and capture real
  stdout/stderr (truncate sensibly). Never fabricate output.
- Emit an HTML fragment using the Forge demo classes (`.demo-card`,
  `.demo-compare`, `pre`, `.chip`) — a labelled before column and after column.
- Lead with a one-line caption of what changed in this command's behaviour.
- Be deterministic: same inputs ⇒ same fragment (so the demo reproduces).
