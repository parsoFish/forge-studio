---
id: narrative
name: Narrative essence
phase: present
description: A tight prose lead — what the initiative changed and why it matters — opening the demo.
configHint: Optional angle/emphasis for the prose (e.g. "lead with the operator benefit"). Empty = the agent writes the essence.
---

# Demo element — Narrative essence

A skill-creating skill. Author a project-side element-skill at
`.forge/skills/demo/narrative/SKILL.md` that renders ONE short HTML fragment — the
demo's lead: a one-to-three sentence essence of what THIS initiative changed and
why it matters, grounded in the actual change (not marketing).

The generated element-skill must:
- Derive the essence from the real diff / commit messages of the initiative, not
  generic claims.
- Emit a compact HTML fragment using the Forge demo classes (`.demo-head`,
  `.essence`) — a heading + the essence line — suitable as the page opener.
- Stay honest and specific; no superlatives.
