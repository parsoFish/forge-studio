# Canonical gate-script template (N4 — the errexit-exempt fix)

> Plan 2.7 / friction N4. **Template, not lint** — there is deliberately no
> mechanism that inspects gate scripts. Author every multi-step gate script
> from this template and the errexit-exempt class cannot occur.

## When a gate is a script

The local gate (`testProcess.local.cmd` in `.forge/project.json`; the same
argv shape applies to a work item's own `quality_gate_cmd`) is a single argv
array and the orchestrator **hard-rejects
shell pipelines/chains** (`bash -c "… | …"`, `&&`, `;` — see
[`forge-project-contract.md`](./forge-project-contract.md) C1 and the
project-manager skill). When a gate genuinely needs several checks, the
escape hatch is a **committed script** invoked as one argv:

```json
"testProcess": { "local": { "cmd": ["bash", "scripts/gates/<name>.sh"] } }
```

That script is then the gate — and how it is written decides whether its
intermediate failures actually fail the gate.

## The trap this template kills (errexit-exempt asserts)

Bash `set -e` (errexit) **exempts `!`-negated commands**: `! grep -q bad file`
returning non-zero does NOT exit the script. So a script written as

```bash
set -e
go build ./...            # ✅ fails the script if it fails
! grep -q 'SDKv2' pkg.go  # ❌ NEVER fails the script — errexit-exempt
! grep -q 'TODO' demo.md  # ❌ same
grep -q 'PASS' out.log    # only THIS last command's status is the verdict
```

silently passes when the `! grep` asserts fail — during the betterado run
every operator-installed gate of this shape exempted its intermediate
asserts, and only the final command's exit code counted. The fix is not a
linter; it is never writing a bare `! cmd` assert.

## The template

```bash
#!/usr/bin/env bash
# Gate: <one line — what a PASS proves, e.g. "release_definition migrated off SDKv2">.
# Authored from docs/gate-script-template.md — keep the fail()/step discipline.
set -euo pipefail

step="init"
fail() { echo "GATE FAIL [${step}]: $*" >&2; exit 1; }
trap 'fail "command failed at line ${LINENO} (exit $?)"' ERR

# --- step: build ------------------------------------------------------------
step="build"
go build ./...

# --- step: forbidden pattern must be ABSENT ----------------------------------
# NEVER `! grep -q …` — errexit exempts `!`-negated commands, so its failure
# would not fail the gate. Make the polarity explicit:
step="sdkv2-absent"
if grep -rq 'helper/schema' internal/resources/release_definition/; then
  fail "SDKv2 helper/schema still referenced in release_definition"
fi

# --- step: required marker must be PRESENT -----------------------------------
step="framework-registered"
grep -q 'ReleaseDefinitionResource' internal/provider/provider.go \
  || fail "resource not registered with the framework provider"

# --- step: tests -------------------------------------------------------------
step="tests"
go test ./internal/resources/release_definition/...

echo "GATE PASS: release_definition is framework-native and green"
```

## Rules (all of them, every time)

1. **`set -euo pipefail`** on line one after the shebang — errexit + unset-var
   + pipe-failure propagation.
2. **Every assert is explicit** — either `if <bad-condition>; then fail …; fi`
   or `<must-succeed> || fail …`. **Never a bare `! cmd`** and never a bare
   trailing command as the implicit verdict.
3. **`trap … ERR` + a named `step`** — an unexpected failure reports *which*
   step died instead of silently exiting (or worse, not exiting).
4. **End with an explicit `echo "GATE PASS: …"`** stating what was proven —
   the pass line is evidence in the gate output, and it guarantees the last
   command is not itself an accidental verdict.
5. **Fail-first still applies** (contract C1): the script must exit non-zero
   on a clean tree before the work exists, and pass only once it lands.
6. **A gate observes, it never fixes** — no repo mutation inside a gate script.
   (Live acceptance gates that talk to a real service remain sanctioned via the
   project's `testProcess.acceptance` — the discipline here is about exit codes, not
   about what the checks touch.)

## Where this applies

- **PM work-item gates** (`skills/project-manager/SKILL.md`) — when one sharp
  command cannot express the gate, commit a script from this template instead
  of chaining.
- **Project quality gates / onboarding**
  ([`forge-project-contract.md`](./forge-project-contract.md) C1).
- **Review send-back sharp gates** — the `qualityGateCmd` an operator attaches
  to a send-back concern (`orchestrator/unifier-items.ts`, `ReviewConcern`).
