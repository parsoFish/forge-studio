# Verification: Tier 4 Three-Brain Restructure (2026-05-26)

## Recovery anchor

- Tag: `brain-pre-restructure`
- Commit: `86f936c`

## Phase commits

| Phase | Commit | Description |
|-------|--------|-------------|
| 0 | `3f4ff47` | Baseline: delete archive + ghost project brains |
| 1 | `fe7a29d` | Scope/path plumbing in SKILL docs and CLI |
| 2 | `0f6fc27` | Directory restructure + project brain migration |
| 3 | `c942379` | Graphify wrapper script + doc path updates |
| 4 | `c323446` | ADR 018 + orchestration/skill path updates |
| 5 | `9622ecf` | Theme audit: fix broken _raw paths + missing frontmatter |

## Test results (at Phase 5 HEAD)

- **Tests**: 469
- **Pass**: 468
- **Fail**: 0
- **Skipped**: 1

## Brain lint results (at Phase 5 HEAD)

```
npx forge brain lint
```

- **ERRORS**: 6 (all `checkLengthSoftCap` — pre-existing long themes, not restructure regressions)
- **FLAGS**: 65 (orphans, index-sync, staleness — pre-existing or expected)

### Remaining errors (pre-existing, not restructure regressions)

All 6 are `checkLengthSoftCap` — themes that were already over the 100-line hard cap before the restructure:

- `brain/cycles/themes/dom-as-metrics-for-headless-driven-uis.md` (125 lines)
- `brain/cycles/themes/exploration-vs-implementation-initiatives.md` (272 lines)
- `brain/cycles/themes/holistic-metrics-onboarding.md` (162 lines)
- `brain/cycles/themes/parametric-design-search.md` (172 lines)
- `brain/cycles/themes/pr-as-sole-review-window.md` (111 lines)
- `brain/cycles/themes/windows-browser-to-wsl-via-window-location.md` (107 lines)

### Expected flags

- **orphans/checkIndexSync**: 17 themes in `brain/cycles/themes/` that were moved from `brain/forge/themes/` are not yet listed in their new category indexes (`brain/cycles/decisions.md`, `brain/cycles/patterns.md`, etc.). These are expected post-restructure — the category indexes need a curation pass.
- **checkStaleness** on `chained-phase-benchmarks.md`: references `benchmarks/` files that were intentionally removed on 2026-05-25 (the bench harnesses were deleted). Theme should be updated in a future ingest pass.
- **Brain 3 cross-reference** in `exploration-vs-implementation-initiatives.md`: link to `projects/trafficGame/brain/themes/...` is correct but will flag as broken in forge repo because `projects/` is gitignored. This is expected behavior for Brain 3 cross-references.

## Three-brain structure (verified)

```
brain/
├── INDEX.md              — 70 forge themes, 54 project themes, 17 raw sources, 3 sub-wikis
├── LINT.md
├── _raw/                 — forge-dev raw sources (docs/, web/, v1-wiki/)
├── cycles/
│   ├── _raw/             — cycle archive files (was brain/_raw/cycles/)
│   ├── themes/           — cycle-derived patterns (was brain/forge/themes/)
│   ├── patterns.md
│   ├── antipatterns.md
│   ├── operations.md
│   └── decisions.md
├── forge-dev/
│   ├── as-built/
│   ├── notes/
│   ├── graphify-out/.keep
│   ├── decisions.md
│   ├── reference.md
│   └── log.md
└── graphify-out/         — legacy single-brain graph (kept for backwards compat)
```

Brain 3 (per-project) lives at `<project-repo>/brain/` inside each managed project's repo.

## ADR

See [docs/decisions/018-three-brain-model.md](../decisions/018-three-brain-model.md) for the full architectural decision record.

## Graphify graph evidence

All three brains have been built and verified with queries. Graphs are committed to git.

### Graph size comparison

| Graph | Path | Nodes | Links |
|-------|------|-------|-------|
| Legacy monolith | `brain/graphify-out/` | 5,248 | 7,676 |
| Brain 1 (forge-dev) | `brain/forge-dev/graphify-out/` | 3,566 | 4,763 |
| Brain 2 (cycles) | `brain/cycles/graphify-out/` | 518 | 426 |
| Brain 3 (trafficGame) | `projects/trafficGame/brain/graphify-out/` | 2,578 | 4,037 |
| Brain 3 (claude-harness) | `projects/claude-harness/brain/graphify-out/` | 553 | 586 |
| Brain 3 (terraform-provider-betterado) | `projects/terraform-provider-betterado/brain/graphify-out/` | 6,015 | 12,298 |

### Query comparison: "where are cycle archive files stored"

**Old (legacy monolith):** returned 46 nodes dominated by `benchmarks/reflection/scoring.ts` functions
(`checkCycleArchive`, `listThemeFiles`, `parseEventLog`, etc.) — code that reads archives, not the
archives themselves. The actual archive path was buried in test code noise.

**New (Brain 2, cycles):** returned 23 nodes, all directly from `_raw/` archive files:
cycle summaries, commit logs, event logs, trajectories. Signal-to-noise ratio massively improved.

### Query comparison: "how does the reflector phase work"

**Old (legacy monolith):** first 15 nodes included `forge-ui` components — `page.tsx`,
`bridge-client.ts`, `AgentHexCanvas.tsx`, `wi-status.ts`, `phases.ts` — before reaching
`skills/reflector/SKILL.md`. UI code dominated because the graph mixed all domains.

**New (Brain 1, forge-dev):** top results immediately: `Reflector` (SKILL.md L9), `Process`
(SKILL.md L110), `Inputs`, `Outputs`, `Constraints`, `Stage 2` — focused skill documentation
with no UI noise.

### Build commands

```bash
# Rebuild Brain 1 + Brain 2:
bash scripts/brain-graphify-all.sh

# Rebuild all including Brain 3 projects:
bash scripts/brain-graphify-all.sh --all

# Brain 1 manually:
GRAPHIFY_OUT=brain/forge-dev/graphify-out GRAPHIFY_FORCE=1 graphify update .

# Brain 2 manually:
GRAPHIFY_OUT=graphify-out GRAPHIFY_FORCE=1 graphify update brain/cycles

# Brain 3 for one project (whole-project scope, output at brain/graphify-out/):
GRAPHIFY_OUT=brain/graphify-out graphify update projects/<name>
```

### Brain 3 scope correction (2026-05-26 follow-up)

Initial Brain 3 build (commit `d26796b`) incorrectly scanned only `projects/<name>/brain/` —
capturing brain themes but not source code (145 nodes for trafficGame vs 2,578 whole-project).

**Three independent sources confirm the correct scope is whole-project:**
1. **ADR 018**: "each project gets a targeted graph of its own code AND brain themes"
2. **skills/brain-graph/SKILL.md** (line 21): Brain 3 scope = `<project-repo>/brain/` + `<project-repo>/` source tree
3. **Empirical query comparison** (7 queries): brain-only answered 0/7 code-level questions; whole-project answered all 7

**Coverage improvement:**

| Project | Brain-only (wrong) | Whole-project (correct) | Factor |
|---------|-------------------|-------------------------|--------|
| trafficGame | 145 nodes | 2,578 nodes | 17.8× |
| claude-harness | 216 nodes | 553 nodes | 2.6× |
| terraform-provider-betterado | 45 nodes | 6,015 nodes | 133× |

Each project now has a `.graphifyignore` at its root to prevent self-recursion and exclude
noise (node_modules, dist, demo, brain/graphify-out/).

