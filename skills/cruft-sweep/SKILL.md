---
name: cruft-sweep
description: Rule-based, directory-by-directory cleanup of generated/abandoned/scratch cruft from the forge tree. Every removal is justified by an EXPLICIT rule, never a hardcoded path, so the rule set stays auditable and adjustable. Reports a plan before deleting; deletes nothing matched by a SAFETY exclusion.
phase: maintenance
surface: interactive
model: claude-sonnet-4-6
---

# Cruft Sweep

## Single responsibility

Walk the forge tree directory-by-directory and remove **cruft** —
regenerable, abandoned, or scratch artifacts that have leaked into the
working tree — where each removal is justified by an **explicit rule** in
the rule set below. The rule set is the contract: adjust the rules, not
ad-hoc delete commands. The skill is conservative: it produces a removal
**plan** first, honours every SAFETY exclusion, and only then deletes.

This is **not** a phase agent — it carries no `runtime` block and is not a
flow node. It is an operator-invoked housekeeping skill.

## Why rule-based, not a delete-list

A hardcoded delete-list rots the moment a new kind of scratch file appears,
and gives no way to reason about *why* a path is cruft. A rule set lets the
operator read each rule, see what it matches today, and add/remove rules as
the tree evolves. New cruft of a known shape is swept automatically; novel
cruft surfaces as an unmatched-but-suspicious report, never a silent delete.

## Rule set (explicit, adjustable)

Each rule is `id · match · rationale · action`. Match by **shape**, resolve
to concrete paths at run time, then apply the action. Order is top-to-bottom;
SAFETY exclusions (below) override every rule.

| id | match (glob / predicate) | rationale | action |
|---|---|---|---|
| `lint-dumps` | `_lint-*.txt`, `*-lint-before.txt`, `*-lint-after.txt` at repo root | one-off lint output snapshots; regenerate via the linter | `git rm` if tracked, else `rm` |
| `demo-galleries` | `demos/verify/**`, any `demos/**/*.webm` | regenerable demo capture output (the curated `e2e/` gallery + `index.html` stay — see `.gitignore`) | `rm -rf` (untracked) |
| `db-scratch` | `*.db`, `*.db-shm`, `*.db-wal`, `headroom_memory.db` at repo root | local SQLite scratch (e.g. headroom memory); never source | `rm` + ensure `*.db` is gitignored |
| `abandoned-worktrees` | any dir under `_worktrees/` whose path is **absent** from `git worktree list` | orphaned worktree the scheduler never cleaned (crash/abort) | `rm -rf` the orphan dir ONLY |
| `dead-brain-skeletons` | `brain/*-brain/` containing only `kb.yaml` + empty `_raw/` + empty `themes/` | scaffolded per-project brain stub with zero content; the real project brain lives in the project repo | `rm -rf` the empty skeleton |
| `generated-graph-out` | `graphify-out/`, `**/graphify-out/` | output of a removed graphify integration | `rm -rf` (untracked) |
| `design-mockups` | `mockups/` once its referencing comments are stripped | design scratch superseded by the shipped UI | `rm -rf` + strip the source comments that cite it |
| `pyc-pytest-cache` | `**/__pycache__/`, `**/.pytest_cache/` outside `node_modules` | language toolchain caches | `rm -rf` |
| `tmp-probes` | `scripts/.tmp-*` | convention-prefixed one-off diagnostic scripts | `rm` |
| `editor-os-noise` | `.DS_Store`, `*.swp`, `*.swo`, `*~` | editor / OS noise | `rm` |

To **add a rule**: append a row (shape + rationale + action). To **retire**
one: delete its row. Never bypass the table with a bare path delete.

## SAFETY exclusions (override every rule)

These are **never** deleted, even if a rule would match:

- Anything under `.claude/worktrees/**` — live sibling-agent worktrees.
- Anything **tracked** that is not explicitly a `git rm` action above.
- `_logs/`, `_queue/`, `projects/` contents that the runtime owns (state, not cruft).
- Any worktree path that **appears** in `git worktree list` (only orphans go).
- Secrets (`*.env`, `secrets.env`) and `forge.config.json`.
- The curated demo gallery (`demos/e2e/` PNGs + `index.html`).

When in doubt, the skill reports the path as `REVIEW` and does **not** delete it.

## Inputs

- The forge repo root (cwd).
- Optionally a `--rules <id,id,...>` allow-list to run a subset, or `--dry-run`.

## Outputs

- A removal **plan**: per rule, the concrete matched paths and the action.
- A `REVIEW` list: suspicious-but-unmatched paths for operator judgement.
- The applied result (what was removed) once the operator confirms.

## Event-log entries to emit

- `cruft-sweep.plan` — `{ rule, matches: string[] }` per rule.
- `cruft-sweep.skip` — `{ path, reason: 'safety-exclusion' | 'tracked' | 'live-worktree' }`.
- `cruft-sweep.removed` — `{ rule, path }` per removal.
- `cruft-sweep.review` — `{ path, note }` for unmatched-but-suspicious paths.

## Process

1. From the repo root, compute the live set: `git worktree list` (paths),
   `git ls-files` (tracked set). Cache both.
2. For each enabled rule, resolve its match to concrete paths.
3. Drop any path hit by a SAFETY exclusion; emit `cruft-sweep.skip`.
4. Emit the plan (`cruft-sweep.plan`) and, unless `--yes`, stop for operator
   confirmation.
5. On confirm: apply each action (`git rm` for tracked targets so the deletion
   is committable; `rm`/`rm -rf` for untracked). Emit `cruft-sweep.removed`.
6. Sweep the tree once more for paths that *look* like cruft (large untracked
   binaries, stray `*.tmp`, empty scaffold dirs) but matched no rule; emit
   `cruft-sweep.review` so the operator can add a rule or delete by hand.
7. Never touch `.gitignore` semantics beyond ensuring the patterns this skill
   relies on (e.g. `*.db`) are present.
