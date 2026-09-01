/**
 * Tests for orchestrator/config.ts. Covers F-10 / F-18 — `forge.config.json`
 * loader and the env-assertion helper.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import {
  loadConfig,
  assertEnv,
  resolvePostMergeCiConfig,
  DEFAULT_POST_MERGE_CI_TIMEOUT_MS,
  DEFAULT_POST_MERGE_CI_POLL_INTERVAL_MS,
  resolveDevWiConcurrency,
  DEFAULT_DEV_WI_CONCURRENCY,
  DEV_WI_CONCURRENCY_CEILING,
  resolveReviewLoopCaps,
  DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS,
  DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS,
  ralphGitIdentity,
  UNIFIER_GIT_IDENTITY,
  ORCHESTRATOR_GIT_IDENTITY,
  gitIdentityEnvOverlay,
  gitIdentityConfigArgs,
  projectStartersDir,
  listProjectStarters,
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

test('resolveDevWiConcurrency: R2-03-F4 — the definition cap is the DEFAULT (below env + operator config), clamped to the ceiling', () => {
  const original = process.env.FORGE_DEV_WI_CONCURRENCY;
  delete process.env.FORGE_DEV_WI_CONCURRENCY;
  try {
    // an explicit operator config value WINS over the agent-declared default
    // (ADR-009's dev.maxConcurrentWorkItems lever is preserved).
    assert.equal(resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: 2 } }, 4), 2);
    // no config → the definition cap is the effective default.
    assert.equal(resolveDevWiConcurrency({}, 3), 3);
    // developer-ralph declares 1 → byte-identical to the pre-F4 default.
    assert.equal(resolveDevWiConcurrency({}, 1), 1);
    // never unbounded — a definition cap is still clamped to the ceiling.
    assert.equal(resolveDevWiConcurrency({}, 999), 8);
    // env still wins over everything (operator/CI override).
    process.env.FORGE_DEV_WI_CONCURRENCY = '2';
    assert.equal(resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: 6 } }, 4), 2);
    delete process.env.FORGE_DEV_WI_CONCURRENCY;
    // an absent/invalid definition cap falls through to config/default.
    assert.equal(resolveDevWiConcurrency({ dev: { maxConcurrentWorkItems: 5 } }, undefined), 5);
    assert.equal(resolveDevWiConcurrency({}, 0), 1);
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
// R4-08-F2 (ADR-040): review send-back loop bounds — either cap exhausting
// parks the initiative needs-operator.
// ---------------------------------------------------------------------------

test('resolveReviewLoopCaps: defaults to DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS (6) / DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS (24)', () => {
  const origRounds = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  const origItems = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  try {
    const r = resolveReviewLoopCaps({});
    assert.equal(r.maxSendBackRounds, DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS);
    assert.equal(r.maxTotalFixWorkItems, DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS);
    assert.equal(DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS, 6);
    assert.equal(DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS, 24);
  } finally {
    if (origRounds === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = origRounds;
    if (origItems === undefined) delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    else process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = origItems;
  }
});

test('resolveReviewLoopCaps: honours review.{maxSendBackRounds,maxTotalFixWorkItems} from forge.config.json', () => {
  const origRounds = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  const origItems = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  try {
    const r = resolveReviewLoopCaps({ review: { maxSendBackRounds: 3, maxTotalFixWorkItems: 10 } });
    assert.equal(r.maxSendBackRounds, 3);
    assert.equal(r.maxTotalFixWorkItems, 10);
  } finally {
    if (origRounds === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = origRounds;
    if (origItems === undefined) delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    else process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = origItems;
  }
});

test('resolveReviewLoopCaps: env vars override config (operator/CI escape hatch), fields independent', () => {
  const origRounds = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  const origItems = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  try {
    process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = '9';
    delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    const r = resolveReviewLoopCaps({ review: { maxSendBackRounds: 3, maxTotalFixWorkItems: 10 } });
    assert.equal(r.maxSendBackRounds, 9);
    assert.equal(r.maxTotalFixWorkItems, 10);
  } finally {
    if (origRounds === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = origRounds;
    if (origItems === undefined) delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    else process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = origItems;
  }
});

test('resolveReviewLoopCaps: invalid env values (0, negative, non-integer, non-numeric) fall through to config', () => {
  const origRounds = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  const origItems = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  try {
    for (const junk of ['0', '-3', 'abc', '2.5']) {
      process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = junk;
      process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = junk;
      const r = resolveReviewLoopCaps({ review: { maxSendBackRounds: 4, maxTotalFixWorkItems: 15 } });
      assert.equal(r.maxSendBackRounds, 4, `rounds should fall through for env=${junk}`);
      assert.equal(r.maxTotalFixWorkItems, 15, `items should fall through for env=${junk}`);
    }
  } finally {
    if (origRounds === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = origRounds;
    if (origItems === undefined) delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    else process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = origItems;
  }
});

test('resolveReviewLoopCaps: invalid config values (0, negative, NaN) fall through to defaults', () => {
  const origRounds = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  const origItems = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  try {
    assert.deepEqual(
      resolveReviewLoopCaps({ review: { maxSendBackRounds: 0, maxTotalFixWorkItems: -3 } }),
      { maxSendBackRounds: DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS, maxTotalFixWorkItems: DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS },
    );
    assert.deepEqual(
      resolveReviewLoopCaps({ review: { maxSendBackRounds: -3, maxTotalFixWorkItems: Number.NaN } }),
      { maxSendBackRounds: DEFAULT_REVIEW_MAX_SEND_BACK_ROUNDS, maxTotalFixWorkItems: DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS },
    );
  } finally {
    if (origRounds === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = origRounds;
    if (origItems === undefined) delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    else process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = origItems;
  }
});

test('resolveReviewLoopCaps: fields resolve independently — one from env, one from default', () => {
  const origRounds = process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
  const origItems = process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
  try {
    process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = '2';
    delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    const r = resolveReviewLoopCaps({});
    assert.equal(r.maxSendBackRounds, 2);
    assert.equal(r.maxTotalFixWorkItems, DEFAULT_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS);
  } finally {
    if (origRounds === undefined) delete process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS;
    else process.env.FORGE_REVIEW_MAX_SEND_BACK_ROUNDS = origRounds;
    if (origItems === undefined) delete process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS;
    else process.env.FORGE_REVIEW_MAX_TOTAL_FIX_WORK_ITEMS = origItems;
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

// ---------------------------------------------------------------------------
// M4-library PR 2 — `projectStartersDir`/`listProjectStarters` moved here from
// `packages/projects/project-create.ts`. The move's claim is that the new body
// returns the SAME string as the old `join(skillsDir(forgeRoot), '..', ...)`
// for EVERY input. A relative root is the only input that can distinguish
// `join` from `resolve`, and no production caller passes one — so without this
// test the divergence would be inert today and live the first time one did.
// ---------------------------------------------------------------------------

test('projectStartersDir: an ABSOLUTE root composes studio/starters/projects', () => {
  assert.equal(projectStartersDir('/srv/forge'), join('/srv/forge', 'studio', 'starters', 'projects'));
});

test('projectStartersDir: a RELATIVE root stays relative — join, never resolve', () => {
  // `resolve('rel')` would anchor to process.cwd() and return an absolute path.
  const out = projectStartersDir('rel/root');
  assert.equal(out, join('rel', 'root', 'studio', 'starters', 'projects'));
  assert.equal(isAbsolute(out), false, 'a relative forgeRoot must stay relative — resolve() would silently anchor it to cwd');
});

test('projectStartersDir: equals the pre-move composition for both root shapes', () => {
  // The exact expression `packages/projects/project-create.ts` used before the
  // move, with skillsDir inlined as join(root, 'skills').
  const preMove = (root: string): string => join(join(root, 'skills'), '..', 'studio', 'starters', 'projects');
  for (const root of ['/srv/forge', 'rel/root', '.', '../sibling']) {
    assert.equal(projectStartersDir(root), preMove(root), `diverged from the pre-move form for root ${JSON.stringify(root)}`);
  }
});

test('listProjectStarters: an absent starters dir yields [] rather than throwing', () => {
  assert.deepEqual(listProjectStarters(join(tmpdir(), `no-such-root-${Date.now()}`)), []);
});
