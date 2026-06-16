/**
 * Tests for the initiative-manifest module — parse, validate, serialise, write.
 * Used by the architect (to write valid manifests) and the orchestrator
 * (to read them when claiming).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseManifest,
  serializeManifest,
  validateManifest,
  writeManifest,
  readManifestOrigin,
  readManifestCycleId,
  persistManifestCycleId,
  persistManifestResumeFromUnifier,
  type InitiativeManifest,
} from './manifest.ts';

function fixture(): InitiativeManifest {
  return {
    initiative_id: 'INIT-2026-05-04-x',
    project: 'demo',
    project_repo_path: '/tmp/demo',
    created_at: '2026-05-04T18:00:00Z',
    iteration_budget: 50,
    cost_budget_usd: 25,
    phase: 'pending',
    origin: 'architect',
    body: '# Demo initiative\n\nAdd auth + profile.\n\n## Acceptance Criteria\n\nGiven a user, when they log in, then they see the dashboard.',
  };
}

test('serializeManifest → parseManifest round-trips fields and body', () => {
  const m = fixture();
  const md = serializeManifest(m);
  assert.match(md, /^---\n/);
  assert.match(md, /initiative_id: INIT-2026-05-04-x/);
  assert.match(md, /# Demo initiative/);

  const parsed = parseManifest(md);
  assert.equal(parsed.initiative_id, m.initiative_id);
  assert.equal(parsed.project, m.project);
  assert.equal(parsed.iteration_budget, 50);
  assert.equal(parsed.cost_budget_usd, 25);
  assert.equal(parsed.origin, 'architect');
  assert.match(parsed.body, /# Demo initiative/);
  assert.match(parsed.body, /Acceptance Criteria/);
});

test('validateManifest: passes a clean manifest', () => {
  const errors = validateManifest(fixture());
  assert.deepEqual(errors, []);
});

test('validateManifest: rejects missing initiative_id', () => {
  const m = { ...fixture(), initiative_id: '' };
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => e.includes('initiative_id')), `got ${JSON.stringify(errors)}`);
});

test('validateManifest: rejects malformed initiative_id', () => {
  const m = { ...fixture(), initiative_id: 'not-an-init-id' };
  const errors = validateManifest(m);
  assert.ok(
    errors.some((e) => e.includes('initiative_id') && e.includes('INIT-')),
    `got ${JSON.stringify(errors)}`,
  );
});

test('validateManifest: rejects budgets ≤ 0', () => {
  const e1 = validateManifest({ ...fixture(), iteration_budget: 0 });
  const e2 = validateManifest({ ...fixture(), cost_budget_usd: -1 });
  assert.ok(e1.some((e) => e.includes('iteration_budget')));
  assert.ok(e2.some((e) => e.includes('cost_budget_usd')));
});

test('writeManifest: writes a parseable file under _queue/pending/', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-manifest-'));
  try {
    const queueRoot = join(dir, '_queue');
    const m = fixture();
    const out = writeManifest(m, { queueRoot });
    assert.ok(existsSync(out), `expected file at ${out}`);
    assert.ok(out.includes('pending'), `expected pending/, got ${out}`);

    const content = readFileSync(out, 'utf8');
    const parsed = parseManifest(content);
    assert.equal(parsed.initiative_id, m.initiative_id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeManifest: refuses to write an invalid manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-manifest-'));
  try {
    const queueRoot = join(dir, '_queue');
    const bad = { ...fixture(), initiative_id: '' };
    assert.throws(
      () => writeManifest(bad, { queueRoot }),
      /initiative_id/,
      'should throw with field name',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseManifest: tolerates manifests with body only (no optional fields)', () => {
  const md = `---\ninitiative_id: INIT-2026-05-04-y\nproject: demo\ncreated_at: 2026-05-04T18:00:00Z\niteration_budget: 10\ncost_budget_usd: 5\nphase: pending\n---\n\n# Body only\n`;
  const parsed = parseManifest(md);
  assert.match(parsed.body, /Body only/);
  assert.equal(parsed.quality_gate_cmd, undefined);
  assert.equal(parsed.depends_on_initiatives, undefined);
});

test('parseManifest: throws on missing required fields', () => {
  const md = `---\nproject: demo\n---\n\nbody`;
  assert.throws(() => parseManifest(md), /initiative_id/);
});

// ---- F-04 quality_gate_cmd round trip ----

test('parseManifest: extracts quality_gate_cmd from frontmatter', () => {
  const md = `---\ninitiative_id: INIT-2026-05-10-qgate\nproject: demo\ncreated_at: 2026-05-10T00:00:00Z\niteration_budget: 5\ncost_budget_usd: 1\nphase: pending\nquality_gate_cmd:\n  - pytest\n  - -q\n  - tests/\n---\n\n# body\n`;
  const parsed = parseManifest(md);
  assert.deepEqual(parsed.quality_gate_cmd, ['pytest', '-q', 'tests/']);
});

test('serializeManifest → parseManifest: quality_gate_cmd round-trips', () => {
  const m: InitiativeManifest = {
    ...fixture(),
    quality_gate_cmd: ['cargo', 'test', '--all'],
  };
  const round = parseManifest(serializeManifest(m));
  assert.deepEqual(round.quality_gate_cmd, ['cargo', 'test', '--all']);
});

test('parseManifest: missing quality_gate_cmd is undefined (allowed)', () => {
  const md = `---\ninitiative_id: INIT-2026-05-10-qgate\nproject: demo\ncreated_at: 2026-05-10T00:00:00Z\niteration_budget: 5\ncost_budget_usd: 1\nphase: pending\n---\nbody`;
  const parsed = parseManifest(md);
  assert.equal(parsed.quality_gate_cmd, undefined);
});

test('validateManifest: rejects empty quality_gate_cmd array', () => {
  const m = { ...fixture(), quality_gate_cmd: [] as string[] };
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /quality_gate_cmd/i.test(e)));
});

test('validateManifest: rejects quality_gate_cmd with empty-string entries', () => {
  const m = { ...fixture(), quality_gate_cmd: ['', 'test'] };
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /quality_gate_cmd/i.test(e)));
});

test('validateManifest: accepts a well-formed quality_gate_cmd', () => {
  const m = { ...fixture(), quality_gate_cmd: ['npm', 'test'] };
  const errors = validateManifest(m);
  assert.equal(errors.length, 0, `unexpected errors: ${errors.join('; ')}`);
});

// ---------- G6: origin cohort tag (closes I6) ----------

test('parseManifest: origin defaults to architect when frontmatter omits it', () => {
  // A legacy manifest authored before the `origin` field existed.
  const legacy = [
    '---',
    'initiative_id: INIT-2026-05-04-legacy',
    'project: demo',
    'created_at: 2026-05-04T18:00:00Z',
    'iteration_budget: 10',
    'cost_budget_usd: 2',
    'phase: pending',
    '---',
    '',
    '# Legacy initiative',
  ].join('\n');
  const parsed = parseManifest(legacy);
  assert.equal(parsed.origin, 'architect');
  // ...and validates clean (the default is a valid value).
  assert.deepEqual(validateManifest(parsed), []);
});

test('parseManifest: explicit human-directed origin is preserved', () => {
  const m = { ...fixture(), origin: 'human-directed' as const };
  const parsed = parseManifest(serializeManifest(m));
  assert.equal(parsed.origin, 'human-directed');
});

test('serializeManifest: always writes origin (legacy manifest gains the tag on round-trip)', () => {
  // Round-tripping a manifest that defaulted origin must persist the tag
  // so the cohort split is unambiguous on disk, not inferred forever.
  const legacy = [
    '---',
    'initiative_id: INIT-2026-05-04-legacy',
    'project: demo',
    'created_at: 2026-05-04T18:00:00Z',
    'iteration_budget: 10',
    'cost_budget_usd: 2',
    'phase: pending',
    '---',
    '',
    '# Legacy initiative',
  ].join('\n');
  const serialised = serializeManifest(parseManifest(legacy));
  assert.match(serialised, /origin: architect/);
});

test('validateManifest: rejects an unrecognised origin', () => {
  const m = { ...fixture(), origin: 'sideloaded' as unknown as 'architect' };
  const errors = validateManifest(m);
  assert.ok(errors.some((e) => /origin must be one of/i.test(e)), errors.join('; '));
});

test('ADR 019: resume_from round-trips and is omitted when absent', () => {
  // Absent → not serialised.
  const plain = serializeManifest(fixture());
  assert.ok(!/resume_from:/.test(plain), 'resume_from should be absent by default');
  assert.equal(parseManifest(plain).resume_from, undefined);

  // Present → serialised + parsed back.
  const resuming = serializeManifest({ ...fixture(), resume_from: 'unifier' });
  assert.match(resuming, /resume_from: unifier/);
  assert.equal(parseManifest(resuming).resume_from, 'unifier');

  // ADR 026: the retired 'developer' resume value is dropped on parse (undefined).
  const legacy = `---\ninitiative_id: INIT-2026-05-04-x\nproject: demo\nproject_repo_path: /tmp/demo\ncreated_at: '2026-05-04T18:00:00Z'\niteration_budget: 50\ncost_budget_usd: 25\nphase: pending\norigin: architect\nresume_from: developer\n---\n# x\n`;
  assert.equal(parseManifest(legacy).resume_from, undefined);
});

test('ADR 028 / J5: flow_id round-trips and is omitted when absent', () => {
  // Absent → not serialised, parses to undefined (legacy manifests).
  const plain = serializeManifest(fixture());
  assert.ok(!/flow_id:/.test(plain), 'flow_id should be absent by default');
  assert.equal(parseManifest(plain).flow_id, undefined);

  // Present → serialised + parsed back.
  const withFlow = serializeManifest({ ...fixture(), flow_id: 'my-first-flow' });
  assert.match(withFlow, /flow_id: my-first-flow/);
  assert.equal(parseManifest(withFlow).flow_id, 'my-first-flow');
});

test('readManifestOrigin: reads the tag from a file, defaults on missing/unparseable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-origin-'));
  try {
    const hd = join(dir, 'hd.md');
    const m = { ...fixture(), initiative_id: 'INIT-2026-05-04-hd', origin: 'human-directed' as const };
    writeFileSync(hd, serializeManifest(m));
    assert.equal(readManifestOrigin(hd), 'human-directed');
    // Missing file → default (telemetry must never throw).
    assert.equal(readManifestOrigin(join(dir, 'nope.md')), 'architect');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ADR 026: cycle_id round-trips and is omitted when absent', () => {
  // Absent → omit-on-undefined (frontmatter unchanged for legacy manifests).
  const plain = serializeManifest(fixture());
  assert.doesNotMatch(plain, /cycle_id:/);
  assert.equal(parseManifest(plain).cycle_id, undefined);

  // Present → round-trips.
  const withId = serializeManifest({ ...fixture(), cycle_id: '2026-06-07T10-00-00_INIT-2026-05-04-x' });
  assert.match(withId, /cycle_id: 2026-06-07T10-00-00_INIT-2026-05-04-x/);
  assert.equal(parseManifest(withId).cycle_id, '2026-06-07T10-00-00_INIT-2026-05-04-x');
});

test('ADR 026: persistManifestCycleId anchors once; readManifestCycleId reads it back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cycleid-'));
  try {
    const p = join(dir, 'm.md');
    writeFileSync(p, serializeManifest(fixture()));
    // Legacy manifest → no persisted id.
    assert.equal(readManifestCycleId(p), null);

    persistManifestCycleId(p, 'CYCLE-A');
    assert.equal(readManifestCycleId(p), 'CYCLE-A');
    // Idempotent: a second persist never re-stamps (the anchor is immutable).
    persistManifestCycleId(p, 'CYCLE-B');
    assert.equal(readManifestCycleId(p), 'CYCLE-A');

    // Missing file → null + no throw.
    assert.equal(readManifestCycleId(join(dir, 'nope.md')), null);
    persistManifestCycleId(join(dir, 'nope.md'), 'X'); // no-op, must not throw
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ADR 026: persistManifestResumeFromUnifier stamps the resume marker (crash recovery)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-resume-'));
  try {
    const p = join(dir, 'm.md');
    writeFileSync(p, serializeManifest(fixture()));
    assert.equal(parseManifest(readFileSync(p, 'utf8')).resume_from, undefined);
    persistManifestResumeFromUnifier(p);
    assert.equal(parseManifest(readFileSync(p, 'utf8')).resume_from, 'unifier');
    // Idempotent + missing-file safe.
    persistManifestResumeFromUnifier(p);
    assert.equal(parseManifest(readFileSync(p, 'utf8')).resume_from, 'unifier');
    persistManifestResumeFromUnifier(join(dir, 'nope.md')); // no-op, must not throw
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- P4: architect telemetry fields (cost + duration) ----------

test('P4: architect_session_id / architect_cost_usd / architect_duration_ms round-trip', () => {
  const m: InitiativeManifest = {
    ...fixture(),
    architect_session_id: 'sid-abc123',
    architect_cost_usd: 0.46,
    architect_duration_ms: 95000,
  };
  const serialised = serializeManifest(m);
  assert.match(serialised, /architect_session_id: sid-abc123/);
  assert.match(serialised, /architect_cost_usd: 0\.46/);
  assert.match(serialised, /architect_duration_ms: 95000/);

  const parsed = parseManifest(serialised);
  assert.equal(parsed.architect_session_id, 'sid-abc123');
  assert.equal(parsed.architect_cost_usd, 0.46);
  assert.equal(parsed.architect_duration_ms, 95000);
});

test('P4: architect telemetry fields absent on legacy manifest (omit-when-undefined)', () => {
  const plain = serializeManifest(fixture());
  assert.doesNotMatch(plain, /architect_session_id/);
  assert.doesNotMatch(plain, /architect_cost_usd/);
  assert.doesNotMatch(plain, /architect_duration_ms/);

  const parsed = parseManifest(plain);
  assert.equal(parsed.architect_session_id, undefined);
  assert.equal(parsed.architect_cost_usd, undefined);
  assert.equal(parsed.architect_duration_ms, undefined);
});

test('P4: architect_cost_usd of 0 round-trips (zero is a valid measurement)', () => {
  const m: InitiativeManifest = {
    ...fixture(),
    architect_cost_usd: 0,
    architect_duration_ms: 0,
  };
  const parsed = parseManifest(serializeManifest(m));
  assert.equal(parsed.architect_cost_usd, 0);
  assert.equal(parsed.architect_duration_ms, 0);
});
