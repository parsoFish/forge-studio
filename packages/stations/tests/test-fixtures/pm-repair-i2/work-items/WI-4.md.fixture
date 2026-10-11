---
work_item_id: WI-4
initiative_id: INIT-2026-10-11-i2-apply-engine-terraform-retired
status: pending
depends_on:
  - WI-1
  - WI-3
domain: config
acceptance_criteria:
  - given: "config/org.yaml, config/teams.yaml, config/rulesets.yaml exist"
    when: "gitweave.config.load_config() is called from the repo root"
    then: "returns a dict with keys org_settings, teams, repos, rulesets; each validated against its JSON schema"
  - given: "a config/org.yaml with an invalid field (e.g. default_repository_permission: invalid)"
    when: "gitweave.config.load_config() is called"
    then: "raises jsonschema.ValidationError identifying the invalid field"
  - given: "config/org.yaml is missing"
    when: "gitweave.config.load_config() is called"
    then: "raises FileNotFoundError with a descriptive message"
files_in_scope:
  - gitweave/config.py
  - tests/test_config.py
creates:
  - gitweave/config.py
  - tests/test_config.py
estimated_iterations: 2
quality_gate_cmd:
  - python3
  - -m
  - pytest
  - tests/test_config.py
---

# WI-4: Config loading + validation module (gitweave/config.py)

Target: `gitweave/config.py` that loads all config files from the repo and validates each
against its JSON schema. Returns a single unified config dict consumed by managers and
plan/apply/reset engines.

## gitweave/config.py spec

```python
# gitweave/config.py
import json
import pathlib
import yaml
import jsonschema

REPO_ROOT = pathlib.Path(__file__).parent.parent

SCHEMA_MAP = {
    "org_settings":  "schemas/org.schema.json",
    "teams":         "schemas/teams.schema.json",    # wraps config/teams.yaml top-level
    "rulesets":      "schemas/org-ruleset.schema.json",
}

def _load_yaml(rel: str) -> dict:
    path = REPO_ROOT / rel
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    return yaml.safe_load(path.read_text()) or {}

def _load_schema(rel: str) -> dict:
    return json.loads((REPO_ROOT / rel).read_text())

def load_config() -> dict:
    """Load and validate all config files. Returns unified config dict."""
    org_raw = _load_yaml("config/org.yaml")
    jsonschema.validate(org_raw, _load_schema("schemas/org.schema.json"))

    teams_raw = _load_yaml("config/teams.yaml")
    jsonschema.validate(teams_raw, _load_schema("schemas/teams.schema.json"))

    rulesets_raw = _load_yaml("config/rulesets.yaml")
    jsonschema.validate(rulesets_raw, _load_schema("schemas/org-ruleset.schema.json"))

    # Repos: scan config/repos/*.yaml (no top-level schema enforced yet)
    repos = []
    repos_dir = REPO_ROOT / "config" / "repos"
    if repos_dir.exists():
        for f in sorted(repos_dir.glob("*.yaml")):
            repo_cfg = yaml.safe_load(f.read_text()) or {}
            repo_cfg.setdefault("slug", f.stem)
            repos.append(repo_cfg)

    return {
        "org_settings": org_raw,
        "teams":  teams_raw.get("teams", []),
        "repos":  repos,
        "rulesets": rulesets_raw.get("rulesets", []),
    }
```

## tests/test_config.py

Uses `tmp_path` fixtures to create minimal config trees. Tests must be self-contained
(no reads from the real config files — pass a `config_root` param or monkeypatch
`gitweave.config.REPO_ROOT`).

Key test cases:
1. Valid minimal config loads without error.
2. Invalid `default_repository_permission` value raises `jsonschema.ValidationError`.
3. Missing `config/org.yaml` raises `FileNotFoundError` with path in message.
4. Returns dict with `org_settings`, `teams`, `repos`, `rulesets` keys.
5. `repos` list populated from `config/repos/*.yaml` files.

---

Brain themes consulted:
- `brain/projects/gitweave/profile.md`
- `brain/cycles/themes/spec-driven-work-items.md`
- `brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md`
