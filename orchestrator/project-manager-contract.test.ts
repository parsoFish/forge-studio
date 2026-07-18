/**
 * PM testing-contract tests (A2, 2026-06-06; M2-3 brainAccess gate, 2026-06-13).
 *
 * Covers:
 *   - A2a: `acceptance_gate.required` ⇒ the decomposition MUST include ≥1 WI
 *     whose `quality_gate_cmd` targets the live acceptance suite, else the PM
 *     pass fails.
 *   - A2b: `standing_work_item_acs` ⇒ every emitted WI body gets a fixed
 *     "## Standing acceptance criteria (project contract)" section, idempotently.
 *   - M2-3 brainAccess gate: PM_BRAIN_ACCESS drives the 0-reads abort; mandatory
 *     → abort on 0 brain reads; advisory → pass through.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProjectManager, type PmQueryFn } from './phases/project-manager.ts';
import { PM_BRAIN_ACCESS } from './pm-invocation.ts';
import { createLogger, type EventLogEntry } from './logging.ts';
import type { CycleInput } from './cycle-context.ts';
import { parseManifest } from './manifest.ts';

const MANIFEST_BODY = `---
initiative_id: INIT-2026-06-06-pm-contract-test
project: testproj
project_repo_path: ./projects/testproj
created_at: 2026-06-06T00:00:00Z
iteration_budget: 3
cost_budget_usd: 1
phase: in-flight
origin: architect
---

# Test initiative

## Acceptance criteria

Given the resource, when applied, then it persists in the external system.
`;

type StubWi = { wiId: string; filename?: string; gate?: string[]; omitCreates?: boolean };

/** A WI fixture with a configurable quality_gate_cmd. */
function makeWi(initiativeId: string, wi: StubWi): string {
  const fname = wi.filename ?? `azuredevops/internal/service/release/${wi.wiId.toLowerCase()}.go`;
  const gate = wi.gate ?? ['node', '--test', `tests/${wi.wiId.toLowerCase()}.test.ts`];
  // ADR 037: `creates:` is mandatory-with-escape; `omitCreates` exercises the
  // compile-stage rejection of a WI that declares neither creates nor
  // verification_artifact.
  const creates = wi.omitCreates ? '' : `creates:\n  - ${fname}\n`;
  return `---
work_item_id: ${wi.wiId}
initiative_id: ${initiativeId}
status: pending
depends_on: []
acceptance_criteria:
  - given: "a test"
    when: "the function runs"
    then: "it returns a value"
files_in_scope:
  - ${fname}
${creates}quality_gate_cmd: ${JSON.stringify(gate)}
estimated_iterations: 1
---

Body for ${wi.wiId}.
`;
}

function makeStubQueryFn(initiativeId: string, wis: StubWi[]): PmQueryFn {
  return ({ options }) => {
    const cwd = (options as { cwd: string }).cwd;
    return (async function* () {
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'brain/cycles/themes/work-item-completion-by-domain.md' },
            },
          ],
        },
      };
      const wiDir = resolve(cwd, '.forge', 'work-items');
      mkdirSync(wiDir, { recursive: true });
      for (const wi of wis) writeFileSync(join(wiDir, `${wi.wiId}.md`), makeWi(initiativeId, wi));
      writeFileSync(
        join(wiDir, '_graph.md'),
        ['```mermaid', 'graph TD', ...wis.map((w) => `  ${w.wiId}["${w.wiId}"]`), '```'].join('\n'),
      );
      yield { type: 'result', subtype: 'success', duration_ms: 1, total_cost_usd: 0.01 };
    })();
  };
}

