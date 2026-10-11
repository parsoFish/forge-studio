---
work_item_id: WI-8
initiative_id: INIT-2026-10-11-i2-apply-engine-terraform-retired
status: pending
depends_on:
  - WI-6
  - WI-7
domain: cli
acceptance_criteria:
  - given: "GW_ORG is unset and --fixture is not provided"
    when: "gw plan runs"
    then: "exits non-zero and stderr contains 'GW_ORG'"
  - given: "tests/fixtures/org-empty.json exists"
    when: "gw plan --fixture tests/fixtures/org-empty.json runs"
    then: "exits 0 and stdout contains at least one + create line"
  - given: "GW_* are set"
    when: "gw apply --json runs"
    then: "exits 0 and stdout is valid JSON with 'statuses' and 'state' keys"
  - given: "GW_* are set"
    when: "gw reset runs"
    then: "exits 0"
  - given: "the installed package"
    when: "gw org show --json runs with GW_* set"
    then: "exits 0 and stdout is valid JSON"
  - given: "the installed package"
    when: "gw --help runs"
    then: "exits 0 and all verbs (plan, apply, reset, org) appear in output"
files_in_scope:
  - gitweave/cli.py
  - tests/test_cli.py
creates:
  - tests/test_cli.py
verification_artifact: gitweave/cli.py
estimated_iterations: 3
quality_gate_cmd:
  - python3
  - -m
  - pytest
  - tests/test_cli.py
---

# WI-8: CLI full wiring + read-back commands

Target: replace the stub in `gitweave/cli.py` with full verb dispatch. Wire `plan`,
`apply`, `reset`, and the four `org` sub-commands. Tests use `subprocess` or
`argparse` invocation — no live network (mock the engines).

## gitweave/cli.py — full spec

```python
import argparse, json, os, sys
from gitweave.plan import plan
from gitweave.apply import apply
from gitweave.reset import reset
from gitweave.auth import get_github_client

def _get_org_client():
    gh = get_github_client()
    return gh.get_organization(os.environ["GW_ORG"])

def cmd_plan(args):
    try:
        result = plan(fixture_path=args.fixture)
        result.print()
        sys.exit(0)
    except EnvironmentError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_apply(args):
    try:
        gh_org = _get_org_client()
        result = apply(gh_org, json_mode=args.json)
        if args.json:
            print(result.to_json())
        else:
            for s in result.statuses:
                print(f"  {'ok' if s.status=='ok' else 'ERROR'}: {s.name}"
                      + (f" — {s.error}" if s.error else ""))
        sys.exit(1 if result.has_errors else 0)
    except EnvironmentError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_reset(args):
    try:
        gh_org = _get_org_client()
        result = reset(gh_org)
        if result.nothing_changed:
            print("Nothing changed.")
        else:
            for s in result.statuses:
                print(f"  {'ok' if s.status=='ok' else 'ERROR'}: {s.name}")
        sys.exit(1 if any(s.status=="error" for s in result.statuses) else 0)
    except EnvironmentError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_org_show(args):
    gh_org = _get_org_client()
    from gitweave.managers.org import OrgSettingsManager
    print(json.dumps(OrgSettingsManager(gh_org).current(), indent=2))

def cmd_org_repos(args):
    from gitweave.managers.repos import ReposManager
    print(json.dumps([{"name": r.name} for r in ReposManager(_get_org_client()).list_managed()], indent=2))

def cmd_org_teams(args):
    from gitweave.managers.teams import TeamsManager
    print(json.dumps([{"name": t.name} for t in TeamsManager(_get_org_client()).list_managed()], indent=2))

def cmd_org_rulesets(args):
    from gitweave.managers.rulesets import RulesetsManager
    print(json.dumps(RulesetsManager(_get_org_client()).list_managed(), indent=2))

def main():
    parser = argparse.ArgumentParser(prog="gw", description="GitWeave org controller")
    sub = parser.add_subparsers(dest="command", required=True)

    # plan
    p_plan = sub.add_parser("plan", help="Diff declaration against org state")
    p_plan.add_argument("--fixture", metavar="PATH",
                        help="Use recorded fixture instead of live org")
    p_plan.set_defaults(func=cmd_plan)

    # apply
    p_apply = sub.add_parser("apply", help="Apply declaration to live org")
    p_apply.add_argument("--json", action="store_true",
                         help="Reset-before-apply mode; output JSON")
    p_apply.set_defaults(func=cmd_apply)

    # reset
    p_reset = sub.add_parser("reset", help="Delete prefixed resources + restore defaults")
    p_reset.set_defaults(func=cmd_reset)

    # org
    p_org = sub.add_parser("org", help="Read-back org state")
    org_sub = p_org.add_subparsers(dest="org_command", required=True)
    for name, fn in [("show", cmd_org_show), ("repos", cmd_org_repos),
                     ("teams", cmd_org_teams), ("rulesets", cmd_org_rulesets)]:
        p = org_sub.add_parser(name)
        p.add_argument("--json", action="store_true")
        p.set_defaults(func=fn)

    args = parser.parse_args()
    args.func(args)

if __name__ == "__main__":
    main()
```

## tests/test_cli.py

Use `subprocess.run(["python3", "-m", "gitweave.cli", ...])` or mock engines directly.
Network calls are mocked via `unittest.mock.patch`.

Key tests:
1. `gw --help` exits 0 and output mentions `plan apply reset org`.
2. `gw plan` without `--fixture` and `GW_ORG` unset → exit code 1, stderr contains `GW_ORG`.
3. `gw plan --fixture tests/fixtures/org-empty.json` with mocked config → exits 0.
4. `gw apply --json` with all mocked → exits 0 and stdout is parseable JSON.
5. `gw reset` with mocked → exits 0.
6. `gw org show --json` with mocked → exits 0 and stdout is JSON.

---

Brain themes consulted:
- `brain/projects/gitweave/profile.md`
- `brain/cycles/themes/spec-driven-work-items.md`
- `brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md`
