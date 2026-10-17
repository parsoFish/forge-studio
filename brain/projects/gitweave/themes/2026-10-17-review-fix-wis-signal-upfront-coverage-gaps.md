---
title: Review-fix WIs added each round signal coverage gaps the PM could have front-loaded
description: Three consecutive send-back rounds each added one review-fix WI covering a predictable gap (CLI routing, env-var absence, repo-scope); these patterns appear in the manifest ACs and should generate WIs in the PM decomposition.
category: antipattern
keywords: [adversarial-review, send-back, pm-decomposition, cli-routing, env-var-absence, repo-scope, review-fix, wi-coverage, test-gaps, policy]
created_at: 2026-10-17T00:32:15Z
updated_at: 2026-10-17T00:32:15Z
related_themes: [2026-10-11-plan-engine-all-three-state-branches-required, 2026-10-11-acceptance-tests-require-live-credentials]
---

## What happened

I3b had 10 PM WIs + 3 kickoff WIs (total 13) going into the first dev-loop run. After each review send-back round, one more WI was added:

- **WI-14** (round 1): CLI dispatch spy tests (asserting `check_permission()` is called on the CLI path), `jsonschema` declared in both requirements.txt and pyproject.toml, env-var absence → test failure.
- **WI-15** (round 2): env-var absence assertions without `skipUnless/skipTest`, `remove-member` CLI subcommand, fail-closed policy guard.
- **WI-16** (round 3): per-repo scope enforcement (update-content and add-exception check `allowed_repo_patterns`), AST-based test to verify all live-test resource names derive from `GW_RESOURCE_PREFIX`, real-CLI dispatch test (not synthetic subprocess).

All three gaps were traceable to manifest ACs 5–8:
- AC5: "exits non-zero, output names the specific policy rule" — CLI *path* coverage not just unit coverage
- AC6: "exits non-zero with an explicit caller-token-required error" — env-var absence
- AC7: "exits non-zero with a clear message naming the problem" — policy-absent path
- AC8: "exits non-zero with a refusal that names the team" — policy denial

## Rule

If a manifest AC asserts CLI exit behaviour or names an env-var that must be absent/unset, the PM MUST produce a WI that tests that AC through the real CLI path (subprocess or in-process `main()`). Unit tests on the inner function alone are insufficient; the CLI routing layer can silently bypass them.

Similarly, if any WI creates live resources, a corresponding WI should assert all resource names derive from the configured prefix (static AST or naming convention), not defer this to adversarial review.

## Cost impact

Each review-fix WI added one full dev-loop re-run. Three rounds × ($7–40 per run) = ~$60 in extra developer-loop cost from the send-back cycle alone. The initial PM decomposition with these WIs upfront would have eliminated at least 2 of the 3 send-back rounds.

## See also

- [[2026-10-11-plan-engine-all-three-state-branches-required]] — prior cycle where missing AC coverage (delete branch) also caused send-backs
- [[2026-10-11-acceptance-tests-require-live-credentials]] — related live-acceptance test integrity theme

## Sources

- `_logs/2026-10-12T05-14-21_INIT-2026-10-11-i3b-self-service/events.jsonl` (WI-14/15/16 ralph.end events at 2026-10-15T23:56, 2026-10-16T12:29, 2026-10-16T14:22; sendback.loop-completed events)
- `brain/cycles/_raw/2026-10-12T05-14-21_INIT-2026-10-11-i3b-self-service.md`