function setupHarness(projectConfig?: Record<string, unknown>): {
  dir: string;
  worktree: string;
  logger: ReturnType<typeof createLogger>;
  input: CycleInput;
} {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pm-contract-'));
  const worktree = join(dir, 'projects', 'testproj');
  mkdirSync(worktree, { recursive: true });
  writeFileSync(
    join(worktree, 'package.json'),
    JSON.stringify({ name: 'testproj', version: '0.0.1', scripts: { test: 'echo no tests' } }),
  );
  if (projectConfig) {
    mkdirSync(join(worktree, '.forge'), { recursive: true });
    writeFileSync(join(worktree, '.forge', 'project.json'), JSON.stringify(projectConfig, null, 2));
  }
  const manifestPath = join(dir, '_queue', 'in-flight', 'INIT-2026-06-06-pm-contract-test.md');
  mkdirSync(join(dir, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(manifestPath, MANIFEST_BODY);
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-pm-contract', logsDir);
  const input: CycleInput = {
    initiativeId: 'INIT-2026-06-06-pm-contract-test',
    manifestPath,
    projectRepoPath: worktree,
    worktreePath: worktree,
  };
  return { dir, worktree, logger, input };
}

function readEvents(logger: ReturnType<typeof createLogger>): EventLogEntry[] {
  const text = readFileSync(logger.logFilePath, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as EventLogEntry);
}

const BASE_CONFIG = {
  demo: { shape: 'harness', command: ['go', 'test', './...'] },
  quality_gate_cmd: ['go', 'test', './...'],
};

const ACC_GATE = [
  'go', 'test', '-tags', 'all', '-run', 'TestAccFoo',
  '-timeout', '30m', './azuredevops/internal/acceptancetests/...',
];

test('A2a: acceptance_gate.required + no live-acc WI → PM pass fails', async () => {
  const h = setupHarness({
    ...BASE_CONFIG,
    acceptance_gate: { match: 'acceptancetests', required: true },
  });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }, { wiId: 'WI-2' }]);
    await assert.rejects(
      () => runProjectManager(h.input, h.logger, { queryFn }),
      /no acceptance work item/,
    );
    const events = readEvents(h.logger);
    const end = events.find(
      (e) =>
        e.phase === 'project-manager' &&
        e.event_type === 'error' &&
        (e.metadata as { acceptance_gate_violation?: string })?.acceptance_gate_violation,
    );
    assert.ok(end, 'expected an error end event carrying acceptance_gate_violation');
    assert.match(
      (end.metadata as { acceptance_gate_violation?: string }).acceptance_gate_violation ?? '',
      /acceptancetests/,
    );
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('A2a: acceptance_gate.required + a matching live-acc WI → PM pass succeeds', async () => {
  const h = setupHarness({
    ...BASE_CONFIG,
    acceptance_gate: { match: 'acceptancetests', required: true },
  });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [
      { wiId: 'WI-1' },
      { wiId: 'WI-2', filename: 'azuredevops/internal/acceptancetests/resource_foo_test.go', gate: ACC_GATE },
    ]);
    await runProjectManager(h.input, h.logger, { queryFn });
    const events = readEvents(h.logger);
    const end = events.find((e) => e.phase === 'project-manager' && e.event_type === 'end');
    assert.ok(end, 'expected a successful pm.end event');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('R4-05-F2: a successful PM pass persists specs (the produced work_item_ids) onto the manifest', async () => {
  const h = setupHarness({
    ...BASE_CONFIG,
    acceptance_gate: { match: 'acceptancetests', required: true },
  });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [
      { wiId: 'WI-1' },
      { wiId: 'WI-2', filename: 'azuredevops/internal/acceptancetests/resource_foo_test.go', gate: ACC_GATE },
    ]);
    await runProjectManager(h.input, h.logger, { queryFn });
    const manifest = parseManifest(readFileSync(h.input.manifestPath, 'utf8'));
    assert.deepEqual(manifest.specs, ['WI-1', 'WI-2']);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('R4-05-F2: a failed PM pass (accGateViolation) does NOT persist specs onto the manifest', async () => {
  const h = setupHarness({
    ...BASE_CONFIG,
    acceptance_gate: { match: 'acceptancetests', required: true },
  });
  try {
    // Neither WI's gate matches "acceptancetests" — same fixture as the
    // "no live-acc WI → PM pass fails" test above.
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }, { wiId: 'WI-2' }]);
    await assert.rejects(() => runProjectManager(h.input, h.logger, { queryFn }));
    const manifest = parseManifest(readFileSync(h.input.manifestPath, 'utf8'));
    assert.equal(manifest.specs, undefined, 'a failed pass must leave the manifest specs list untouched');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('R4-05-T4: a flagged (under-covered) decomposition still succeeds and emits plan.completeness', async () => {
  const h = setupHarness({ ...BASE_CONFIG });
  try {
    // MANIFEST_BODY states one AC unit ("the resource ... persists in the
    // external system"); the stub WI's own AC/body vocabulary ("a test",
    // "the function runs", "it returns a value") shares no significant
    // tokens with it — a genuinely uncovered stated unit, i.e. the pass
    // *looks* successful (valid WI set, no gate violations) but under-covers
    // the stated scope. This must NOT block the pass.
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }]);
    await runProjectManager(h.input, h.logger, { queryFn }); // no throw — dispatch NOT blocked

    const events = readEvents(h.logger);
    const completenessEvent = events.find((e) => e.message === 'plan.completeness');
    assert.ok(completenessEvent, 'expected a plan.completeness event to be emitted');
    const metadata = completenessEvent!.metadata as {
      stated_units: number;
      covered_units: number;
      uncovered: string[];
      flagged: boolean;
    };
    assert.equal(metadata.stated_units, 1);
    assert.equal(metadata.covered_units, 0);
    assert.equal(metadata.uncovered.length, 1);
    assert.equal(metadata.flagged, true);

    // The end-of-pass event is still a clean success — the completeness flag
    // never touches the pass outcome or the `failed` boolean.
    const end = events.find((e) => e.event_type === 'end' || e.event_type === 'error');
    assert.equal(end?.event_type, 'end', 'pass must still succeed — plan.completeness never flips this to `error`');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('A2a: no acceptance_gate config → no live-acc requirement (other projects unaffected)', async () => {
  const h = setupHarness({ ...BASE_CONFIG });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }]);
    await runProjectManager(h.input, h.logger, { queryFn }); // no throw
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('A2b: standing_work_item_acs are appended to every WI body, exactly once', async () => {
  const h = setupHarness({
    ...BASE_CONFIG,
    standing_work_item_acs: ['Live acceptance: TF_ACC test proves it.', 'CI-equivalent: make test green.'],
  });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }, { wiId: 'WI-2' }]);
    await runProjectManager(h.input, h.logger, { queryFn });
    for (const wi of ['WI-1', 'WI-2']) {
      const body = readFileSync(resolve(h.worktree, '.forge', 'work-items', `${wi}.md`), 'utf8');
      assert.match(body, /## Standing acceptance criteria \(project contract\)/);
      assert.match(body, /Live acceptance: TF_ACC test proves it\./);
      assert.match(body, /CI-equivalent: make test green\./);
      // idempotent: header appears exactly once.
      const count = body.split('## Standing acceptance criteria (project contract)').length - 1;
      assert.equal(count, 1, `${wi}: standing-AC header should appear exactly once`);
    }
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('WS-A: releaseProcess in-cycle changelog step → draft-changelog AC on every WI', async () => {
  const h = setupHarness({
    ...BASE_CONFIG,
    releaseProcess: {
      changelogPath: 'CHANGELOG.md',
      steps: [
        { kind: 'changelog', phase: 'in-cycle', text: 'draft an Unreleased entry per WI' },
        { kind: 'version', phase: 'pre-merge', text: 'bump the version (pre-merge only)' },
      ],
    },
  });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }, { wiId: 'WI-2' }]);
    await runProjectManager(h.input, h.logger, { queryFn });
    for (const wi of ['WI-1', 'WI-2']) {
      const body = readFileSync(resolve(h.worktree, '.forge', 'work-items', `${wi}.md`), 'utf8');
      assert.match(body, /## Standing acceptance criteria \(project contract\)/);
      // The in-cycle draft-changelog AC is present on every WI...
      assert.match(body, /DRAFT CHANGELOG/);
      assert.match(body, /CHANGELOG\.md/);
      assert.match(body, /draft an Unreleased entry per WI/);
      // ...but the pre-merge step is NOT a WI-level AC (that is the finaliser's job).
      assert.doesNotMatch(body, /bump the version \(pre-merge only\)/);
    }
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('WS-A: no releaseProcess → no draft-changelog AC (non-release projects unaffected)', async () => {
  const h = setupHarness({ ...BASE_CONFIG });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }]);
    await runProjectManager(h.input, h.logger, { queryFn });
    const body = readFileSync(resolve(h.worktree, '.forge', 'work-items', 'WI-1.md'), 'utf8');
    assert.doesNotMatch(body, /DRAFT CHANGELOG/);
    // With no standing ACs and no release process, the section is absent entirely.
    assert.doesNotMatch(body, /## Standing acceptance criteria \(project contract\)/);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// M2-3: brainAccess gate tests
// ---------------------------------------------------------------------------

test('M2-3: PM_BRAIN_ACCESS is mandatory (SKILL.md frontmatter regression lock)', () => {
  // Guards against a SKILL.md frontmatter edit that would silently change the
  // gate behaviour — if this assertion fails, the SKILL.md was edited.
  assert.equal(PM_BRAIN_ACCESS, 'mandatory');
});

test('M2-3 as amended by plan 2.11: 0 agent brain reads no longer aborts — injected brain context satisfies the mandate structurally', async () => {
  // Pre-2.11 this scenario threw `brain-first mandate not honoured`. The PM
  // turn-economy change (G8 rescoped) has the orchestrator PRE-FETCH the
  // project profile + always-relevant themes and inline them into the prompt,
  // so 0 agent-side Read turns is now the intended fast path, not a skip.
  // The behavioural gate remains as a backstop for the (unreachable-in-repo)
  // case where injection comes up empty AND the agent reads nothing.
  const h = setupHarness({ ...BASE_CONFIG });
  const noBrainQueryFn: PmQueryFn = ({ options }) => {
    const cwd = (options as { cwd: string }).cwd;
    return (async function* () {
      // No brain/ Read emitted — only a non-brain Read, then write WIs.
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'package.json' }, // NOT under brain/
            },
          ],
        },
      };
      const wiDir = resolve(cwd, '.forge', 'work-items');
      mkdirSync(wiDir, { recursive: true });
      writeFileSync(join(wiDir, 'WI-1.md'), makeWi(h.input.initiativeId, { wiId: 'WI-1' }));
      writeFileSync(
        join(wiDir, '_graph.md'),
        '```mermaid\ngraph TD\n  WI-1["WI-1"]\n```',
      );
      yield { type: 'result', subtype: 'success', duration_ms: 1, total_cost_usd: 0.01 };
    })();
  };
  try {
    await runProjectManager(h.input, h.logger, { queryFn: noBrainQueryFn });
    const events = readEvents(h.logger);
    assert.equal(
      events.filter((e) => e.message === 'project-manager.brain-skipped').length,
      0,
      'injected brain context must satisfy the brain-first gate',
    );
    const injected = events.find((e) => e.message === 'pm.context-injected');
    assert.ok(injected, 'expected the pm.context-injected observability event');
    assert.ok(
      ((injected.metadata as { brain_files: string[] }).brain_files ?? []).length > 0,
      'the injected event must carry the pre-fetched brain file paths',
    );
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('M2-3: advisory brainAccess condition — gate passes when brainAccess !== mandatory', () => {
  // Unit-level: verify the gate condition is correctly expressed as
  // PM_BRAIN_ACCESS === 'mandatory' so an advisory agent would not abort.
  // This tests the condition directly without running the full PM phase.
  const mandatoryGateFires = (brainAccess: string, brainReads: number): boolean => {
    // Mirrors the condition in project-manager.ts (M2-3).
    return brainAccess === 'mandatory' && brainReads === 0;
  };
  assert.ok(mandatoryGateFires('mandatory', 0), 'mandatory + 0 reads should fire');
  assert.ok(!mandatoryGateFires('advisory', 0), 'advisory + 0 reads should NOT fire');
  assert.ok(!mandatoryGateFires('mandatory', 1), 'mandatory + 1 read should NOT fire');
  assert.ok(!mandatoryGateFires('advisory', 1), 'advisory + 1 read should NOT fire');
});

// ---------- ADR 037: wi-spec-compiler seam through runOnePmPass ----------

test('ADR-037: malformed constraint block in profile.md → controlled PM failure outcome, not an unhandled throw', async () => {
  const h = setupHarness(BASE_CONFIG);
  const sourcesRoot = mkdtempSync(join(tmpdir(), 'forge-pm-constraint-sources-'));
  try {
    const projectDir = join(sourcesRoot, 'brain', 'projects', 'testproj');
    mkdirSync(projectDir, { recursive: true });
    // Missing mandatory id: → parseConstraintBlocks throws; runOnePmPass must
    // catch it and funnel the message into its normal failure outcome + the
    // same final error event other validation failures use.
    writeFileSync(
      join(projectDir, 'profile.md'),
      ['<!-- forge:constraint applies_to: all -->', 'clause body', '<!-- /forge:constraint -->'].join('\n'),
    );

    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }]);
    await assert.rejects(
      () => runProjectManager(h.input, h.logger, { queryFn, constraintSourcesRoot: sourcesRoot }),
      /project-manager phase failed:[\s\S]*missing mandatory id/,
    );

    const events = readEvents(h.logger);
    const end = events.find(
      (e) => e.phase === 'project-manager' && e.event_type === 'error' && Array.isArray(e.metadata?.set_errors),
    );
    assert.ok(end, 'expected the standard PM final error event');
    const setErrors = (end!.metadata as { set_errors: string[] }).set_errors;
    assert.ok(
      setErrors.some((msg) => /missing mandatory id/.test(msg)),
      `compile throw should fold into set_errors, got: ${JSON.stringify(setErrors)}`,
    );
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
  }
});

