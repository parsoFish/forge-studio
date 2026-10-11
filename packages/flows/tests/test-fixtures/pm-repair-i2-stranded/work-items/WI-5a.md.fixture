---
work_item_id: WI-5a
initiative_id: INIT-2026-10-11-i2-apply-engine-terraform-retired
status: pending
depends_on:
  - WI-2
  - WI-4
domain: managers
acceptance_criteria:
  - given: "a mocked Github client and org_settings config dict"
    when: "OrgSettingsManager.apply(org_settings) is called"
    then: "calls org.edit() with the declared settings and returns status ok"
  - given: "an org already at GitHub safe defaults"
    when: "OrgSettingsManager.reset() is called"
    then: "calls org.edit() with description='', default_repository_permission='read', web_commit_signoff_required=False, members_can_create_repositories=True"
  - given: "org.edit() raises a GitHub API exception"
    when: "OrgSettingsManager.apply() is called"
    then: "returns status error with the exception message rather than propagating"
files_in_scope:
  - gitweave/managers/__init__.py
  - gitweave/managers/org.py
  - tests/test_manager_org.py
creates:
  - gitweave/managers/__init__.py
  - gitweave/managers/org.py
  - tests/test_manager_org.py
estimated_iterations: 3
quality_gate_cmd:
  - python3
  - -m
  - pytest
  - tests/test_manager_org.py
---

# WI-5a: Org settings manager (gitweave/managers/org.py)

Target: `gitweave/managers/org.py` managing org-level settings (description,
default_repository_permission, web_commit_signoff_required, members_can_create_repositories).
Org settings are UNSCOPED — no FORGE_RESOURCE_PREFIX filter. Also creates
`gitweave/managers/__init__.py` (empty package marker only — no imports).

## gitweave/managers/__init__.py

Empty file:
```python
# gitweave managers package
```

Do NOT add any imports here; each manager is imported directly at call sites.

## gitweave/managers/org.py spec

```python
# gitweave/managers/org.py
from dataclasses import dataclass, field
from typing import Literal

ORG_DEFAULTS = {
    "description": "",
    "default_repository_permission": "read",
    "web_commit_signoff_required": False,
    "members_can_create_repositories": True,
}

@dataclass
class ResourceStatus:
    name: str
    status: Literal["ok", "error", "skipped"]
    error: str | None = None

class OrgSettingsManager:
    def __init__(self, gh_org):
        """gh_org: PyGithub Organization object (from Github.get_organization(GW_ORG))."""
        self._org = gh_org

    def current(self) -> dict:
        """Return current live org settings as a dict."""
        return {
            "description": self._org.description or "",
            "default_repository_permission": self._org.default_repository_permission,
            "web_commit_signoff_required": self._org.web_commit_signoff_required,
            "members_can_create_repositories": self._org.members_can_create_repositories,
        }

    def apply(self, desired: dict) -> ResourceStatus:
        """Apply org settings; return ResourceStatus."""
        try:
            self._org.edit(**desired)
            return ResourceStatus(name="org_settings", status="ok")
        except Exception as exc:
            return ResourceStatus(name="org_settings", status="error", error=str(exc))

    def reset(self) -> ResourceStatus:
        """Restore org settings to GitHub safe defaults."""
        return self.apply(ORG_DEFAULTS)
```

## tests/test_manager_org.py

All tests mock PyGithub; no live network calls.

Key tests:
1. `apply()` calls `org.edit()` with the exact declared settings dict.
2. `apply()` returns `ResourceStatus(status="ok")` on success.
3. `apply()` returns `ResourceStatus(status="error")` when `org.edit()` raises.
4. `reset()` calls `apply()` with `ORG_DEFAULTS` values.
5. `current()` reads from org attributes and normalises `None → ""` for description.

---

Brain themes consulted:
- `brain/projects/gitweave/profile.md`
- `brain/cycles/themes/spec-driven-work-items.md`
- `brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md`
