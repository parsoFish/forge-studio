---
name: brain-query
description: Efficient lookup against the brain. Consults the structural graph for Brain 1/3 (per-brain graphify-out/), then keyword-scans themes. Logs gaps so the next ingest pass can fill them. Accepts a scope parameter to target the right brain: forge-dev, cycles, project, or all.
phase: brain
surface: unattended
model: claude-haiku-4-5
---

# Brain — Query

## Single responsibility

Answer a question against the brain wiki, citing source files. Log
unanswered or low-confidence queries as **gaps** for `brain-ingest` to
address.

This skill is invoked **first** by every other skill, per [ADR 010](../../docs/decisions/010-brain-first.md).

## Scope routing

| Scope | What to search | Graph available? |
|---|---|---|
| `forge-dev` | `brain/forge-dev/` themes + forge source tree | Yes — `brain/forge-dev/graphify-out/graph.json` |
| `cycles` | `brain/cycles/themes/` + category indexes | No — keyword scan only (BRN-3: cycles graph dropped) |
| `project` | `<project-repo>/brain/themes/` + `profile.md` | Yes — `<project-repo>/brain/graphify-out/graph.json` |
| `all` | union of all three (emit a scope-missing warning) | forge-dev + project graphs; cycles keyword-scan |

**Role defaults** (the calling skill or orchestrator should supply these):

| Role | Default scope |
|---|---|
| architect / PM | `cycles,project` (Brain 2 + the cycle's Brain 3) |
| reflector | `all` (loose read access; reflector is operator-coupled) |
| dev-loop / reviewer | `project` (Brain 3 of the cycle's project ONLY) |
| forge-dev session (no cycle) | `forge-dev,cycles` (Brain 1 + Brain 2) |

## Inputs

- A natural-language question or list of questions.
- Optional: `scope` — which brain(s) to search (see table above).
- Optional: `project` name — required when `scope=project`.
- Optional: category filter (`pattern` | `antipattern` | `decision` | `operation` | `reference`).

## Outputs

```ts
{
  answers: Array<{
    question: string;
    answer: string;             // synthesised answer
    confidence: 'high' | 'medium' | 'low';
    sources: string[];          // brain file paths (theme pages only — not raw, not category indexes)
    structural_neighbours?: string[]; // theme ids found via graph (Brain 1/3 only; informational)
    gap?: boolean;              // true if confidence is low or no source found
  }>;
}
```

For each `gap: true` answer, append to `_logs/<cycle-id>/brain-gaps.jsonl`.

## Event-log entries to emit

- `brain-query.start` — with the questions.
- `brain-query.graph-hit` — one event per question where the graph contributed at least one source (Brain 1/3 only).
- `brain-query.hit` — one event per question that found high/medium-confidence sources.
- `brain-query.gap` — one event per question with low/no confidence.
- `brain-query.end` — summary.

## Process

### For Brain 1 (forge-dev) and Brain 3 (project) — graph-assisted

1. Run ONE `graphify` call against the scope's graph. Pick the operation by question phrasing:
   - structural / "what bridges A and B" → `graphify path "<A>" "<B>" --graph <path>`
   - "describe/what's near <X>" → `graphify explain "<X>" --graph <path>`
   - "what implements/uses <X>" → `graphify affected "<X>" --graph <path>`
   - free-form content question → `graphify query "<question>" --graph <path>`

   The graph returns a small set of candidate node ids (paths). Read those files with the `Read` tool (typically 2–5 themes).

2. **Synthesise + cite.** Write a one-paragraph answer preserving exact terminology from the cited themes. Cite by file path. Score confidence:
   - **High:** ≥ 2 corroborating themes, all on-topic.
   - **Medium:** 1 source on-topic.
   - **Low / gap:** no good source — set `gap: true`.

3. **Fallback (rare).** If the graph returns an empty subgraph AND the question seems answerable from the brain, read the category index or `brain/INDEX.md` to find candidates. Grep is NOT an option — the graph is the index. After one `graphify` + one `Read` of an index, if still nothing, mark `gap: true`.

### For Brain 2 (cycles) — keyword scan only

Brain 2 has no graph (cycles themes have 0 relational edges — BRN-3). Use keyword scan:

1. Read the relevant category index (`brain/cycles/patterns.md`, `antipatterns.md`, `operations.md`, or `decisions.md`) to find candidate slugs.
2. Read 2–5 matching theme files.
3. Synthesise + cite as above.

## Node id conventions (Brains 1 and 3)

| Brain | Theme node id |
|---|---|
| forge-dev | `brain/forge-dev/themes/<slug>.md` or `<forge-source-path>` |
| project | `brain/themes/<slug>.md` (relative to the project repo root) |

Category indexes: `brain/forge-dev/{decisions,reference}.md`; project: `brain/profile.md`.

## Constraints

- **Cite, don't paraphrase deeply.** Synthesis is a one-paragraph answer + source list. The caller can read the linked file.
- **Cite theme pages only.** Valid `sources` entries are `brain/cycles/themes/<slug>.md`, `brain/forge-dev/{log.md,decisions.md,reference.md}`, and `<project-repo>/brain/{profile.md,themes/<slug>.md}`. Never cite `brain/cycles/_raw/*` (inputs to synthesis, not citations) or category indexes (navigation, not knowledge).
- **Exhaustive on theme coverage.** Recall matters — under-citing (missing the corrective antipattern) is worse than over-citing by 1–2 extras.
- **Scope is load-bearing.** When `scope: project`, cited sources MUST come from inside the project's own brain. Do not pull in forge-dev concepts not documented in the project brain — that's hallucination.
- **Missing scope defaults to `all` + warn.** Emit: `[brain-query] no scope supplied — searching all three brains; supply --scope to reduce noise`.
- **Gaps are logged, not silently failed.** If the brain doesn't know, the brain learns by the next ingest pass. Naming-the-absence without `gap: true` is the worst failure mode.
- **No web fallback in this skill.** Broader research is the *calling* skill's responsibility.
- **Fast model by default.** Haiku is the default; per-skill override via the calling skill's frontmatter.

## Sources

- `brain/forge-dev/graphify-out/graph.json` — structural index for forge code + ADRs (Brain 1).
- `<project-repo>/brain/graphify-out/graph.json` — structural index for project brain + project source tree (Brain 3).
- See [`skills/brain-graph/SKILL.md`](../brain-graph/SKILL.md) for how each graph is built and maintained.
