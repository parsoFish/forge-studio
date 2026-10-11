---
work_item_id: WI-5b
initiative_id: INIT-2026-10-11-i2-apply-engine-terraform-retired
status: pending
depends_on:
  - WI-5a
domain: managers
acceptance_criteria:
  - given: "FORGE_RESOURCE_PREFIX is set and a mocked Github org"
    when: "TeamsManager.list_managed() is called"
    then: "returns only teams whose name starts with FORGE_RESOURCE_PREFIX"
  - given: "a team config entry and mocked Github org"
    when: "TeamsManager.apply(team_config) is called and team does not exist"
    then: "calls org.create_team() and returns ResourceStatus(status='ok')"
  - given: "FORGE_RESOURCE_PREFIX is unset or empty"
    when: "any of TeamsManager, ReposManager, RulesetsManager is instantiated"
    then: "raises EnvironmentError naming FORGE_RESOURCE_PREFIX"
  - given: "a repo slug not yet present in the org"
    when: "ReposManager.apply(repo_config) is called"
    then: "calls org.create_repo() with the declared settings and returns status ok"
  - given: "a ruleset not yet present and mocked Github org"
    when: "RulesetsManager.apply(ruleset_config) is called"
    then: "calls the org rulesets API and returns status ok"
files_in_scope:
  - gitweave/managers/teams.py
  - gitweave/managers/repos.py
  - gitweave/managers/rulesets.py
  - tests/test_manager_resources.py
creates:
  - gitweave/managers/teams.py
  - gitweave/managers/repos.py
  - gitweave/managers/rulesets.py
  - tests/test_manager_resources.py
estimated_iterations: 3
quality_gate_cmd:
  - python3
  - -m
  - pytest
  - tests/test_manager_resources.py
---

# WI-5b: Prefixed resource managers (teams, repos, rulesets)

Target: three manager modules implementing create/update/delete for prefixed resources.
All three share the same safety invariant: **only names starting with `FORGE_RESOURCE_PREFIX`
are touched**. `FORGE_RESOURCE_PREFIX` unset/empty is a fatal startup error.

## Common pattern (apply to all three managers)

```python
import os
from gitweave.managers.org import ResourceStatus  # reuse the dataclass

def _get_prefix() -> str:
    prefix = os.environ.get("FORGE_RESOURCE_PREFIX", "")
    if not prefix:
        raise EnvironmentError("FORGE_RESOURCE_PREFIX must be set and non-empty")
    return prefix

def _is_managed(name: str, prefix: str) -> bool:
    return name.startswith(prefix)
```

## gitweave/managers/teams.py

```python
class TeamsManager:
    def __init__(self, gh_org):
        self._org = gh_org
        self._prefix = _get_prefix()

    def list_managed(self) -> list:
        return [t for t in self._org.get_teams()
                if _is_managed(t.name, self._prefix)]

    def apply(self, team_cfg: dict) -> ResourceStatus:
        """Create or update a team. team_cfg: {name, description?, privacy?, members?}"""
        name = team_cfg["name"]
        try:
            existing = {t.name: t for t in self._org.get_teams()}
            if name in existing:
                existing[name].edit(name=name,
                                    description=team_cfg.get("description",""),
                                    privacy=team_cfg.get("privacy","closed"))
            else:
                self._org.create_team(name,
                                      description=team_cfg.get("description",""),
                                      privacy=team_cfg.get("privacy","closed"))
            return ResourceStatus(name=name, status="ok")
        except Exception as exc:
            return ResourceStatus(name=name, status="error", error=str(exc))

    def delete(self, team_name: str) -> ResourceStatus:
        """Delete a managed team; 404 treated as success."""
        try:
            teams = {t.name: t for t in self._org.get_teams()}
            if team_name in teams:
                teams[team_name].delete()
            return ResourceStatus(name=team_name, status="ok")
        except Exception as exc:
            if "404" in str(exc):
                return ResourceStatus(name=team_name, status="ok")
            return ResourceStatus(name=team_name, status="error", error=str(exc))
```

## gitweave/managers/repos.py

Same pattern. `apply(repo_cfg)` creates/updates a repo via `org.create_repo()` or
`repo.edit()`. `delete(slug)` calls `repo.delete()` treating 404 as success.

Key fields in `repo_cfg`: `slug` (required, used as repo name), `private` (bool, default True),
`description` (str), `has_issues` (bool), `has_projects` (bool).

## gitweave/managers/rulesets.py

Uses `org._requester.requestJsonAndCheck` or equivalent PyGithub low-level to call
`POST /orgs/{org}/rulesets` and `DELETE /orgs/{org}/rulesets/{id}`. If PyGithub doesn't
expose a high-level ruleset API, use `org._requester` directly or `requests` with the
installation token — document the approach chosen.

```python
class RulesetsManager:
    def __init__(self, gh_org, installation_token: str | None = None):
        self._org = gh_org
        self._prefix = _get_prefix()
        self._token = installation_token  # may be None if using requester

    def list_managed(self) -> list:
        # GET /orgs/{org}/rulesets
        ...

    def apply(self, ruleset_cfg: dict) -> ResourceStatus:
        ...

    def delete(self, ruleset_name: str) -> ResourceStatus:
        ...
```

## tests/test_manager_resources.py

All tests mock PyGithub (and any requests). No live network. Cover:
1. `_get_prefix()` raises when `FORGE_RESOURCE_PREFIX` not set.
2. `list_managed()` returns only prefix-matching names.
3. `apply()` creates when absent, updates when present.
4. `delete()` treats 404 as success.
5. `apply()` returns `status="error"` on exception.

---

Brain themes consulted:
- `brain/projects/gitweave/profile.md`
- `brain/cycles/themes/spec-driven-work-items.md`
- `brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md`
