---
work_item_id: WI-1
initiative_id: INIT-2026-10-11-i2-apply-engine-terraform-retired
status: pending
depends_on: []
domain: packaging
acceptance_criteria:
  - given: "a clean checkout with no gitweave package installed"
    when: "pip install -e . runs from the repo root"
    then: "exits 0 and the gw entry point is registered on PATH"
  - given: "the installed package"
    when: "python3 -c 'import gitweave; from gitweave.cli import main' runs"
    then: "exits 0 with no ImportError"
  - given: "the installed package"
    when: "gw --help runs"
    then: "exits 0 and prints usage with at least the plan, apply, reset verbs listed"
files_in_scope:
  - pyproject.toml
  - gitweave/__init__.py
  - gitweave/cli.py
  - tests/test_package_structure.py
creates:
  - pyproject.toml
  - gitweave/__init__.py
  - gitweave/cli.py
  - tests/test_package_structure.py
estimated_iterations: 2
quality_gate_cmd:
  - python3
  - -m
  - pytest
  - tests/test_package_structure.py
---

# WI-1: Python package scaffold (pyproject.toml + gitweave entry point)

Target: `pyproject.toml` declaring `gw = "gitweave.cli:main"` console_scripts entry point,
`gitweave/__init__.py` marking the package, and `gitweave/cli.py` with a working argument
parser stub that dispatches `plan`, `apply`, `reset`, `org` sub-verbs (bodies can be
`raise NotImplementedError` at this stage — the gate only checks importability and help text).

## pyproject.toml requirements

```toml
[project]
name = "gitweave"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "PyJWT>=2.8",
    "cryptography>=41",
    "PyGithub>=2.3",
    "PyYAML>=6.0",
    "jsonschema>=4.0",
]

[project.scripts]
gw = "gitweave.cli:main"

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends.legacy:build"

[tool.pytest.ini_options]
testpaths = ["tests"]
```

Exact dependency versions must satisfy the `>=` bounds; pin the MINIMUM version only.

## gitweave/cli.py stub

`main()` uses `argparse` with sub-parsers: `plan`, `apply`, `reset`, and `org` (with
sub-sub-parsers `show`, `repos`, `teams`, `rulesets`). Each verb body can raise
`NotImplementedError("not yet implemented")` or `sys.exit(0)` for now — later WIs replace
the bodies. The stub must:
- register all verbs so `gw --help` lists them
- not crash on import

## tests/test_package_structure.py

Tests must fail when run against the repository BEFORE this WI's files exist:

```python
import importlib, subprocess, sys

def test_gitweave_importable():
    importlib.import_module("gitweave")
    from gitweave.cli import main  # noqa

def test_gw_help_exits_zero():
    result = subprocess.run(
        ["python3", "-m", "gitweave.cli", "--help"],
        capture_output=True,
    )
    # Alternatively invoke via the installed entry point if present
    assert result.returncode == 0

def test_pyproject_declares_gw_entrypoint():
    import tomllib, pathlib
    data = tomllib.loads(pathlib.Path("pyproject.toml").read_text())
    assert data["project"]["scripts"]["gw"] == "gitweave.cli:main"
```

Adapt if `tomllib` unavailable (Python < 3.11 fallback or `tomli` backport); the project
requires Python ≥ 3.11, so `tomllib` is stdlib.

---

Brain themes consulted:
- `brain/projects/gitweave/profile.md`
- `brain/cycles/themes/spec-driven-work-items.md`
- `brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md`
