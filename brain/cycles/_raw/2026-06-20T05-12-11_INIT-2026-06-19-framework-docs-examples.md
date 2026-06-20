---
source_type: cycle
source_url: _logs/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples/events.jsonl
source_title: Cycle 2026-06-20T05-12-11 — Initiative INIT-2026-06-19-framework-docs-examples
cycle_id: 2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples
initiative_id: INIT-2026-06-19-framework-docs-examples
project: terraform-provider-betterado
ingested_at: 2026-06-20T08:00:00Z
ingested_by: reflector
retention: load-bearing
cited_by:
  - brain/cycles/themes/2026-06-20-pm-acceptance-gate-misfires-on-scoped-docs-initiatives.md
  - projects/terraform-provider-betterado/forge/brain/themes/2026-06-20-make-docs-deletes-guides-dir.md
  - projects/terraform-provider-betterado/forge/brain/themes/2026-06-20-tfplugindocs-typename-must-match-provider-prefix.md
---

## Summary

**Initiative:** INIT-2026-06-19-framework-docs-examples — Update registry docs and HCL examples to new array syntax for betterado_release_definition and betterado_task_group post-v1.0.0; document holistic SDKv2→framework migration in roadmap.

**Outcome:** PR #32 opened (pr-open; awaiting operator merge). Both WIs complete in 1 iteration each.

**Final diff vs main:** 8 files changed, 747 insertions, 4 deletions.

### Phase summary

| Phase | Runs | Cost | Notes |
|-------|------|------|-------|
| PM | 5 | ~$3.70 | 4 failures on acceptance-gate before valid WI batch |
| dev-loop WI-1 | 1 iter / 119 tool calls | $1.81 | TypeName fix + make docs regen + terrafmt-check pass |
| dev-loop WI-2 | 1 iter / 13 tool calls | $0.27 | roadmap section expand |
| unifier UWI-1 | 1 iter | $1.84 | go test -tags all passed; all 4 sub-checks pass |

**Total cycle duration:** ~1321s (~22 min)

### Key findings

1. `BetteradoFrameworkProvider.Metadata.TypeName` was `"azuredevops"` instead of `"betterado"`, causing `make docs` to produce a double-prefixed resource name (`betterado_azuredevops_release_definition`) that failed the template lookup. Fix: one-line change to `framework_provider.go`.

2. `make docs` (`tfplugindocs generate`) deletes the `docs/guides/` directory (hand-written). Fix: `git checkout -- docs/guides/` appended to the `docs` Makefile target.

3. PM's blanket acceptance-gate check (every initiative must include a TF_ACC WI) misfired 4 times on a docs-only initiative before the PM dropped the acceptance WI on the 5th attempt. ~$3 wasted.

4. `brainReads=0` in both ralph sessions — repeat of prior cycles' antipattern.

5. CI gate (`make test` with TF_ACC unset + golangci-lint + make terrafmt-check): 0 issues. Pre-existing acceptance-test contamination in `go test ./...` was correctly identified as pre-existing by ralph and not pursued.

### Event log reference

Full event log: `_logs/2026-06-20T05-12-11_INIT-2026-06-19-framework-docs-examples/events.jsonl` (1839 events)
