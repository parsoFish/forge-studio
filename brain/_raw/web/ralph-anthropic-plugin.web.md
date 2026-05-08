---
source_type: web
source_url: https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
source_title: Anthropic's official Ralph Wiggum plugin
ingested_at: 2026-05-04T18:00:00Z
ingested_by: brain-ingest (Pass A, batch 4)
cycle_id: pass-a-bootstrap
---

# Anthropic's Ralph Wiggum Plugin Structure

## Files Shipped

- `.claude-plugin` — Plugin configuration.
- `commands/` — Command implementations.
- `hooks/` — Integration hooks (including `stop-hook.sh`).
- `scripts/` — Utility scripts.
- `README.md` — Documentation.

## Core Mechanism

**Stop Hook Pattern**: the plugin uses a **Stop hook** that intercepts Claude's exit attempts, creating a self-referential feedback loop **within a single session**:

```
1. User runs /ralph-loop once
2. Claude works on task
3. Claude tries to exit
4. Stop hook blocks exit
5. Stop hook feeds SAME prompt back
6. Repeat until completion
```

No external bash loops needed — the loop happens inside the current Claude Code session.

## Canonical Command Usage

```bash
/ralph-loop "Your task description" --completion-promise "DONE" --max-iterations 50
```

**Required Options:**

- `--completion-promise "<text>"` — Exact string that signals completion.
- `--max-iterations <n>` — Safety limit (highly recommended).

## Prompt Template Shape

```
[Clear task description]

When complete:
- Success criterion 1
- Success criterion 2
- Output: <promise>COMPLETE</promise>
```

## Stop Conditions

1. **Exact string match** on `--completion-promise` (e.g., `<promise>COMPLETE</promise>`).
2. **`--max-iterations` limit** reached (primary safety).
3. **`/cancel-ralph`** command to manually abort.

Critical: completion promise uses exact string matching only — cannot specify multiple completion conditions. Rely on `--max-iterations` as primary safety.

## Integration with Claude Code

- Plugin system: ships in `/plugins/ralph-wiggum/`.
- Hook integration: `stop-hook.sh` in `hooks/` intercepts session exit.
- Command system: `/ralph-loop` and `/cancel-ralph`.
- Persistent context: previous work persists in files; each iteration sees modified files and git history.

## Usage Philosophy

**Best for**: well-defined tasks with clear success criteria, greenfield projects, tasks with automatic verification (tests).

**Not for**: tasks requiring human judgment, one-shot operations, unclear success criteria, production debugging.
