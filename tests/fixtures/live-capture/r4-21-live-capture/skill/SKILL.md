---
name: live-proof-skill
description: Summarise a git diff into three bullet points — what changed, why it matters, and what to test.
---

# Live Proof Skill

Given a git diff (passed inline or read from the working tree), produce a concise three-bullet summary that helps a reviewer quickly understand the change without reading every line.

## Output format

Always return exactly three bullets, in this order:

- **What changed** — a plain-English description of the code, config, or content that was modified, added, or removed.
- **Why it matters** — the functional or business impact of the change: what behaviour shifts, what problem it solves, or what risk it introduces.
- **What to test** — the specific scenarios, edge cases, or regression areas a reviewer or QA pass should exercise before merging.

## Usage

Invoke this skill with the diff text as context. If the diff is large, focus on the most structurally significant hunks rather than cataloguing every line change. Keep each bullet to one or two sentences — clear and scannable, not exhaustive.

## Constraints

- Do not add more than three bullets.
- Do not omit any of the three bullets, even if the diff is trivial.
- If the diff is empty or unavailable, say so explicitly rather than fabricating a summary.
