---
title: conftest autouse fixture sets env var for all tests, masking managers that still require old var
description: An autouse=True conftest fixture that sets FORGE_RESOURCE_PREFIX for every test hides that prod managers still require it; per-WI gate passes while the live gate (no fixture) fails.
category: antipattern
keywords: [conftest, autouse, fixture, env-var, FORGE_RESOURCE_PREFIX, GW_RESOURCE_PREFIX, managers, live-gate, acceptance-test, send-back]
created_at: 2026-10-13T00:00:00Z
updated_at: 2026-10-13T00:00:00Z
related_themes: [2026-10-11-acceptance-tests-require-live-credentials]
---

## What happened

I3a WI-1 implemented `GW_RESOURCE_PREFIX` as the new ownership marker in `plan.py`. The `tests/conftest.py` had an `autouse=True` fixture that set `FORGE_RESOURCE_PREFIX` for every test (a leftover from the forge-test-isolation pattern). Three manager files — `gitweave/managers/teams.py`, `gitweave/managers/repos.py`, `gitweave/managers/rulesets.py` — still called `_get_prefix()` which read `FORGE_RESOURCE_PREFIX` as the primary/required var.

Because the autouse fixture injected the env var into every test process, the per-WI gate passed (`pytest tests/` green). But the live gate — which ran without the fixture — called `gw plan` in a clean env with only `GW_RESOURCE_PREFIX` set. The managers raised `OSError: FORGE_RESOURCE_PREFIX must be set and non-empty`. This triggered send-back round 1, adding WI-5 to fix the managers end-to-end.

## Rule

After introducing a new env var as the primary ownership marker, search for every call site of the old var in `gitweave/managers/` and `gitweave/plan.py`. A test suite that passes with an autouse env fixture is not evidence the old var is gone.

Explicit: when a conftest fixture sets an env var for `autouse=True`, every test in the suite inherits it — including tests that are probing whether the code works WITHOUT it. Either scope the fixture narrowly (to only the tests that need it) or use `monkeypatch.delenv` in the tests that assert the old var is no longer required.

## See also

- [[2026-10-11-acceptance-tests-require-live-credentials]] — prior cycle's acceptance-test integrity theme for gitweave

## Operator answers

Operator confirmed: autouse env masking is worth a forge fix. PM ACs for env-var migrations must assert the old var is absent from prod code paths, not only that the new var is set. (Q3, 2026-10-13 feedback.)

## Sources

- `_logs/2026-10-12T05-14-21_INIT-2026-10-11-i3a-green-apply-path/events.jsonl` (send-back round 1 rationale at 2026-10-12T06:47, WI-5 gate.fail ×2 events)
- `brain/cycles/_raw/2026-10-12T05-14-21_INIT-2026-10-11-i3a-green-apply-path.md`
