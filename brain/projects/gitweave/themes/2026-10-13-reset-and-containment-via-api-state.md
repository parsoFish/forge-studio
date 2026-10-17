---
title: gw reset and containment must be verified by API read-back, not exit code or stdout
description: Reset acceptance was exit-code-only and containment scraped gw stdout (which always failed on org_settings); both must use API read-back (GET teams/repos/rulesets) for authoritative verification.
category: pattern
keywords: [reset, containment, api-readback, acceptance-test, GET, teams, repos, rulesets, stdout-scraping, exit-code, live-acceptance]
created_at: 2026-10-13T00:00:00Z
updated_at: 2026-10-13T00:00:00Z
related_themes: [2026-10-11-acceptance-tests-require-live-credentials, 2026-10-13-resource-marker-is-not-a-secret]
---

## What happened

I3a WI-5 implemented live acceptance tests for reset and containment. The first implementation:

- **Reset**: asserted `gw reset` exits 0. No API call to confirm resources were actually deleted.
- **Containment**: scraped `gw` stdout for lines listing managed resources and checked none fell outside `GW_RESOURCE_PREFIX`. This always failed on `org_settings` lines — org-level settings are not marker-scoped resources but the scraper treated them as violations.

Both were caught in send-back round 2, adding WI-6 to rewrite both checks to use API read-back.

## Correct pattern

**Reset verification:**
```python
# After gw reset, do a live GET of each resource type
teams = client.get_org_teams()
repos = client.get_org_repos()
rulesets = client.get_org_rulesets()
marker = os.environ["GW_RESOURCE_PREFIX"]
assert not any(t["name"].startswith(marker) for t in teams), "reset left team resources"
assert not any(r["name"].startswith(marker) for r in repos), "reset left repo resources"
assert not any(r["name"].startswith(marker) for r in rulesets), "reset left ruleset resources"
```

**Containment verification:**
Check API state — only resources whose names start with `GW_RESOURCE_PREFIX` were created or changed. Do NOT scrape `gw` stdout. `org_settings` are org-level declarations, not marker-owned items — skip them entirely.

**Note on rulesets (Free plan):** `dave-parso` is on the GitHub Free plan; org rulesets return 403 from the API. `gw` skips rulesets by design on Free. Containment tests must not assert on rulesets for this org.

## Rule

Any acceptance test for `gw reset`: the gate is the API response, not the exit code. Any acceptance test for containment: the gate is an API read of affected resource types, not CLI output parsing.

## I3b follow-on

Operator added three WIs to I3b: (1) reset read-back after a real create/reset; (2) containment via API state; (3) rulesets 403 string-match fix + stale docstring. These extend this theme into full implementation.

## Operator answers

Exit-code-only reset/containment worth a forge fix: PM ACs for live side effects must name API read-back as the acceptance criterion — not exit code, not stdout. (Q3, 2026-10-13 feedback.)

## See also

- [[2026-10-11-acceptance-tests-require-live-credentials]] — acceptance test infrastructure for gitweave
- [[2026-10-13-resource-marker-is-not-a-secret]] — other send-back 2 finding

## Sources

- `_logs/2026-10-12T05-14-21_INIT-2026-10-11-i3a-green-apply-path/events.jsonl` (send-back round 2 rationale at 2026-10-12T11:00; WI-6 delivery at 11:14)
- `brain/cycles/_raw/2026-10-12T05-14-21_INIT-2026-10-11-i3a-green-apply-path.md`
