---
name: docs-write
description: Use when writing or rewriting a page of forge's published documentation (apps/docs). Covers picking the page type, the template, drafting from current code, the mandatory cut pass, banned content, and the reader test.
---

# docs-write

Write the shortest page that answers the reader. Every step logs an event so the run is auditable.

## Procedure

1. Log the start: `node --experimental-strip-types scripts/skill-event.mjs docs-write start page=<path>`

2. Pick ONE page type and respect its ceiling in prose words (frontmatter, code blocks and tables excluded):

   | Type | Ceiling |
   |---|---|
   | guide | 1,000 |
   | how-to | 800 |
   | reference, explanation | 2,000 prose |
   | landing | 600 |

   A how-to is generated from a story, never hand-written. If asked for one, stop and point at `tests/stories/`.

   These are ceilings, never targets. A shorter page that answers the reader is better. Never pad toward a ceiling.

3. Use the template for the type.
   - **Guide**: frontmatter (`title`, `description` at most 160 chars, `type`, `owner`, `last_verified`, `covers: [globs]`) · lead of at most 50 words · optional "Before you start" (at most 3 bullets) · "Set up" (say where, not every click) · task-named sections · "Troubleshooting" (only confusions seen in real runs) · "Related" (at most 3 links, reference first).
   - **Reference**: one line saying what it is · Shape · Fields table · Examples (complete, tested) · Limits. Generate reference from schemas or `--help` output rather than hand-writing it.

4. Draft from the CURRENT code. Read what the page's `covers:` globs point at. Never draft from older docs.

5. **Cut pass** (always, after every draft).
   - List each removed sentence or paragraph with a one-word reason: redundant, history, filler, internal, future.
   - Record words before and after with `node scripts/check-docs-budget.mjs --report` (or its counter).
   - Log: `node --experimental-strip-types scripts/skill-event.mjs docs-write cut page=<path> words_before=<n> words_after=<n>`

6. **Banned content** (guides and reference):
   - decision-record numbers or paths, milestone or bead ids
   - history narration ("previously", "used to", "moved from", "no longer")
   - `data-*` attributes (guides)
   - `packages/...` or `apps/...` paths (guides)
   - filler ("simply", "just", "easily", "in order to", "please note")
   - future promises ("will be", "coming soon", "planned")

   Vocabulary: published pages say "Knowledge", never "Brain".

7. **Reader test.** Dispatch the `docs-reader-test` subagent with the page path and 5 to 10 questions a technical-but-new reader would ask. It answers from the page alone.
   - Pass means every question is answered correctly from the page.
   - Record the concision score it returns.
   - Between two passing drafts, the shorter one wins.
   - A page above 70 % of its ceiling must state in the PR body why it needs the length.
   - On a fail, fix the page (usually by adding the missing fact and cutting something else), then re-run the cut pass and the test.

8. Log the end: `node --experimental-strip-types scripts/skill-event.mjs docs-write end page=<path> verdict=<pass|fail> words=<n> reader_score=<x/y>`

9. PR body carries:
   - words before and after, per page
   - pages above 70 % of ceiling, each with its reason
   - the `Docs impact:` line
