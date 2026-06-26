import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listPlannedInitiatives } from './planned-initiatives.ts';

function setup(): string {
  const queueRoot = join(mkdtempSync(join(tmpdir(), 'planned-')), '_queue');
  for (const d of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(queueRoot, d), { recursive: true });
  }
  return queueRoot;
}

function manifest(id: string, opts: { project?: string; deps?: string[]; title?: string } = {}): string {
  const lines = [
    '---',
    `initiative_id: ${id}`,
    `project: ${opts.project ?? 'demo'}`,
    "created_at: '2026-06-26T00:00:00.000Z'",
    'iteration_budget: 2',
    'cost_budget_usd: 1',
    'phase: pending',
    'origin: architect',
  ];
  if (opts.deps && opts.deps.length) {
    lines.push('depends_on_initiatives:');
    for (const d of opts.deps) lines.push(`  - ${d}`);
  }
  lines.push('---', `# ${opts.title ?? id}`, '');
  return lines.join('\n');
}

test('lists pending initiatives, all ready when no deps', () => {
  const q = setup();
  try {
    writeFileSync(join(q, 'pending', 'INIT-2026-06-26-a.md'), manifest('INIT-2026-06-26-a', { title: 'Alpha feature' }));
    const planned = listPlannedInitiatives(q);
    assert.equal(planned.length, 1);
    assert.equal(planned[0].initiativeId, 'INIT-2026-06-26-a');
    assert.equal(planned[0].project, 'demo');
    assert.equal(planned[0].title, 'Alpha feature');
    assert.equal(planned[0].ready, true);
    assert.deepEqual(planned[0].blockedBy, []);
  } finally {
    rmSync(join(q, '..'), { recursive: true, force: true });
  }
});

test('marks blocked when a dependency is not yet in done/', () => {
  const q = setup();
  try {
    writeFileSync(join(q, 'pending', 'INIT-2026-06-26-b.md'), manifest('INIT-2026-06-26-b', { deps: ['INIT-2026-06-26-a'] }));
    const planned = listPlannedInitiatives(q);
    assert.equal(planned[0].ready, false);
    assert.deepEqual(planned[0].blockedBy, ['INIT-2026-06-26-a']);
  } finally {
    rmSync(join(q, '..'), { recursive: true, force: true });
  }
});

test('dependency satisfied once it lands in done/ → ready', () => {
  const q = setup();
  try {
    writeFileSync(join(q, 'pending', 'INIT-2026-06-26-b.md'), manifest('INIT-2026-06-26-b', { deps: ['INIT-2026-06-26-a'] }));
    writeFileSync(join(q, 'done', 'INIT-2026-06-26-a.md'), manifest('INIT-2026-06-26-a'));
    const planned = listPlannedInitiatives(q);
    assert.equal(planned[0].ready, true);
    assert.deepEqual(planned[0].blockedBy, []);
  } finally {
    rmSync(join(q, '..'), { recursive: true, force: true });
  }
});

test('empty pending → []', () => {
  const q = setup();
  try {
    assert.deepEqual(listPlannedInitiatives(q), []);
  } finally {
    rmSync(join(q, '..'), { recursive: true, force: true });
  }
});
