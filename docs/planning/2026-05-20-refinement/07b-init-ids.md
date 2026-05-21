---
area: init-ids
date: 2026-05-20
date_split_from_07: 2026-05-21
date_contracts_locked: 2026-05-21
status: contracts locked — see CONTRACTS.md
contract_deps: [C6, C17]
council_review: ./07-general-logging-ids.council.md
ships_in_stage: S1.1
---

# Init IDs refinement plan (07b — split from 07 per C18d)

> **Contracts locked.** This plan honours [CONTRACTS.md](./CONTRACTS.md).
> Specifically: C6 (handle format = `<proj4>#<seq>`, e.g. `traf#7`),
> C17 (`_aliases.json` mints use `proper-lockfile` — not hand-rolled
> race-free file I/O).
>
> Originally bundled with 07a (logging UX); split per C18d because the
> surfaces are disjoint (IDs is one-day work, zero-deps-beyond-lockfile;
> logging is multi-day with two new deps). The council review at
> [`07-general-logging-ids.council.md`](./07-general-logging-ids.council.md)
> covers both halves.

## Problem

Sampled actual IDs in `_queue/done/`:

```
INIT-2026-05-18-betterado-01-release-def-test-substrate
INIT-2026-05-19-trafficgame-backpressure-live
INIT-2026-05-10-trafficgame-simplification-arch
```

These collide with the natural human reference frame ("the betterado release one", "trafficGame backpressure"). The 40–60-char string is murderous to type in a slash command — `/forge-review INIT-2026-05-18-betterado-01-release-def-test-substrate` round-trips three tab-completions and a paste.

## Current state

- ID generated in `orchestrator/cli.ts:327, 358` as `INIT-${iso-19chars}-${project}-${slug}`.
- Format validated by **two** regexes (`orchestrator/manifest.ts:103`, `orchestrator/work-item.ts:40`): `/^INIT-\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/` — these are the choke points any migration must respect.
- Consumers: `forge review <id>`, `forge demo --initiative <id>`, slash commands `/forge-review` `/forge-reflect` `/forge-architect` (under `.claude/commands/`), `_queue/*/<id>.md` filename, `_logs/<ts>_<id>/` dir, `_worktrees/<id>/`, manifest YAML `initiative_id:`, work-item YAML `initiative_id:`, branch name `initiative/<id>`.
- Tests assuming long form: `manifest.test.ts:24,44,73,145,159,174,203,230,254`, `work-item*.test.ts`, `demo-html.test.ts:19`, `logging.test.ts:17`.

## Proposed refinement

### Dual-ID scheme (locked per C6)

- **Canonical (unchanged):** `INIT-YYYY-MM-DD-<project>-<slug>` — keeps date-sorting, filesystem-safe, regex-stable, deterministic from the manifest. **No change to existing files, branches, or logs.**
- **Handle (new, per C6):** `<proj4>#<seq>` where `proj4` is the first 4 chars of the slugified project (`traf`, `bett`, `slug`), `<seq>` is a per-project monotonic counter. Examples: `traf#7`, `bett#2`, `slug#15`. Optional **named alias** allowed (`traf#7=backpressure-live`) for ones the operator wants to talk about repeatedly.
- **Why `#`:** doesn't collide with shell path or branch syntax (`/`, `:`); is one keystroke (`Shift+3`); reads naturally; survives copy-paste. (Alternatives `traf-7` / `T7` / `@traf/7` rejected per council 07 [design] escalation.)
- **4-char-prefix collisions (rare):** if a future project's prefix collides (e.g. a `tracker` project clashing with `trafficGame`), mint the new project with a suffix digit (`trac2`). Surface at enqueue time.
- **Resolution rule:** anywhere a command takes an `<initiative-id>`, accept (a) full canonical, (b) handle `proj#N`, (c) named alias `proj#N=name` or just `name` if globally unique. Resolution is **read-only against the registry**; ambiguity prints all matches + exits 2.

### Storage + collision (locked per C17)

