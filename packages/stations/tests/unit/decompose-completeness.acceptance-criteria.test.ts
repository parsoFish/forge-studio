/**
 * forge-mfv5.1.26 / D-47 — an initiative acceptance criterion whose WHEN is a
 * runnable command must be carried, whole, by at least one work item's
 * `quality_gate_cmd`; a prose criterion is never refused.
 *
 * Provenance: the AC and WI-gate shapes below are copied from the real
 * gitweave I1 plan (2026-10-10) —
 *   manifest  _queue/ready-for-review/INIT-2026-10-10-i1-honest-baseline.md
 *   WIs       _logs/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline/work-items-snapshot/WI-{1..5}.md
 * where `checkDecomposeCompleteness` reported `stated_units: 0` while AC2
 * ("`python3 -m pytest tests/` runs") was gated by no work item at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { uncoveredAcceptanceCriteria } from '../../phases/decompose-completeness.ts';
import type { WorkItem } from '@forge/flows';

type Ac = { given: string; when: string; then: string };

const I1_ACS: Ac[] = [
  {
    given: 'the pruned tree on a machine with git, Python, and Terraform (no Docker required)',
    when:
      'the CI gate command runs: `python3 -m pytest tests/test_structure.py tests/test_overlay_schema.py ' +
      'tests/test_copier_schema.py tests/test_copier_schema_ci.py && yamllint .github/workflows/`',
    then: 'all checks pass locally and the equivalent GitHub Actions check on the PR is green',
  },
  {
    given: 'the whole `tests/` directory after pruning',
    when: '`python3 -m pytest tests/` runs without any `--deselect` flags',
    then: 'zero tests fail',
  },
  {
    given: 'the remote GitHub repository',
    when: '`git ls-remote origin archive/april-2026` is checked and its tip SHA is compared to the pre-prune `main` HEAD',
    then: 'the archive branch exists and its tip SHA equals the pre-prune `main` HEAD',
  },
  {
    given: 'the repository root',
    when: 'the instruction files `AGENTS.md` and `CLAUDE.md` are read',
    then: '`AGENTS.md` is the single authoritative source of operator instructions',
  },
  {
    given: 'the repository root after the prune',
    when: '`cat LICENSE` and `cat CLA.md` are read',
    then: '`LICENSE` contains verbatim AGPL-3.0-or-later text',
  },
];

function wi(id: string, gate: string[]): WorkItem {
  return {
    work_item_id: id,
    initiative_id: 'INIT-2026-10-10-i1-honest-baseline',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'a', when: 'b', then: 'c' }],
    files_in_scope: ['tests/x.py'],
    estimated_iterations: 1,
    body: 'Body.',
    quality_gate_cmd: gate,
  };
}

/** I1's real gates — each WI gates only its own new file. */
const I1_WIS: WorkItem[] = [
  wi('WI-1', ['python3', '-m', 'pytest', 'tests/test_pruned_artefacts.py']),
  wi('WI-2', ['python3', '-m', 'pytest', 'tests/test_structure.py::TestRepoStructure::test_bootstrap_script_exits_zero']),
  wi('WI-3', ['python3', '-m', 'pytest', 'tests/test_example_template_removed.py']),
  wi('WI-4', ['python3', '-m', 'pytest', 'tests/test_repo_hygiene.py']),
  wi('WI-5', ['python3', '-m', 'pytest', 'tests/test_legal_files.py']),
];

test('I1: AC1 (pytest && yamllint) and AC2 (pytest tests/) are refused; AC3-5 (prose) are not', () => {
  const refused = uncoveredAcceptanceCriteria(I1_ACS, I1_WIS);
  assert.equal(refused.length, 2, refused.join('\n'));
  assert.match(refused[0]!, /^AC1\b/);
  assert.ok(refused[0]!.includes(I1_ACS[0]!.when), 'AC1 is named by its WHEN, verbatim');
  assert.match(refused[1]!, /^AC2\b/);
  assert.ok(refused[1]!.includes(I1_ACS[1]!.when), 'AC2 is named by its WHEN, verbatim');
});

test('positive control: a WI gating `python3 -m pytest tests/` carries AC2', () => {
  const items = [...I1_WIS, wi('WI-6', ['python3', '-m', 'pytest', 'tests/'])];
  const refused = uncoveredAcceptanceCriteria([I1_ACS[1]!], items);
  assert.deepEqual(refused, []);
});

test('whole-token: `pytest tests/x.py` does NOT carry `pytest tests/`', () => {
  const ac: Ac = { given: 'g', when: '`pytest tests/` runs', then: 't' };
  assert.equal(uncoveredAcceptanceCriteria([ac], [wi('WI-1', ['pytest', 'tests/x.py'])]).length, 1);
  assert.deepEqual(uncoveredAcceptanceCriteria([ac], [wi('WI-1', ['pytest', 'tests/', '-q'])]), []);
});

test('&&-split: one segment carried and one not → refused, naming the uncarried segment', () => {
  const ac: Ac = { given: 'g', when: '`go test ./... && yamllint .github/`', then: 't' };
  const refused = uncoveredAcceptanceCriteria([ac], [wi('WI-1', ['go', 'test', './...'])]);
  assert.equal(refused.length, 1);
  assert.match(refused[0]!, /yamllint \.github\//);
  const uncarriedPart = refused[0]!.split('; when:')[0]!;
  assert.ok(!uncarriedPart.includes('go test'), 'the carried segment is not listed as uncarried');
  const both = [wi('WI-1', ['go', 'test', './...']), wi('WI-2', ['yamllint', '.github/'])];
  assert.deepEqual(uncoveredAcceptanceCriteria([ac], both), [], 'segments may be carried by different WIs');
});

test('`;`-split segments are each checked', () => {
  const ac: Ac = { given: 'g', when: '`ruff check . ; npm test`', then: 't' };
  assert.equal(uncoveredAcceptanceCriteria([ac], [wi('WI-1', ['npm', 'test'])]).length, 1);
});

test('empty acceptance_criteria → nothing refused', () => {
  assert.deepEqual(uncoveredAcceptanceCriteria([], I1_WIS), []);
});

test('a WHEN whose first backtick span is not a runner is never refused (prose stays advisory)', () => {
  const acs: Ac[] = [
    { given: 'g', when: '`make build` succeeds and then `pytest` runs', then: 't' },
    { given: 'g', when: 'the tests run', then: 't' },
  ];
  assert.deepEqual(uncoveredAcceptanceCriteria(acs, []), []);
});
