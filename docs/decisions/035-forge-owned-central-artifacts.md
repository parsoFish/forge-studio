# ADR 035 — Forge-owned central per-project artifacts

**Status:** Accepted
**Date:** 2026-06-20
**Supersedes:** [ADR 018](./018-three-brain-model.md) (Brain 3 location only — the
three-brain *scoping* model stands; only *where Brain 3 lives* is reversed).
**Amends:** [ADR 010](./010-brain-first.md) (the Brain 3 read-policy paths).

## Context

[ADR 018](./018-three-brain-model.md) moved each managed project's **Brain 3**
out of the forge repo (`brain/projects/<name>/`) and *into the project's own
repo* (`projects/<name>/<artifactRoot>/brain/`), on a **portability** argument:
"the project brain should travel with the project." The same move put the
committed development/demo **history** and the forge↔project **contract** inside
the project repo too.

In practice that portability never paid off, and it actively fights the workflow:

1. **The reflector runs post-merge.** By the time the reflection phase writes
   Brain 3 theme files, the cycle's PR is already **merged and the worktree torn
   down** — there is no clean, checked-out project working tree to commit the
   brain write into. Writing back into the project repo after close-out means a
   second commit/push dance against a repo forge no longer has open. The
   project-repo location made the *last* phase of every cycle the most awkward.
2. **Single operator, single forge.** Forge manages every project from one
   install; "a different forge instance picks the project up and the brain comes
   with it" is not a real scenario. The cost (above) bought a benefit no one uses.
3. **Project repos carry forge's bookkeeping.** Onboarding a project meant
   committing forge's `brain/`, `history/`, and contract into someone else's
   source tree — noise that has nothing to do with the project's own code.

This reverses **only the Brain 3 / history / contract *location***. The
three-brain *scoping* model (Brain 1 forge-dev, Brain 2 cycles, Brain 3
per-project) from ADR 018 is unchanged.

## Decision (DEC-1)

Per-project **brain, development/demo history, and contract are forge-owned and
live centrally in the forge repo**, not in the managed project's repo. Demo
*machinery* (CI steps, tests, project skills) stays in the project repo (that is
code the project runs — see [DEC-4 / F5]); only the **knowledge, the archived
history, and the contract** move central.

### Central layout (the "split" — knowledge in the brain wiki, artifacts beside it)

```
brain/
├── forge-dev/                       # Brain 1 (unchanged)
├── cycles/                          # Brain 2 (unchanged)
└── projects/
    └── <name>/
        └── themes/                  # Brain 3 — per-project themes (forge-owned)

project-artifacts/                   # NEW committed top-level (forge-owned)
└── <name>/
    ├── demo-history/<initiativeId>/  # post-merge archived plan/demo/verdict bundle
    └── contract.json                # the resolved forge↔project contract (SSOT)
```

- **Brain 3** rejoins its siblings in the brain wiki at `brain/projects/<name>/themes/`
  (exactly where it lived *before* ADR 018). `brain-lint`/`brain-index` can scan
  it again; cross-brain wikilinks stop needing `../../projects/...` hops.
- **History/contract** are *artifacts*, not knowledge, so they sit in a sibling
  top-level `project-artifacts/<name>/` rather than polluting the brain wiki.
- **`orchestrator/brain-paths.ts` is the single switch point.** Every consumer
  resolves these through it; this ADR is the only place the layout is described.

### Thin pointer stays in the project repo

The project keeps a **thin `.forge/project.json`** in its own repo purely for
**discovery** (forge auto-discovers a managed project by finding this file). The
**central `project-artifacts/<name>/contract.json` is the SSOT** for the resolved
contract; `.forge/project.json` is the minimal "this dir is a forge project +
its `quality_gate_cmd`/`demoProcess`/`skills`" pointer, not the durable record.

### Scope boundary: the in-PR demo is NOT moved

`projectDemoRelDir` resolves the **worktree-relative** directory the unifier
authors the demo into *during* the cycle — that demo is committed to the PR and
rendered by the review surface. It stays in the worktree/project repo. Only the
**post-merge archived history** (`projectHistoryDir`) goes central. (The demo
*output* consolidation to a single markdown — [F4] — and the generative
demo-design skill — [F5] — build on the central `demo-history` location this ADR
establishes; they are out of scope here.)

## Reflector writes Brain 3 centrally, post-merge

Because Brain 3 is now a forge-repo directory, the reflection phase writes theme
files into `brain/projects/<name>/themes/` directly — a normal forge-repo write,
committed with forge's own history. No open project worktree is required, which
is exactly the timing problem ADR 018's location created.

## Impact on brain-first policy (ADR 010)

The read policy is unchanged in *who reads what*; only the **paths** move:
dev-loop/reviewer that consult Brain 3 now read `brain/projects/<name>/themes/`.
The planner still encodes all project constraints into work items regardless.

## Consequences

**Positive:**
- The reflector — the last phase of every cycle — writes Brain 3 with no open
  project worktree. The post-merge timing problem disappears.
- Managed project repos stay clean: no forge `brain/`/`history/`/contract commits.
- `forge brain lint` / `forge brain index --write` can lint + index Brain 3 again
  (it is back inside the forge repo).
- One forge-owned home for every project's knowledge + artifacts + contract.

**Negative / accepted trade-offs (explicitly reversing ADR 018's rationale):**
- **Brain 3 no longer "travels with the project."** Accepted: forge is the single
  operator; the portability scenario is not real, and the cost was the post-merge
  write problem above.
- Forge's commit history now carries project-knowledge writes again. Accepted:
  these are forge's own bookkeeping and belong with the tool that produces them.
- A migration is required for the 4 existing managed projects (below).

## Migration

The brain-path SSOT switch is a hard cutover (no dual-read fallback — forge
principles forbid coexistence). Existing per-project artifacts are relocated:

- **terraform-provider-betterado** — Brain 3 + history currently committed in the
  *project repo* (`forge/brain`, `forge/history`). Extract via git-history-aware
  copy into `brain/projects/terraform-provider-betterado/themes/` +
  `project-artifacts/terraform-provider-betterado/`, behind a recovery tag
  (`artifacts-pre-central` à la ADR 018's `brain-pre-restructure`), then remove
  `forge/brain` + `forge/history` from the project tree (keeping `forge/skills/`).
- **mdtoc / trafficGame / demo-project** — plain copy of `projects/<name>/[forge/]brain`
  → `brain/projects/<name>/themes/` and any `history/` → `project-artifacts/<name>/demo-history/`.
- A migration script (`scripts/migrate-central-artifacts.mjs`) performs the moves
  idempotently and is re-runnable; it logs every move and is the helper F4 reuses
  for the betterado demo-tree collapse.

## References

- [ADR 018](./018-three-brain-model.md) — the three-brain model (location reversed here)
- [ADR 010](./010-brain-first.md) — brain-first policy (paths amended here)
- [ADR 021](./021-local-review-and-unified-demo.md) — demo render (history location)
- `orchestrator/brain-paths.ts` — the single switch point