- **Registry file:** `_queue/_aliases.json` — single JSON, schema:
  ```json
  {
    "version": 1,
    "by_handle": { "traf#7": "INIT-2026-05-19-trafficgame-backpressure-live" },
    "by_canonical": { "INIT-...": { "handle": "traf#7", "name": null } },
    "counters": { "traf": 7, "bett": 2 }
  }
  ```
- **Minting:** on `forge enqueue` (and `enqueue --from-manifest`), compute prefix, increment `counters[prefix]`, write atomically.
- **Concurrency (per C17):** use `proper-lockfile` for mint-time writes. Reads are unlocked. Adds one small dep (~80k DL/wk, battle-tested); justified vs. hand-rolling daemon-vs-foreground race-free I/O.
- **Collision:** prefix is deterministic from project + counter is monotonic per prefix → **no possibility of handle collision** by construction. Name aliases are validated unique on insert; conflict ⇒ reject with suggested alternative.
- **Lookup helper:** `orchestrator/initiative-id.ts` — `resolveInitiativeId(input: string): { canonical: string; handle: string; name?: string } | null`. Single source. All CLI commands route through it.

### Migration of existing IDs

- One-shot script: `scripts/backfill-aliases.ts`. Walks `_queue/{pending,in-flight,ready-for-review,done,failed}/*.md` in **created_at order**, mints handles, writes `_aliases.json`. Idempotent (skip if `by_canonical[id]` exists).
- **No changes** to existing manifest files, branch names, log dirs, worktrees — the alias is purely a lookup layer.
- `forge status` gains a column showing handle next to canonical; `forge watch` accepts either.

### Bench / acceptance

- Unit tests: `initiative-id.test.ts` — resolution rules, prefix collisions, atomic writes (via `proper-lockfile`), name-alias validation.
- Existing tests stay unchanged (they pin canonical format — that's still authoritative).
- `manifest.ts` and `work-item.ts` regexes: **no change** — canonical regex is unchanged. The handle never lands in YAML.
- Integration test: `forge enqueue --fixture` mints handle; `forge review <handle>` resolves to the canonical and behaves identically.
- Slash-command audit: `.claude/commands/forge-*.md` `argument-hint` updated from `<initiative-id>` to `<initiative-id-or-handle>`.

**Rollout sequence (per council 07 `dx:01-slash-command-handle-rollout`):**
the resolver + registry land first (this plan). Plans 02 / 05 / 06's
slash-command doc cleanup is then cosmetic — handles work via the
resolver regardless of `argument-hint` wording.

## Open questions for the operator

1. ~~Handle format taste?~~ **Decided (C6):** `<proj4>#<seq>` (e.g. `traf#7`).
2. **Named aliases:** should the reflector be able to **suggest** a name alias as part of its retro (e.g. `traf#7=overlay-darken-fix`), or is naming strictly operator-driven? Recommended: operator-driven; reflector may surface candidates in the recap (per plan 06's recap section) but never mints.
3. **`forge enqueue` failure mode on a collision-suffixed mint:** silently use the suffix, or warn-then-mint? Recommended: warn-then-mint at first occurrence per project.

## Dependencies on other refinement plans

- **Plan 01 (brain)** — `brain-lint` may gain a check that `brain/_raw/cycles/<cycle-id>.md` (written by reflector) contains both the canonical ID and the handle for grep-ability. Out of scope for this plan; nice-to-have.
- **Plans 02 / 05 / 06 (slash-command-defining)** — each accepts the resolved handle once the registry lands. Their `argument-hint` rewrites are cosmetic per the rollout sequence above.

## Acceptance criteria for THIS refinement

- Every operator-facing command (`forge review`, `forge demo`, `forge watch`, `/forge-review`, `/forge-reflect`) accepts the short handle and behaves identically to the canonical.
- `_aliases.json` is backfilled for all existing initiatives in `_queue/`.
- No regressions in existing tests pinned to canonical regex.
- `proper-lockfile` survives a synthetic daemon-vs-foreground concurrent-enqueue test without producing duplicate counter values.
