import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { InitiativeManifest } from '../manifest.ts';
import type { WorkItem } from '../work-item.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';
import type { ConstraintBlock } from '../constraint-blocks.ts';
import {
  MAX_WI_CREATE_PATHS,
  compileHiddenCoupling,
  compileWorkItemSpecs,
  injectConstraintClauses,
  validateCompiledWorkItemSet,
} from './wi-spec-compile.ts';

function fixture(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    work_item_id: 'WI-1',
    initiative_id: 'INIT-2026-05-08-demo',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'a request', when: 'the handler runs', then: 'it returns 200' }],
    files_in_scope: ['src/handler.ts'],
    creates: ['src/handler.ts'],
    estimated_iterations: 2,
    quality_gate_cmd: ['node', '--test', 'tests/handler.test.ts'],
    body: 'Implement the handler.',
    ...overrides,
  };
}

function manifestFixture(overrides: Partial<InitiativeManifest> = {}): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-05-08-demo',
    project: 'demo',
    project_repo_path: './projects/demo',
    created_at: '2026-05-08T00:00:00Z',
    iteration_budget: 3,
    cost_budget_usd: 1,
    phase: 'in-flight',
    origin: 'architect',
    body: '# demo initiative',
    ...overrides,
  };
}

function block(overrides: Partial<ConstraintBlock> = {}): ConstraintBlock {
  return {
    id: 'standing-note',
    selector: { kind: 'all' },
    content: 'Standing note: keep functions small.',
    sourceFile: 'profile.md',
    startLine: 5,
    ...overrides,
  };
}

function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A path guaranteed to fail writeFileSync(join(dir, ...)) with ENOTDIR: a FILE posing as the dir. */
function mkUnwritableDir(): { path: string; cleanup: () => void } {
  const parent = mkTmp('forge-wi-unwritable-');
  const path = join(parent, 'not-a-dir');
  writeFileSync(path, 'this is a file, not a directory');
  return { path, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

// ---------- validateCompiledWorkItemSet: creates mandatory-with-escape ----------

test('validateCompiledWorkItemSet: creates present, no verification_artifact → no errors', () => {
  const items = [fixture({ creates: ['src/handler.ts'] })];
  assert.deepEqual(validateCompiledWorkItemSet(items), []);
});

test('validateCompiledWorkItemSet: verification_artifact present, no creates → escape passes', () => {
  const items = [fixture({ creates: undefined, verification_artifact: 'docs/proof.md' })];
  assert.deepEqual(validateCompiledWorkItemSet(items), []);
});

test('validateCompiledWorkItemSet: neither creates nor verification_artifact → error citing ADR 037', () => {
  const items = [fixture({ work_item_id: 'WI-9', creates: undefined, verification_artifact: undefined })];
  const errors = validateCompiledWorkItemSet(items);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /WI-9: creates is required \(ADR 037\)/);
  assert.match(errors[0]!, /verification_artifact/);
});

test('validateCompiledWorkItemSet: empty creates array with no verification_artifact → error', () => {
  const items = [fixture({ creates: [], verification_artifact: undefined })];
  const errors = validateCompiledWorkItemSet(items);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /creates is required/);
});

// ---------- validateCompiledWorkItemSet: sizing bound ----------

test(`validateCompiledWorkItemSet: creates.length === MAX_WI_CREATE_PATHS (${MAX_WI_CREATE_PATHS}) → passes`, () => {
  const items = [fixture({ creates: Array.from({ length: MAX_WI_CREATE_PATHS }, (_, i) => `src/f${i}.ts`) })];
  assert.deepEqual(validateCompiledWorkItemSet(items), []);
});

test(`validateCompiledWorkItemSet: creates.length === MAX_WI_CREATE_PATHS + 1 → sizing error`, () => {
  const items = [
    fixture({
      work_item_id: 'WI-9',
      creates: Array.from({ length: MAX_WI_CREATE_PATHS + 1 }, (_, i) => `src/f${i}.ts`),
    }),
  ];
  const errors = validateCompiledWorkItemSet(items);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, new RegExp(`WI-9: creates lists ${MAX_WI_CREATE_PATHS + 1} path`));
  assert.match(errors[0]!, new RegExp(`sizing bound of ${MAX_WI_CREATE_PATHS}`));
});

// ---------- injectConstraintClauses: injection + id-keyed idempotency ----------

