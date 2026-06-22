# Gitpulse — Milestone 4b: `--compare <ref>` analytics delta between two refs

Extend the gitpulse git-analytics CLI with a `--compare <ref>` mode that reports the
*delta* in analytics between two points in history — what changed between two releases —
keeping the zero-runtime-dependency constraint and the deterministic temp-repo acceptance
model the baseline already established. This is the idea the verify-cycle harness feeds to
the real forge architect to drive the 3-stage spine (architect → develop → reflect)
end-to-end.

Scope (one cohesive initiative — functionality plus its tests together):

- **`--compare <ref>` flag**: when set, gitpulse computes its analytics twice — once over
  history up to `HEAD` (or the existing `--since`/`--until` window) and once up to the
  given `<ref>` — and renders the difference rather than a single snapshot.
- **Delta model** (pure, in a new `src/compare.ts`): given the two computed summaries,
  produce a `{ metric, ref, head, delta }` structure for the headline totals (commits,
  files touched, lines added/removed) plus per-author commit/churn deltas (authors present
  in either side; missing side counts as 0). Descending by absolute delta.
- **Delta rendering**: a clearly-labelled "since `<ref>`" comparison table with signed
  numbers (`+N` / `-N`), reusing the existing column/format conventions. `--top <n>` still
  bounds the per-author delta list.
- **Boundary validation**: an unknown/invalid `<ref>` fails fast on stderr with a non-zero
  exit (consistent with the existing inverted-window handling); `--json` (already shipped)
  emits the delta model as structured JSON instead of the table.

Constraints: pure aggregation over `git log` output at each ref (no new runtime
dependencies), and every feature covered by unit tests plus the deterministic temp-repo
acceptance fixture (a fixture repo with two tagged refs so the delta is exact and
reproducible). Honest, demonstrable analytics — the delta numbers must equal the
difference of the two snapshots' own numbers, no placeholders.
