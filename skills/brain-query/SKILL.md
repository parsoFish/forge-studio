---
name: brain-query
description: Efficient lookup against the brain. Mandated as the first action of every other skill. Logs gaps so the next ingest pass can fill them.
phase: brain
surface: unattended
model: claude-haiku-4-5
---

# Brain — Query

## Single responsibility

Answer a question against the brain wiki, citing source files. Log unanswered or low-confidence queries as **gaps** for `brain-ingest` to address.

This skill is invoked **first** by every other skill, per [ADR 010](../../docs/decisions/010-brain-first.md).

## Inputs

- A natural-language question or list of questions.
- Optional: project scope (constrains query to `brain/projects/<name>/`).
- Optional: category scope (`pattern` | `antipattern` | `decision` | `operation` | `reference`).

## Outputs

- A structured response:
  ```ts
  {
    answers: Array<{
      question: string;
      answer: string;             // synthesised answer
      confidence: 'high' | 'medium' | 'low';
      sources: string[];          // brain file paths
      gap?: boolean;              // true if confidence is low or no source found
    }>;
  }
  ```
- For each `gap: true` answer, append to `_logs/<cycle-id>/brain-gaps.jsonl`.

## Event-log entries to emit

- `brain-query.start` — with the questions.
- `brain-query.hit` — one event per question that found high/medium-confidence sources.
- `brain-query.gap` — one event per question with low/no confidence.
- `brain-query.end` — summary.

## Benchmark suite

Primary owner of [`benchmarks/brain/`](../../benchmarks/brain/) — `questions.json` + `score.ts`. Accuracy + latency + source-correctness are the scored metrics.

## Process

1. Parse the question. Identify keywords + likely category.
2. Search:
   - Theme pages: grep `brain/forge/themes/` and `brain/projects/<scope>/themes/` for keywords; load matching pages.
   - Category indexes: cross-reference theme matches against the index hierarchy.
   - Raw layer: only if theme matches are insufficient — grep `brain/_raw/` and load the most relevant.
3. Synthesise an answer from the loaded content. Cite sources by file path (not by content quote — the caller can read the source itself).
4. Score confidence:
   - **High:** ≥ 2 corroborating sources, all on-topic.
   - **Medium:** 1 source on-topic, or multiple loosely related.
   - **Low / gap:** no good source, or only off-topic matches. Mark `gap: true` and log.
5. Return.

## Constraints

- **Cite, don't paraphrase deeply.** The caller can read the linked file. Synthesis is a one-paragraph answer + source list, not a full essay.
- **Fast model by default.** Haiku is the default; per-skill override via the calling skill's frontmatter if a question genuinely needs more.
- **Gaps are logged, not silently failed.** If the brain doesn't know, the brain learns by the next ingest pass.
- **No web fallback in this skill.** Broader research is the *calling* skill's responsibility (after this skill's gap event is logged); separation of concerns.
