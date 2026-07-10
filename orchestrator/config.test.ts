/**
 * Tests for orchestrator/config.ts. Covers F-10 / F-18 — `forge.config.json`
 * loader and the env-assertion helper.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadConfig,
  assertEnv,
  resolveUnifierGateFailureCap,
  DEFAULT_UNIFIER_GATE_FAILURE_CAP,
} from './config.ts';

test('loadConfig: missing file returns empty config (no throw)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cfg-'));
  try {
    const cfg = loadConfig(join(dir, 'forge.config.json'));
    assert.deepEqual(cfg, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig: malformed JSON returns empty config (no throw)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cfg-'));
  try {
    const path = join(dir, 'forge.config.json');
    writeFileSync(path, '{ this is not json }');
    const cfg = loadConfig(path);
    assert.deepEqual(cfg, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig: parses a valid full config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cfg-'));
  try {
    const path = join(dir, 'forge.config.json');
    writeFileSync(
      path,
      JSON.stringify({
        projectsDir: '~/work/projects',
        scheduler: { maxConcurrentInitiatives: 3 },
        notify: { desktop: true, webhook_url: 'https://hooks.slack.com/services/...' },
      }),
    );
    const cfg = loadConfig(path);
    assert.equal(cfg.projectsDir, '~/work/projects');
    assert.equal(cfg.scheduler?.maxConcurrentInitiatives, 3);
    assert.equal(cfg.notify?.webhook_url, 'https://hooks.slack.com/services/...');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig: tolerates partial / extra fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cfg-'));
  try {
    const path = join(dir, 'forge.config.json');
    writeFileSync(path, JSON.stringify({ scheduler: { maxConcurrentInitiatives: 1 }, _comment: 'partial' }));
    const cfg = loadConfig(path);
    assert.equal(cfg.scheduler?.maxConcurrentInitiatives, 1);
    assert.equal(cfg.projectsDir, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('assertEnv: returns issue list when ANTHROPIC_API_KEY unset', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const issues = assertEnv('warn');
    assert.ok(issues.length > 0);
    assert.match(issues[0], /ANTHROPIC_API_KEY/);
  } finally {
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  }
});

test('assertEnv: empty issue list when env is set', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  try {
    const issues = assertEnv('warn');
    assert.equal(issues.length, 0);
  } finally {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  }
});

test('assertEnv: throw mode raises on missing env', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.throws(() => assertEnv('throw'), /ANTHROPIC_API_KEY/);
  } finally {
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  }
});

// ---------------------------------------------------------------------------
// G4 (plan item 2.2): unifier fix-loop failure cap — config-driven ceiling on
// consecutive same-sub-check composed-gate failures.
// ---------------------------------------------------------------------------

test('resolveUnifierGateFailureCap: defaults to DEFAULT_UNIFIER_GATE_FAILURE_CAP (4)', () => {
  const original = process.env.FORGE_UNIFIER_GATE_FAILURE_CAP;
  delete process.env.FORGE_UNIFIER_GATE_FAILURE_CAP;
  try {
    assert.equal(resolveUnifierGateFailureCap({}), DEFAULT_UNIFIER_GATE_FAILURE_CAP);
    assert.equal(DEFAULT_UNIFIER_GATE_FAILURE_CAP, 4);
  } finally {
    if (original !== undefined) process.env.FORGE_UNIFIER_GATE_FAILURE_CAP = original;
  }
});

test('resolveUnifierGateFailureCap: honours unifier.maxConsecutiveGateFailures from forge.config.json', () => {
  const original = process.env.FORGE_UNIFIER_GATE_FAILURE_CAP;
  delete process.env.FORGE_UNIFIER_GATE_FAILURE_CAP;
  try {
    assert.equal(resolveUnifierGateFailureCap({ unifier: { maxConsecutiveGateFailures: 2 } }), 2);
  } finally {
    if (original !== undefined) process.env.FORGE_UNIFIER_GATE_FAILURE_CAP = original;
  }
});

test('resolveUnifierGateFailureCap: env var overrides config (operator/CI escape hatch)', () => {
  const original = process.env.FORGE_UNIFIER_GATE_FAILURE_CAP;
  process.env.FORGE_UNIFIER_GATE_FAILURE_CAP = '7';
  try {
    assert.equal(resolveUnifierGateFailureCap({ unifier: { maxConsecutiveGateFailures: 2 } }), 7);
  } finally {
    if (original === undefined) delete process.env.FORGE_UNIFIER_GATE_FAILURE_CAP;
    else process.env.FORGE_UNIFIER_GATE_FAILURE_CAP = original;
  }
});

test('resolveUnifierGateFailureCap: garbage values fall back to the default (never 0/negative/NaN)', () => {
  const original = process.env.FORGE_UNIFIER_GATE_FAILURE_CAP;
  process.env.FORGE_UNIFIER_GATE_FAILURE_CAP = 'not-a-number';
  try {
    assert.equal(resolveUnifierGateFailureCap({ unifier: { maxConsecutiveGateFailures: 0 } }), DEFAULT_UNIFIER_GATE_FAILURE_CAP);
    assert.equal(resolveUnifierGateFailureCap({ unifier: { maxConsecutiveGateFailures: -3 } }), DEFAULT_UNIFIER_GATE_FAILURE_CAP);
    assert.equal(resolveUnifierGateFailureCap({ unifier: { maxConsecutiveGateFailures: Number.NaN } }), DEFAULT_UNIFIER_GATE_FAILURE_CAP);
  } finally {
    if (original === undefined) delete process.env.FORGE_UNIFIER_GATE_FAILURE_CAP;
    else process.env.FORGE_UNIFIER_GATE_FAILURE_CAP = original;
  }
});

test('loadConfig: parses the unifier block', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cfg-'));
  try {
    const path = join(dir, 'forge.config.json');
    writeFileSync(path, JSON.stringify({ unifier: { maxConsecutiveGateFailures: 3 } }));
    const cfg = loadConfig(path);
    assert.equal(cfg.unifier?.maxConsecutiveGateFailures, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
