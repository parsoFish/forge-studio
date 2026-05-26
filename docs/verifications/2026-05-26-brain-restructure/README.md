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
