---
id: code-diff
name: Code diff
phase: present
description: Shows the meaningful diff of the changed files for the initiative.
configHint: Optional glob(s) of the load-bearing files to feature (e.g. "src/toc.ts"). Empty = the agent picks the salient diff.
---

# Demo element — Code diff

A skill-creating skill. Author a project-side element-skill at
`.forge/skills/demo/code-diff/SKILL.md` that renders ONE HTML fragment showing the
*meaningful* diff an initiative introduced — the load-bearing change, not every
line.

The generated element-skill must:
- Use `git diff` between the baseline and changed states (scoped to the configured
  globs when given, else the agent selects the salient files).
- Emit an HTML fragment using the Forge demo classes — a `pre` of the diff with
  added/removed lines visually distinguished, inside a `.demo-card`, led by a
  one-line caption of what the diff accomplishes.
- Keep it focused: trim noise (lockfiles, generated output); feature the change
  that matters.
