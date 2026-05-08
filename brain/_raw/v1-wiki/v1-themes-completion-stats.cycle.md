---
source_type: cycle
source_url: ~/sideProjects/.forge/wiki/forge/themes/work-item-completion-by-domain.md
source_title: v1 wiki — work-item completion stats by project (Cycle 3)
ingested_at: 2026-05-04T19:30:00Z
ingested_by: brain-ingest (Pass B, batch 1)
cycle_id: pass-b-bootstrap
---

# Work item completion rates by domain complexity

Across **109 work items** in the first full autonomous cycle (Cycle 3, Apr 2–6 2026):

| Project | Items | Avg Develop Time | Max Develop Time | Completion |
|---------|-------|-----------------|-----------------|------------|
| env-optimiser | 11 | 3.6 min | 8.3 min | 100% |
| trafficGame | 28 | 5.2 min | 26.9 min | 100% |
| GitWeave | 37 | 4.8 min | 14.8 min | 95% (2 in-progress) |
| simplarr | 33 | 6.3 min | 19.9 min | 100% |

Observations:

- **simplarr's** dual-language constraint (Bash + PowerShell parallel implementations) inflates average time despite clean domain logic.
- **trafficGame's** outliers cluster around algorithm-heavy items (Steiner trees, graph colouring).
- **env-optimiser's** tight distribution confirms that a well-understood domain (Python stdlib, pytest, SQLite) produces the most predictable agent behaviour.
- **GitWeave's** 95% completion (2 in-progress) maps to the "scattered branches" technical-debt issue identified in its roadmap.

**Planning implication:** weight external dependency complexity and domain novelty heavily when estimating work item difficulty. Two items with identical line counts can have 4× different develop times based on domain.

This is the empirical floor for v2's project-manager phase. PM benchmarks should distinguish domain-clean cases from domain-novel ones, and outlier-tolerance should be tuned per project.
