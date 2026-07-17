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
  resolvePostMergeCiConfig,
  DEFAULT_POST_MERGE_CI_TIMEOUT_MS,
  DEFAULT_POST_MERGE_CI_POLL_INTERVAL_MS,
  resolveDevWiConcurrency,
  DEFAULT_DEV_WI_CONCURRENCY,
  DEV_WI_CONCURRENCY_CEILING,
  ralphGitIdentity,
  UNIFIER_GIT_IDENTITY,
  ORCHESTRATOR_GIT_IDENTITY,
  gitIdentityEnvOverlay,
  gitIdentityConfigArgs,
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

test('resolveDevWiConcurrency: defaults to DEFAULT_DEV_WI_CONCURRENCY (1 — serial)', () => {
  const original = process.env.FORGE_DEV_WI_CONCURRENCY;
  delete process.env.FORGE_DEV_WI_CONCURRENCY;
  try {
    assert.equal(resolveDevWiConcurrency({}), DEFAULT_DEV_WI_CONCURRENCY);
    assert.equal(DEFAULT_DEV_WI_CONCURRENCY, 1);
  } finally {
    if (original !== undefined) process.env.FORGE_DEV_WI_CONCURRENCY = original;
  }
});

test('resolveDevWiConcurrency: honours dev.maxConcurrentWorkItems from forge.config.json', () => {
  const original = process.env.FORGE_DEV_WI_CONCURRENCY;
  delete process.env.FORGE_DEV_WI_CONCURRENCY;
  try {
    assert.equal(resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: 3 } }), 3);
  } finally {
    if (original !== undefined) process.env.FORGE_DEV_WI_CONCURRENCY = original;
  }
});

test('resolveDevWiConcurrency: env var overrides config (operator/CI escape hatch)', () => {
  const original = process.env.FORGE_DEV_WI_CONCURRENCY;
  process.env.FORGE_DEV_WI_CONCURRENCY = '2';
  try {
    assert.equal(resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: 5 } }), 2);
  } finally {
    if (original === undefined) delete process.env.FORGE_DEV_WI_CONCURRENCY;
    else process.env.FORGE_DEV_WI_CONCURRENCY = original;
  }
});

test('resolveDevWiConcurrency: never unbounded — clamps to DEV_WI_CONCURRENCY_CEILING', () => {
  const original = process.env.FORGE_DEV_WI_CONCURRENCY;
  process.env.FORGE_DEV_WI_CONCURRENCY = '1000';
  try {
    assert.equal(resolveDevWiConcurrency({}), DEV_WI_CONCURRENCY_CEILING);
    assert.equal(resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: 1000 } }), DEV_WI_CONCURRENCY_CEILING);
  } finally {
    if (original === undefined) delete process.env.FORGE_DEV_WI_CONCURRENCY;
    else process.env.FORGE_DEV_WI_CONCURRENCY = original;
  }
});

