/**
 * forge-mfv5.1.8 / forge-mfv5.1.9 — Python-aware onboarding + demo authoring,
 * and a scoped-gate proposal for a partly-red-by-design suite.
 *
 * Re-verified at pickup (591f75a2 → HEAD): the demo-design decision tree the
 * bead was measured against (Node/Go-only surface signals: a package.json
 * preview/serve script or a next-config file for UI; a Go SDK import or a
 * Go test file for live API; a package.json "bin" field or a CLI/main
 * entrypoint file for CLI) was deleted by e34aa1a94 ("demo-design authors
 * the declaration, not a generated composer") — landed the same day, after
 * the measured pass. `demo-design`
 * no longer does surface detection of ANY kind; it is authoring guidance for
 * the bare-argv capture-command rule. So there is no decision tree left to
 * teach Python branches to. The still-live gaps this pins instead:
 *
 *   1. `skills/demo-design/SKILL.md`'s only worked example of the bare-argv
 *      rule is npm-flavored (`npm run demo`) — no Python analog, even though
 *      the rule itself is language-agnostic.
 *   2. `skills/forge-onboard-project/SKILL.md` Step 4 (C1's truthful
 *      done-signal) is silent on what to do when the project's only natural
 *      whole-suite command is red at HEAD BY DESIGN (a partly-red suite,
 *      e.g. permanently-red TDD stubs) rather than because no work has
 *      landed yet — exactly the `python-unonboarded` fixture's shape
 *      (`python -m pytest tests/`: 323 failed / 774 passed at HEAD;
 *      `.github/workflows/ci.yaml` actually runs 4 of the 42 root test
 *      files). C1 requires green at HEAD; declaring the whole suite would
 *      declare a gate that can never pass.
 *   3. `skills/onboarding-agent/SKILL.md` Step 2 — the autonomous agent that
 *      actually writes `testProcess.local.cmd` — detects a candidate command
 *      and writes it without ever confirming it is green at HEAD first, so
 *      it would happily declare a doomed whole-suite command on a project
 *      shaped like the fixture above.
 *
 * No CODE does surface/app-type (UI/live-API/CLI) detection at onboarding
 * time to check here: `packages/projects/preflight-demo.ts`'s DEMO-SKILL
 * clause is purely structural (`extractDrivableCommand` — bare-argv syntax,
 * no language awareness at all), and `packages/projects/gate-recipes.ts`'s
 * `detectProjectLanguage` (a DIFFERENT concern — the per-WI sharp-gate
 * recipe, consumed only by `project-manager`) is already Python-aware
 * (`pyproject.toml` / `setup.py` / `setup.cfg` → `'python'`, with its own
 * `pytest -k <new> -x` recipe) — so there is nothing to teach it and no ADR
 * 034 constraint is at stake either way.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel';

const DEMO_DESIGN_SKILL = join(FORGE_ROOT, 'skills', 'demo-design', 'SKILL.md');
const FORGE_ONBOARD_PROJECT_SKILL = join(FORGE_ROOT, 'skills', 'forge-onboard-project', 'SKILL.md');
const ONBOARDING_AGENT_SKILL = join(FORGE_ROOT, 'skills', 'onboarding-agent', 'SKILL.md');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

test('demo-design/SKILL.md names a Python capture-command example alongside the npm one, so the bare-argv rule reads as language-agnostic rather than npm-only', () => {
  const text = read(DEMO_DESIGN_SKILL);
  assert.ok(
    text.includes('language-agnostic'),
    'must say the bare-argv command rule is language-agnostic, not npm-specific',
  );
  assert.ok(
    text.includes('pytest -q tests/test_report.py'),
    'must show a concrete Python capture-command example (pytest) beside the existing npm example',
  );
});

test('forge-onboard-project/SKILL.md Step 4 proposes a SCOPED gate (the command CI actually runs, or the files under change) when the whole-suite command is red at HEAD by design, and says to ask the operator rather than accepting a doomed gate', () => {
  const text = read(FORGE_ONBOARD_PROJECT_SKILL);
  assert.ok(
    text.includes('red at HEAD by design'),
    'must name the partly-red-by-design case (not the no-work-yet case C1 discrimination already covers)',
  );
  assert.ok(
    text.includes('.github/workflows'),
    'must point at measuring what CI itself actually runs as the first scoped-gate candidate',
  );
  assert.ok(
    text.includes('ask the operator for the gate'),
    'must say to ask the operator when no scope measures green, rather than accepting a whole-suite command that can never pass',
  );
  assert.ok(
    text.includes('never accept a whole-suite command that can never pass'),
    'must explicitly rule out declaring a whole-suite command that can never be green',
  );
});

test('onboarding-agent/SKILL.md Step 2 verifies the candidate quality-gate command is green at HEAD before declaring it, and stops-and-reports (like an unfixable hard clause) rather than declaring a doomed whole-suite command', () => {
  const text = read(ONBOARDING_AGENT_SKILL);
  assert.ok(
    text.includes('confirm it exits green at HEAD before'),
    'must verify the candidate command actually passes at HEAD before writing it to testProcess.local.cmd — C1 requires green at HEAD, not just a plausible shape',
  );
  assert.ok(
    text.includes('.github/workflows'),
    'must propose the command CI itself actually runs as the scoped alternative',
  );
  assert.ok(
    text.includes('stop and report'),
    'must fall back to stop-and-report (same as an unfixable hard clause) when no scope measures green',
  );
});

test('sanity: gate-recipes.ts (a DIFFERENT concern — the per-WI sharp-gate recipe) is already Python-aware, so this bead does not touch it', () => {
  const text = read(join(FORGE_ROOT, 'packages', 'projects', 'gate-recipes.ts'));
  assert.ok(text.includes("pyproject.toml') || has('setup.py') || has('setup.cfg')"), 'sanity: detectProjectLanguage already recognises Python manifests');
  assert.ok(text.includes("'pytest'"), 'sanity: the python recipe already exists');
});

test('sanity: no surface/app-type (UI vs live-API vs CLI) detection code exists at onboarding/demo time — DEMO-SKILL is purely structural, no language branches to teach Python', () => {
  const text = read(join(FORGE_ROOT, 'packages', 'projects', 'preflight-demo.ts'));
  assert.ok(!/next\.config|package\.json.*bin|cli\.ts|main\.go|_test\.go/.test(text), 'sanity: preflight-demo.ts carries no Node/Go-specific surface-detection signals to mirror in Python');
});