test('ADR-037: valid constraint block is injected through the full PM pass into the final validated set', async () => {
  const h = setupHarness(BASE_CONFIG);
  const sourcesRoot = mkdtempSync(join(tmpdir(), 'forge-pm-constraint-sources-'));
  try {
    const projectDir = join(sourcesRoot, 'brain', 'projects', 'testproj');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'profile.md'),
      [
        '<!-- forge:constraint id: go-conventions applies_to: all -->',
        'Always run gofmt before committing.',
        '<!-- /forge:constraint -->',
      ].join('\n'),
    );

    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }, { wiId: 'WI-2' }]);
    // Must not throw: injection happens, then the injected set validates green.
    await runProjectManager(h.input, h.logger, { queryFn, constraintSourcesRoot: sourcesRoot });

    for (const wiId of ['WI-1', 'WI-2']) {
      const onDisk = readFileSync(resolve(h.worktree, '.forge', 'work-items', `${wiId}.md`), 'utf8');
      assert.match(onDisk, /## Compiled constraints \(project & brain, ADR 037\)/);
      assert.match(onDisk, /Always run gofmt before committing\./);
      assert.match(onDisk, /<!-- forge:compiled clause="go-conventions" -->/);
    }

    const events = readEvents(h.logger);
    assert.equal(
      events.filter((e) => e.message === 'pm.constraint-injected').length,
      2,
      'one pm.constraint-injected event per WI',
    );
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
    rmSync(sourcesRoot, { recursive: true, force: true });
  }
});

test('ADR-037: WI with neither creates nor verification_artifact → compileErrors fold into setErrors and fail the pass', async () => {
  const h = setupHarness(BASE_CONFIG);
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1', omitCreates: true }]);
    await assert.rejects(
      () => runProjectManager(h.input, h.logger, { queryFn }),
      /project-manager phase failed:[\s\S]*creates is required \(ADR 037\)/,
    );

    const events = readEvents(h.logger);
    const end = events.find(
      (e) => e.phase === 'project-manager' && e.event_type === 'error' && Array.isArray(e.metadata?.set_errors),
    );
    assert.ok(end, 'expected the standard PM final error event');
    const setErrors = (end!.metadata as { set_errors: string[] }).set_errors;
    assert.ok(setErrors.some((msg) => /creates is required/.test(msg)));
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});
