---
name: brain-query
description: Efficient lookup against the brain via markdown keyword scan. Logs gaps so the next ingest pass can fill them. Accepts a scope parameter to target the right brain: forge-dev, cycles, project, or all.
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

| Scope | What to search |
|---|---|
| `forge-dev` | `brain/forge-dev/themes/` + category indexes |
| `cycles` | `brain/cycles/themes/` + category indexes |
| `project` | `<project-repo>/brain/themes/` + `profile.md` |
| `all` | union of all three (emit a scope-missing warning) |

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
    gap?: boolean;              // true if confidence is low or no source found
  }>;
}
```

For each `gap: true` answer, append to `_logs/<cycle-id>/brain-gaps.jsonl`.

## Event-log entries to emit

- `brain-query.start` — with the questions.
- `brain-query.hit` — one event per question that found high/medium-confidence sources.
- `brain-query.gap` — one event per question with low/no confidence.
- `brain-query.end` — summary.

## Process

### Keyword scan (all scopes)

1. Read the relevant category index for the scope:
   - Brain 1 (forge-dev): `brain/forge-dev/decisions.md` or `brain/forge-dev/reference.md`
   - Brain 2 (cycles): `brain/cycles/patterns.md`, `antipatterns.md`, `operations.md`, or `decisions.md`
   - Brain 3 (project): `brain/profile.md` + `brain/themes/` listing
2. Read 2–5 theme files whose slugs or one-liners match the question keywords.
3. **Synthesise + cite.** Write a one-paragraph answer preserving exact terminology from the cited themes. Cite by file path. Score confidence:
   - **High:** ≥ 2 corroborating themes, all on-topic.
   - **Medium:** 1 source on-topic.
   - **Low / gap:** no good source — set `gap: true`.
4. If still nothing after reading the category index + 2–3 theme candidates, mark `gap: true`.

## Constraints

- **Cite, don't paraphrase deeply.** Synthesis is a one-paragraph answer + source list. The caller can read the linked file.
- **Cite theme pages only.** Valid `sources` entries are `brain/cycles/themes/<slug>.md`, `brain/forge-dev/{log.md,decisions.md,reference.md}`, and `<project-repo>/brain/{profile.md,themes/<slug>.md}`. Never cite `brain/cycles/_raw/*` (inputs to synthesis, not citations) or category indexes (navigation, not knowledge).
- **Exhaustive on theme coverage.** Recall matters — under-citing (missing the corrective antipattern) is worse than over-citing by 1–2 extras.
- **Scope is load-bearing.** When `scope: project`, cited sources MUST come from inside the project's own brain. Do not pull in forge-dev concepts not documented in the project brain — that's hallucination.
- **Missing scope defaults to `all` + warn.** Emit: `[brain-query] no scope supplied — searching all three brains; supply --scope to reduce noise`.
- **Gaps are logged, not silently failed.** If the brain doesn't know, the brain learns by the next ingest pass. Naming-the-absence without `gap: true` is the worst failure mode.
- **No web fallback in this skill.** Broader research is the *calling* skill's responsibility.
- **Fast model by default.** Haiku is the default; per-skill override via the calling skill's frontmatter.
