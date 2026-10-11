---
work_item_id: WI-3
initiative_id: INIT-2026-10-11-i2-apply-engine-terraform-retired
status: pending
depends_on: []
domain: config
acceptance_criteria:
  - given: "schemas/org.schema.json exists"
    when: "jsonschema validates config/org.yaml against it"
    then: "exits 0 with no validation errors"
  - given: "schemas/teams.schema.json exists"
    when: "jsonschema validates config/teams.yaml against it"
    then: "exits 0 with no validation errors"
  - given: "schemas/org-ruleset.schema.json exists"
    when: "jsonschema validates config/rulesets.yaml against it"
    then: "exits 0 with no validation errors"
  - given: "tests/fixtures/org-empty.json exists"
    when: "the file is parsed as JSON"
    then: "it represents an empty org state with keys: org_settings, teams, repos, rulesets all present as empty collections"
files_in_scope:
  - schemas/org.schema.json
  - schemas/teams.schema.json
  - schemas/org-ruleset.schema.json
  - config/org.yaml
  - config/rulesets.yaml
  - tests/fixtures/org-empty.json
  - tests/test_gw_schemas.py
creates:
  - schemas/org.schema.json
  - schemas/teams.schema.json
  - schemas/org-ruleset.schema.json
  - config/org.yaml
  - config/rulesets.yaml
  - tests/fixtures/org-empty.json
  - tests/test_gw_schemas.py
estimated_iterations: 2
quality_gate_cmd:
  - python3
  - -m
  - pytest
  - tests/test_gw_schemas.py
---

# WI-3: JSON schemas + seed config files + org-empty fixture

Target: three new JSON Schema files, two new YAML config files (org settings and rulesets),
and one JSON fixture representing an empty org. All static data — no logic.

## schemas/org.schema.json

Validates `config/org.yaml`. Required fields:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["description", "default_repository_permission",
               "web_commit_signoff_required", "members_can_create_repositories"],
  "properties": {
    "description": {"type": "string"},
    "default_repository_permission": {"type": "string", "enum": ["read","write","none","admin"]},
    "web_commit_signoff_required": {"type": "boolean"},
    "members_can_create_repositories": {"type": "boolean"}
  },
  "additionalProperties": false
}
```

## schemas/teams.schema.json

Validates `config/teams.yaml` (existing format, not changed). Structure:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["teams"],
  "properties": {
    "teams": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": {"type": "string"},
          "description": {"type": "string"},
          "privacy": {"type": "string", "enum": ["secret","closed"]},
          "members": {"type": "array", "items": {"type": "string"}}
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

Read `config/teams.yaml` to confirm the exact existing structure before writing the schema.

## schemas/org-ruleset.schema.json

Minimum fields: `name` (str), `target` (branch|tag), `enforcement` (active|disabled), `rules[]`.
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["rulesets"],
  "properties": {
    "rulesets": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "target", "enforcement", "rules"],
        "properties": {
          "name": {"type": "string"},
          "target": {"type": "string", "enum": ["branch","tag"]},
          "enforcement": {"type": "string", "enum": ["active","disabled","evaluate"]},
          "rules": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["type"],
              "properties": {
                "type": {"type": "string"},
                "parameters": {"type": "object"}
              }
            }
          }
        }
      }
    }
  }
}
```

## config/org.yaml

Starter values (safe defaults that match GitHub reset targets from the initiative spec):
```yaml
description: ""
default_repository_permission: read
web_commit_signoff_required: false
members_can_create_repositories: true
```

## config/rulesets.yaml

Starter with one example ruleset (uses FORGE_RESOURCE_PREFIX in name):
```yaml
rulesets:
  - name: forge-main-protection
    target: branch
    enforcement: active
    rules:
      - type: required_linear_history
```

## tests/fixtures/org-empty.json

Represents an org with no managed resources and settings at GitHub defaults:
```json
{
  "org_settings": {
    "description": "",
    "default_repository_permission": "read",
    "web_commit_signoff_required": false,
    "members_can_create_repositories": true
  },
  "teams": [],
  "repos": [],
  "rulesets": []
}
```

## tests/test_gw_schemas.py

Validate each schema file validates its corresponding config/fixture:

```python
import json, pathlib, yaml, jsonschema

ROOT = pathlib.Path(__file__).parent.parent

def _load_schema(name):
    return json.loads((ROOT / "schemas" / name).read_text())

def _load_yaml(path):
    return yaml.safe_load((ROOT / path).read_text())

def test_org_schema_validates_org_yaml():
    jsonschema.validate(_load_yaml("config/org.yaml"), _load_schema("org.schema.json"))

def test_teams_schema_validates_teams_yaml():
    jsonschema.validate(_load_yaml("config/teams.yaml"), _load_schema("teams.schema.json"))

def test_ruleset_schema_validates_rulesets_yaml():
    jsonschema.validate(_load_yaml("config/rulesets.yaml"), _load_schema("org-ruleset.schema.json"))

def test_org_empty_fixture_is_valid_json_with_expected_keys():
    data = json.loads((ROOT / "tests/fixtures/org-empty.json").read_text())
    for key in ("org_settings", "teams", "repos", "rulesets"):
        assert key in data
    assert data["teams"] == []
    assert data["repos"] == []
    assert data["rulesets"] == []
```

---

Brain themes consulted:
- `brain/projects/gitweave/profile.md`
- `brain/cycles/themes/spec-driven-work-items.md`
- `brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md`
