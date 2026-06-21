# Gitpulse — Milestone 2: Ownership & hotspots

Extend the gitpulse git-analytics CLI with ownership and hotspot analysis, keeping the
zero-runtime-dependency constraint and the deterministic temp-repo acceptance model the
baseline already established. This is the idea the verify-cycle harness feeds to the real
forge architect to drive the 3-stage spine (architect → develop → reflect) end-to-end.

Scope (one cohesive initiative — functionality plus its tests together):

- **File ownership** (`src/ownership.ts`): for each file, the author who wrote the most
  surviving lines (the file "owner"), plus the bus-factor count of distinct contributors.
- **Hotspot detection**: rank files by churn × recency (frequently AND recently changed) —
  the change-risk surface.
- **`--top <n>` flag**: bound every ranked list (authors, churn, ownership, hotspots) so the
  output stays readable on large repos.

Constraints: pure aggregation over `git log` output, **no runtime dependencies**, and every
feature covered by unit tests plus the deterministic temp-repo acceptance fixture. Honest,
demonstrable analytics — no placeholder numbers.