test('injectConstraintClauses: matching "all" clause injected verbatim into body + persisted to disk', () => {
  const dir = mkTmp('forge-wi-inject-');
  try {
    const items = [fixture({ work_item_id: 'WI-1', body: 'Original body.' })];
    const { items: updated, injected, writeErrors } = injectConstraintClauses(dir, items, manifestFixture(), [block()]);

    assert.deepEqual(writeErrors, []);
    assert.equal(injected.length, 1);
    assert.deepEqual(injected[0], {
      workItemId: 'WI-1',
      clauseId: 'standing-note',
      sourceFile: 'profile.md',
      startLine: 5,
      action: 'append',
    });
    assert.match(updated[0]!.body, /## Compiled constraints \(project & brain, ADR 037\)/);
    assert.match(updated[0]!.body, /Standing note: keep functions small\./);
    assert.match(updated[0]!.body, /<!-- forge:compiled clause="standing-note" -->/);
    assert.match(updated[0]!.body, /<!-- \/forge:compiled clause="standing-note" -->/);
    assert.match(updated[0]!.body, /Original body\./); // original content preserved

    const onDisk = readFileSync(join(dir, 'WI-1.md'), 'utf8');
    assert.match(onDisk, /Standing note: keep functions small\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('injectConstraintClauses: non-matching selector is excluded', () => {
  const dir = mkTmp('forge-wi-inject-');
  try {
    const items = [fixture({ work_item_id: 'WI-1', status: 'pending' })];
    const b = block({
      id: 'complete-only',
      selector: { kind: 'and', terms: [{ namespace: 'wi', field: 'status', glob: 'complete' }] },
      content: 'Only for completed WIs.',
    });
    const { items: updated, injected, writeErrors } = injectConstraintClauses(dir, items, manifestFixture(), [b]);
    assert.deepEqual(injected, []);
    assert.deepEqual(writeErrors, []);
    assert.equal(updated[0]!.body, items[0]!.body);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('injectConstraintClauses: idempotent — re-running with the same id + content injects nothing new', () => {
  const dir = mkTmp('forge-wi-inject-');
  try {
    const items = [fixture({ work_item_id: 'WI-1', body: 'Original body.' })];
    const first = injectConstraintClauses(dir, items, manifestFixture(), [block()]);
    const second = injectConstraintClauses(dir, first.items, manifestFixture(), [block()]);

    assert.deepEqual(second.injected, []);
    assert.deepEqual(second.writeErrors, []);
    assert.equal(second.items[0]!.body, first.items[0]!.body);
    const anchorCount = (second.items[0]!.body.match(/<!-- forge:compiled clause="standing-note" -->/g) ?? []).length;
    assert.equal(anchorCount, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('injectConstraintClauses: LINE SHIFT — same id + content at a different source line does NOT duplicate', () => {
  const dir = mkTmp('forge-wi-inject-');
  try {
    const items = [fixture({ work_item_id: 'WI-1', body: 'Original body.' })];
    const first = injectConstraintClauses(dir, items, manifestFixture(), [block({ startLine: 5 })]);
    assert.equal(first.injected.length, 1);

    // The clause moved in its source document (line 5 → 42): identity is the
    // id, so nothing re-injects.
    const shifted = injectConstraintClauses(dir, first.items, manifestFixture(), [block({ startLine: 42 })]);
    assert.deepEqual(shifted.injected, []);
    assert.equal(shifted.items[0]!.body, first.items[0]!.body);
    const anchorCount = (shifted.items[0]!.body.match(/clause="standing-note"/g) ?? []).length;
    assert.equal(anchorCount, 2); // exactly one open + one close marker
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('injectConstraintClauses: CONTENT EDIT — same id with different content REPLACES the injected section in place', () => {
  const dir = mkTmp('forge-wi-inject-');
  try {
    const items = [fixture({ work_item_id: 'WI-1', body: 'Original body.' })];
    const first = injectConstraintClauses(dir, items, manifestFixture(), [block({ content: 'Old clause text.' })]);
    assert.equal(first.injected.length, 1);

    const edited = injectConstraintClauses(dir, first.items, manifestFixture(), [
      block({ content: 'New clause text.', startLine: 7 }),
    ]);
    assert.equal(edited.injected.length, 1);
    assert.equal(edited.injected[0]!.action, 'replace');
    assert.equal(edited.injected[0]!.clauseId, 'standing-note');

    const body = edited.items[0]!.body;
    assert.equal((body.match(/New clause text\./g) ?? []).length, 1);
    assert.ok(!body.includes('Old clause text.'));
    assert.equal((body.match(/<!-- forge:compiled clause="standing-note" -->/g) ?? []).length, 1);
    assert.equal((body.match(/## Compiled constraints/g) ?? []).length, 1);

    const onDisk = readFileSync(join(dir, 'WI-1.md'), 'utf8');
    assert.match(onDisk, /New clause text\./);
    assert.ok(!onDisk.includes('Old clause text.'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('injectConstraintClauses: a second, newly-added clause is appended without duplicating the first', () => {
  const dir = mkTmp('forge-wi-inject-');
  try {
    const items = [fixture({ work_item_id: 'WI-1', body: 'Original body.' })];
    const blockA = block({ id: 'clause-a', content: 'Clause A.', startLine: 1 });
    const blockB = block({ id: 'clause-b', content: 'Clause B.', startLine: 9 });

    const first = injectConstraintClauses(dir, items, manifestFixture(), [blockA]);
    assert.equal(first.injected.length, 1);

    const second = injectConstraintClauses(dir, first.items, manifestFixture(), [blockA, blockB]);
    assert.equal(second.injected.length, 1);
    assert.equal(second.injected[0]!.clauseId, 'clause-b');
    assert.equal(second.injected[0]!.action, 'append');

    const body = second.items[0]!.body;
    assert.equal((body.match(/Clause A\./g) ?? []).length, 1);
    assert.equal((body.match(/Clause B\./g) ?? []).length, 1);
    assert.equal((body.match(/## Compiled constraints/g) ?? []).length, 1); // header not duplicated
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('injectConstraintClauses: no blocks → items returned unchanged, nothing injected', () => {
  const dir = mkTmp('forge-wi-inject-');
  try {
    const items = [fixture({ work_item_id: 'WI-1' })];
    const { items: updated, injected, writeErrors } = injectConstraintClauses(dir, items, manifestFixture(), []);
    assert.deepEqual(injected, []);
    assert.deepEqual(writeErrors, []);
    assert.equal(updated[0]!.body, items[0]!.body);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('injectConstraintClauses: WRITE FAILURE — in-memory reverts to match disk, failure surfaces in writeErrors, no telemetry', () => {
  const unwritable = mkUnwritableDir();
  try {
    const items = [fixture({ work_item_id: 'WI-1', body: 'Original body.' })];
    const { items: updated, injected, writeErrors } = injectConstraintClauses(
      unwritable.path,
      items,
      manifestFixture(),
      [block()],
    );

    // Nothing reported as injected (telemetry only after a successful write) …
    assert.deepEqual(injected, []);
    // … the item is reverted so in-memory matches disk …
    assert.equal(updated[0]!.body, 'Original body.');
    assert.ok(!updated[0]!.body.includes('Standing note'));
    // … and the failure is LOUD on the error channel.
    assert.equal(writeErrors.length, 1);
    assert.match(writeErrors[0]!, /WI-1: failed to persist injected constraint clause/);
    assert.match(writeErrors[0]!, /standing-note/);
  } finally {
    unwritable.cleanup();
  }
});

test('injectConstraintClauses: corrupted section (open marker without close) → loud writeError, no re-inject', () => {
  const dir = mkTmp('forge-wi-inject-');
  try {
    const corruptBody =
      'Original body.\n\n<!-- forge:compiled clause="standing-note" -->\nhand-mangled, close marker deleted\n';
    const items = [fixture({ work_item_id: 'WI-1', body: corruptBody })];
    const { items: updated, injected, writeErrors } = injectConstraintClauses(dir, items, manifestFixture(), [block()]);

    assert.deepEqual(injected, []);
    assert.equal(updated[0]!.body, corruptBody); // untouched — no blind duplicate append
    assert.equal(writeErrors.length, 1);
    assert.match(writeErrors[0]!, /WI-1:.*"standing-note".*close marker/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- compileHiddenCoupling: derivable / non-derivable / cycle / tie / write failure ----------

test('compileHiddenCoupling: derivable — higher-numbered WI gets depends_on the lower, persisted to disk', () => {
  const dir = mkTmp('forge-wi-coupling-');
  try {
    const items = [
      fixture({ work_item_id: 'WI-1', files_in_scope: ['shared.ts'], creates: ['a.ts'] }),
      fixture({ work_item_id: 'WI-2', files_in_scope: ['shared.ts'], creates: ['b.ts'] }),
    ];
    const result = compileHiddenCoupling(dir, items);

    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(result.writeErrors, []);
    assert.equal(result.compiledEdges.length, 1);
    assert.deepEqual(result.compiledEdges[0], { dependent: 'WI-2', prerequisite: 'WI-1', sharedFiles: ['shared.ts'] });

    const wi2 = result.items.find((i) => i.work_item_id === 'WI-2')!;
    assert.deepEqual(wi2.depends_on, ['WI-1']);
    const wi1 = result.items.find((i) => i.work_item_id === 'WI-1')!;
    assert.deepEqual(wi1.depends_on, []); // prerequisite is untouched

    const onDisk = readFileSync(join(dir, 'WI-2.md'), 'utf8');
    assert.match(onDisk, /depends_on:\s*\n\s*-\s*WI-1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compileHiddenCoupling: no coupling pairs → items unchanged, nothing compiled', () => {
  const dir = mkTmp('forge-wi-coupling-');
  try {
    const items = [
      fixture({ work_item_id: 'WI-1', files_in_scope: ['a.ts'] }),
      fixture({ work_item_id: 'WI-2', files_in_scope: ['b.ts'] }),
    ];
    const result = compileHiddenCoupling(dir, items);
    assert.deepEqual(result.compiledEdges, []);
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(result.writeErrors, []);
    assert.deepEqual(result.items, items);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compileHiddenCoupling: numeric TIE (WI-05 vs WI-5) → deterministic lexicographic order, greater id depends', () => {
  const dir = mkTmp('forge-wi-coupling-');
  try {
    // Both ids carry numeric value 5. The rule: on a numeric tie, order falls
    // back to lexicographic id comparison — 'WI-5' > 'WI-05', so WI-5 is the
    // dependent regardless of detection order.
    const items = [
      fixture({ work_item_id: 'WI-5', files_in_scope: ['shared.ts'], creates: ['a.ts'] }),
      fixture({ work_item_id: 'WI-05', files_in_scope: ['shared.ts'], creates: ['b.ts'] }),
    ];
    const result = compileHiddenCoupling(dir, items);

    assert.deepEqual(result.unresolved, []);
    assert.equal(result.compiledEdges.length, 1);
    assert.equal(result.compiledEdges[0]!.dependent, 'WI-5');
    assert.equal(result.compiledEdges[0]!.prerequisite, 'WI-05');
    assert.deepEqual(result.items.find((i) => i.work_item_id === 'WI-5')!.depends_on, ['WI-05']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compileHiddenCoupling: non-derivable — an id shape without a numeric WI order is rejected, not compiled', () => {
  const dir = mkTmp('forge-wi-coupling-');
  try {
    const items = [
      fixture({ work_item_id: 'UWI-1', files_in_scope: ['shared.ts'], creates: ['a.ts'] }),
      fixture({ work_item_id: 'UWI-2', files_in_scope: ['shared.ts'], creates: ['b.ts'] }),
    ];
    const result = compileHiddenCoupling(dir, items);
    assert.deepEqual(result.compiledEdges, []);
    assert.equal(result.unresolved.length, 1);
    assert.deepEqual(result.unresolved[0], { a: 'UWI-1', b: 'UWI-2', sharedFiles: ['shared.ts'] });
    // depends_on is untouched on both items
    assert.deepEqual(result.items.find((i) => i.work_item_id === 'UWI-1')!.depends_on, []);
    assert.deepEqual(result.items.find((i) => i.work_item_id === 'UWI-2')!.depends_on, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compileHiddenCoupling: cycle-after-compile — a batch that would close a dependency loop is rejected wholesale', () => {
  const dir = mkTmp('forge-wi-coupling-');
  try {
    // WI-1 --(pre-existing depends_on)--> WI-3
    // WI-1,WI-2 share 'shared-a.ts' (hidden, unconnected pre-compile) → derives WI-2 depends_on WI-1
    // WI-2,WI-3 share 'shared-b.ts' (hidden, unconnected pre-compile) → derives WI-3 depends_on WI-2
    // Applying BOTH derived edges alongside the pre-existing one closes a 3-cycle:
    // WI-1 -> WI-3 -> WI-2 -> WI-1 — only visible once all edges are combined.
    const items = [
      fixture({ work_item_id: 'WI-1', depends_on: ['WI-3'], files_in_scope: ['shared-a.ts'], creates: ['a.ts'] }),
      fixture({
        work_item_id: 'WI-2',
        depends_on: [],
        files_in_scope: ['shared-a.ts', 'shared-b.ts'],
        creates: ['b.ts'],
      }),
      fixture({ work_item_id: 'WI-3', depends_on: [], files_in_scope: ['shared-b.ts'], creates: ['c.ts'] }),
    ];

    const result = compileHiddenCoupling(dir, items);

    assert.deepEqual(result.compiledEdges, []);
    assert.deepEqual(result.writeErrors, []);
    assert.equal(result.unresolved.length, 2);
    const pairKeys = result.unresolved.map((p) => `${p.a}|${p.b}`).sort();
    assert.deepEqual(pairKeys, ['WI-1|WI-2', 'WI-2|WI-3']);
    // No edges persisted, no depends_on mutation anywhere.
    assert.deepEqual(result.items, items);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compileHiddenCoupling: WRITE FAILURE — in-memory depends_on reverts to match disk, failure in writeErrors, edge not reported', () => {
  const unwritable = mkUnwritableDir();
  try {
    const items = [
      fixture({ work_item_id: 'WI-1', files_in_scope: ['shared.ts'], creates: ['a.ts'] }),
      fixture({ work_item_id: 'WI-2', files_in_scope: ['shared.ts'], creates: ['b.ts'] }),
    ];
    const result = compileHiddenCoupling(unwritable.path, items);

    // Edge not reported as compiled (telemetry only after a successful write) …
    assert.deepEqual(result.compiledEdges, []);
    // … the dependent's depends_on reverts so in-memory matches disk …
    assert.deepEqual(result.items.find((i) => i.work_item_id === 'WI-2')!.depends_on, []);
    // … and the failure is LOUD on the error channel.
    assert.equal(result.writeErrors.length, 1);
    assert.match(result.writeErrors[0]!, /WI-2: failed to persist compiled depends_on edge/);
    assert.match(result.writeErrors[0]!, /WI-1/);
  } finally {
    unwritable.cleanup();
  }
});

// ---------- compileWorkItemSpecs: full orchestration + event emission ----------

test('compileWorkItemSpecs: injects matching constraint clauses, compiles a derivable coupling edge, and emits both event types', () => {
  const forgeRoot = mkTmp('forge-wi-spec-compile-forgeroot-');
  const workItemsDir = mkTmp('forge-wi-spec-compile-witems-');
  const logsDir = mkTmp('forge-wi-spec-compile-logs-');
  try {
    const projectDir = join(forgeRoot, 'brain', 'projects', 'demo');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'profile.md'),
      [
        '<!-- forge:constraint id: keep-small applies_to: all -->',
        'Standing note: keep functions small.',
        '<!-- /forge:constraint -->',
      ].join('\n'),
    );

    const items = [
      fixture({ work_item_id: 'WI-1', files_in_scope: ['shared.ts'], creates: ['a.ts'] }),
      fixture({ work_item_id: 'WI-2', files_in_scope: ['shared.ts'], creates: ['b.ts'] }),
    ];
    const manifest = manifestFixture({ project: 'demo' });
    const logger = createLogger('TEST-wi-spec-compile', logsDir);

    const result = compileWorkItemSpecs({
      forgeRoot,
      projectName: 'demo',
      manifest,
      workItemsDir,
      items,
      logger,
      initiativeId: manifest.initiative_id,
      parentEventId: 'evt-parent',
    });

    assert.deepEqual(result.unresolvedCoupling, []);
    assert.deepEqual(result.compileErrors, []);
    for (const item of result.items) {
      assert.match(item.body, /Standing note: keep functions small\./);
    }
    const wi2 = result.items.find((i) => i.work_item_id === 'WI-2')!;
    assert.deepEqual(wi2.depends_on, ['WI-1']);

    const events = readFileSync(logger.logFilePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as EventLogEntry);

    const injectedEvents = events.filter((e) => e.message === 'pm.constraint-injected');
    assert.equal(injectedEvents.length, 2);
    for (const e of injectedEvents) {
      assert.equal(e.phase, 'project-manager');
      assert.equal(e.skill, 'project-manager');
      assert.equal(e.event_type, 'log');
      assert.equal(e.initiative_id, manifest.initiative_id);
      assert.equal(e.parent_event_id, 'evt-parent');
      assert.equal(e.metadata?.clause_id, 'keep-small');
      assert.equal(e.metadata?.action, 'append');
      assert.equal(e.metadata?.start_line, 1);
      assert.match(String(e.metadata?.source_file), /profile\.md$/);
    }
    assert.deepEqual(
      injectedEvents.map((e) => e.metadata?.work_item_id).sort(),
      ['WI-1', 'WI-2'],
    );

    const couplingEvents = events.filter((e) => e.message === 'pm.coupling-edge-compiled');
    assert.equal(couplingEvents.length, 1);
    assert.equal(couplingEvents[0]!.metadata?.dependent, 'WI-2');
    assert.equal(couplingEvents[0]!.metadata?.prerequisite, 'WI-1');
    assert.deepEqual(couplingEvents[0]!.metadata?.shared_files, ['shared.ts']);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(workItemsDir, { recursive: true, force: true });
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test('compileWorkItemSpecs: folds creates-mandatory violations into compileErrors', () => {
  const forgeRoot = mkTmp('forge-wi-spec-compile-forgeroot-');
  const workItemsDir = mkTmp('forge-wi-spec-compile-witems-');
  const logsDir = mkTmp('forge-wi-spec-compile-logs-');
  try {
    const items = [fixture({ work_item_id: 'WI-1', creates: undefined, verification_artifact: undefined })];
    const manifest = manifestFixture({ project: 'no-such-project' });
    const logger = createLogger('TEST-wi-spec-compile-2', logsDir);

    const result = compileWorkItemSpecs({
      forgeRoot,
      projectName: 'no-such-project',
      manifest,
      workItemsDir,
      items,
      logger,
      initiativeId: manifest.initiative_id,
      parentEventId: 'evt-parent',
    });

    assert.equal(result.compileErrors.length, 1);
    assert.match(result.compileErrors[0]!, /WI-1: creates is required \(ADR 037\)/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(workItemsDir, { recursive: true, force: true });
    rmSync(logsDir, { recursive: true, force: true });
  }
});

test('compileWorkItemSpecs: WRITE FAILURE folds into compileErrors, emits an error-level event, and no injected telemetry', () => {
  const forgeRoot = mkTmp('forge-wi-spec-compile-forgeroot-');
  const logsDir = mkTmp('forge-wi-spec-compile-logs-');
  const unwritable = mkUnwritableDir();
  try {
    const projectDir = join(forgeRoot, 'brain', 'projects', 'demo');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, 'profile.md'),
      [
        '<!-- forge:constraint id: keep-small applies_to: all -->',
        'Standing note: keep functions small.',
        '<!-- /forge:constraint -->',
      ].join('\n'),
    );

    const items = [fixture({ work_item_id: 'WI-1' })];
    const manifest = manifestFixture({ project: 'demo' });
    const logger = createLogger('TEST-wi-spec-compile-3', logsDir);

    const result = compileWorkItemSpecs({
      forgeRoot,
      projectName: 'demo',
      manifest,
      workItemsDir: unwritable.path,
      items,
      logger,
      initiativeId: manifest.initiative_id,
      parentEventId: 'evt-parent',
    });

    // The write failure lands on the compileErrors channel (→ setErrors → PM failure) …
    assert.equal(result.compileErrors.length, 1);
    assert.match(result.compileErrors[0]!, /WI-1: failed to persist injected constraint clause/);
    // … the in-memory item stays consistent with disk …
    assert.equal(result.items[0]!.body, items[0]!.body);

    const events = readFileSync(logger.logFilePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as EventLogEntry);
    // … an error-level event is emitted for the write failure …
    const failEvents = events.filter((e) => e.message === 'pm.compile-write-failed');
    assert.equal(failEvents.length, 1);
    assert.equal(failEvents[0]!.event_type, 'error');
    assert.match(String(failEvents[0]!.metadata?.error), /WI-1/);
    // … and no success telemetry was emitted for the failed write.
    assert.equal(events.filter((e) => e.message === 'pm.constraint-injected').length, 0);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(logsDir, { recursive: true, force: true });
    unwritable.cleanup();
  }
});