test('resolveDevWiConcurrency: garbage values fall back to the default (never 0/negative/NaN)', () => {
  const original = process.env.FORGE_DEV_WI_CONCURRENCY;
  process.env.FORGE_DEV_WI_CONCURRENCY = 'not-a-number';
  try {
    assert.equal(resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: 0 } }), DEFAULT_DEV_WI_CONCURRENCY);
    assert.equal(resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: -3 } }), DEFAULT_DEV_WI_CONCURRENCY);
    assert.equal(resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: Number.NaN } }), DEFAULT_DEV_WI_CONCURRENCY);
  } finally {
    if (original === undefined) delete process.env.FORGE_DEV_WI_CONCURRENCY;
    else process.env.FORGE_DEV_WI_CONCURRENCY = original;
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

// ---------------------------------------------------------------------------
// N6 (plan 2.8): post-merge CI watch tuning.
// ---------------------------------------------------------------------------

test('resolvePostMergeCiConfig: defaults → 10min timeout / 30s poll', () => {
  const r = resolvePostMergeCiConfig({});
  assert.equal(r.timeoutMs, DEFAULT_POST_MERGE_CI_TIMEOUT_MS);
  assert.equal(r.pollIntervalMs, DEFAULT_POST_MERGE_CI_POLL_INTERVAL_MS);
  assert.equal(DEFAULT_POST_MERGE_CI_TIMEOUT_MS, 10 * 60_000);
  assert.equal(DEFAULT_POST_MERGE_CI_POLL_INTERVAL_MS, 30_000);
});

test('resolvePostMergeCiConfig: config values honoured; env overrides beat config; junk falls through', () => {
  const origT = process.env.FORGE_POST_MERGE_CI_TIMEOUT_MS;
  const origP = process.env.FORGE_POST_MERGE_CI_POLL_MS;
  try {
    delete process.env.FORGE_POST_MERGE_CI_TIMEOUT_MS;
    delete process.env.FORGE_POST_MERGE_CI_POLL_MS;
    const fromCfg = resolvePostMergeCiConfig({ postMergeCi: { timeoutMs: 120_000, pollIntervalMs: 5_000 } });
    assert.equal(fromCfg.timeoutMs, 120_000);
    assert.equal(fromCfg.pollIntervalMs, 5_000);

    process.env.FORGE_POST_MERGE_CI_TIMEOUT_MS = '60000';
    process.env.FORGE_POST_MERGE_CI_POLL_MS = '1000';
    const fromEnv = resolvePostMergeCiConfig({ postMergeCi: { timeoutMs: 120_000, pollIntervalMs: 5_000 } });
    assert.equal(fromEnv.timeoutMs, 60_000);
    assert.equal(fromEnv.pollIntervalMs, 1_000);

    process.env.FORGE_POST_MERGE_CI_TIMEOUT_MS = 'junk';
    process.env.FORGE_POST_MERGE_CI_POLL_MS = '-5';
    const junk = resolvePostMergeCiConfig({});
    assert.equal(junk.timeoutMs, DEFAULT_POST_MERGE_CI_TIMEOUT_MS);
    assert.equal(junk.pollIntervalMs, DEFAULT_POST_MERGE_CI_POLL_INTERVAL_MS);
  } finally {
    if (origT === undefined) delete process.env.FORGE_POST_MERGE_CI_TIMEOUT_MS;
    else process.env.FORGE_POST_MERGE_CI_TIMEOUT_MS = origT;
    if (origP === undefined) delete process.env.FORGE_POST_MERGE_CI_POLL_MS;
    else process.env.FORGE_POST_MERGE_CI_POLL_MS = origP;
  }
});

// ---------------------------------------------------------------------------
// G8 wave 2 (2026-07-12): distinct git identity for forge-authored commits.
// The env-pin allowlist itself (R5-02) now lives in orchestrator/spawn-env.ts
// (buildChildEnv/AGENT_ENV_ALLOWLIST) — see orchestrator/spawn-env.test.ts.
// ---------------------------------------------------------------------------

test('ralphGitIdentity: name is forge-ralph, email is tagged with the work item id', () => {
  const identity = ralphGitIdentity('WI-7');
  assert.deepEqual(identity, { name: 'forge-ralph', email: 'forge-ralph+WI-7@forge.local' });
});

test('ralphGitIdentity: distinct work item ids produce distinct emails (per-WI attribution)', () => {
  const a = ralphGitIdentity('WI-1');
  const b = ralphGitIdentity('WI-2');
  assert.notEqual(a.email, b.email);
});

test('UNIFIER_GIT_IDENTITY: flat forge-unifier identity', () => {
  assert.deepEqual(UNIFIER_GIT_IDENTITY, { name: 'forge-unifier', email: 'forge-unifier@forge.local' });
});

test('ORCHESTRATOR_GIT_IDENTITY: flat forge-orchestrator identity', () => {
  assert.deepEqual(ORCHESTRATOR_GIT_IDENTITY, { name: 'forge-orchestrator', email: 'forge-orchestrator@forge.local' });
});

test('gitIdentityConfigArgs: -c user.name=... -c user.email=... in that order', () => {
  assert.deepEqual(
    gitIdentityConfigArgs({ name: 'forge-ralph', email: 'forge-ralph+WI-7@forge.local' }),
    ['-c', 'user.name=forge-ralph', '-c', 'user.email=forge-ralph+WI-7@forge.local'],
  );
});

test('gitIdentityEnvOverlay: returns exactly the GIT_AUTHOR_*/GIT_COMMITTER_* delta for the given identity', () => {
  const result = gitIdentityEnvOverlay({ name: 'forge-ralph', email: 'forge-ralph+WI-7@forge.local' });
  assert.deepEqual(result, {
    GIT_AUTHOR_NAME: 'forge-ralph',
    GIT_AUTHOR_EMAIL: 'forge-ralph+WI-7@forge.local',
    GIT_COMMITTER_NAME: 'forge-ralph',
    GIT_COMMITTER_EMAIL: 'forge-ralph+WI-7@forge.local',
  });
});

test('gitIdentityEnvOverlay: distinct identities produce distinct overlays (no shared/mutated state)', () => {
  const a = gitIdentityEnvOverlay(UNIFIER_GIT_IDENTITY);
  const b = gitIdentityEnvOverlay(ORCHESTRATOR_GIT_IDENTITY);
  assert.notEqual(a.GIT_AUTHOR_EMAIL, b.GIT_AUTHOR_EMAIL);
});
