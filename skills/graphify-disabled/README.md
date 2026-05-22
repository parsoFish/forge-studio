# graphify auto-skill — disabled (placeholder)

The `graphifyy` npm package ships its own auto-installable Claude Code
skill at `node_modules/graphifyy/src/skills/skill.md` (1382 lines). Forge
discipline (C22) mandates hand-authored skills — the canonical forge-owned
skill is [`skills/brain-graph/SKILL.md`](../brain-graph/SKILL.md), with a
deliberately narrower 4-operation surface (`update | query | report |
install-hook`) suited to the forge brain.

## Why this directory exists

S1.4's AC9 requires that graphify's auto-skill be moved aside rather than
adopted as-is. In practice, `npm install graphifyy@0.9.1` did NOT auto-write
to `.claude/skills/` — graphify only installs that skill when the operator
explicitly runs `npx graphify install claude`. So no auto-skill was
generated for forge to relocate. This directory is the placeholder that
documents the intent: if a future version of graphify starts auto-installing
on `npm install`, the install must land here (or under
`.claude/skills/graphify-disabled/`) so the operator can audit it before
forge adopts it.

## Comparing the two surfaces

If you want to compare forge's hand-authored skill against graphify's
auto-skill, read:

```
node_modules/graphifyy/src/skills/skill.md
```

The structural differences:

| Aspect | graphify auto-skill | forge `brain-graph` |
|---|---|---|
| scope | any corpus | `brain/` only (C20 scope) |
| trigger | `/graphify` | invoked by `brain-query`, lint, reflect |
| operations | ~15 (clone, detect, extract, OCR, viz, MCP, watch, query, summary, path, explain, …) | 4 (`update`, `query`, `report`, `install-hook`) |
| LLM dependency | required for non-code corpora | optional — forge ships a deterministic structural extractor |
| state location | `.graphify/` under cwd | `brain/graph.json` (committed, per C21) |
| audit shape | per-edge `EXTRACTED \| INFERRED \| AMBIGUOUS` | same — same edge schema |

Operator: re-evaluate this trade-off after the first real query session
where graph-first lookup is exercised against `brain/graph.json`.
