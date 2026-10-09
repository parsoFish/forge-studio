/**
 * forge-mfv5.1.12 — a project-bound agent run commits its edits to `forge-studio`.
 *
 * Found on gitweave (capstone A, 2026-10-09): the onboarding agent appended the
 * forge scratch lines to `.gitignore` and edited `.forge/project.json`, and the
 * run ended with both uncommitted in the ground. A dispatch bound to a project now
 * runs inside the forge-studio transaction: what the run made dirty is committed
 * there on success; what was dirty before the run is not the run's to commit; a
 * FAILED run commits nothing, so its partial edits stay visible to the Save
 * refusal.
 *
 * The injected `dispatch` writes the files a real agent would — no agent is spawned.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cmdAgentDispatch } from '../../agent-dispatch-cmd.ts';

process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
delete process.env.FORGE_PROJECTS_DIR;

function g(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

function fixture(): { forgeRoot: string; ground: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'dispatch-tx-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  const ground = join(forgeRoot, 'projects', 'weave');
  mkdirSync(join(ground, '.forge'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', ground]);
  g(ground, ['config', 'user.email', 't@forge.dev']);
  g(ground, ['config', 'user.name', 'Forge Test']);
  writeFileSync(join(ground, '.gitignore'), 'node_modules/\n');
  writeFileSync(join(ground, '.forge', 'project.json'), '{"name":"weave"}\n');
  g(ground, ['add', '.gitignore', '.forge/project.json']);
  g(ground, ['commit', '-q', '-m', 'onboard']);
  return { forgeRoot, ground };
}

function agentThatEdits(ground: string, fail = false) {
  return {
    dispatch: (async (opts: { slug: string; runId: string }) => {
      appendFileSync(join(ground, '.gitignore'), '.forge/work-items/\n');
      writeFileSync(join(ground, '.forge', 'project.json'), '{"name":"weave","testProcess":{}}\n');
      if (fail) throw new Error('agent turn failed');
      return { slug: opts.slug, runId: opts.runId, result: { suppressed: false, costUsd: 0 } };
    }) as never,
  };
}

test('a successful project-bound run leaves the ground clean and its edits committed on forge-studio', async () => {
  const { forgeRoot, ground } = fixture();
  try {
    writeFileSync(join(ground, 'operator-wip.txt'), 'not the run\'s\n'); // dirty BEFORE the run
    await cmdAgentDispatch(['onboarding-agent', '--run-id', 'tx-ok', '--project', 'weave'], forgeRoot, agentThatEdits(ground));

    assert.equal(g(ground, ['rev-parse', '--abbrev-ref', 'HEAD']), 'forge-studio');
    const committed = g(ground, ['diff', '--name-only', 'main', 'forge-studio']).split('\n').sort();
    assert.deepEqual(committed, ['.forge/project.json', '.gitignore']);
    assert.match(g(ground, ['log', '-1', '--pretty=%s']), /^chore\(forge\): onboarding-agent run tx-ok$/);
    assert.equal(g(ground, ['status', '--porcelain']), '?? operator-wip.txt', 'pre-existing dirt is left alone');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('a FAILED project-bound run commits nothing — its partial edits stay dirty for the Save refusal to name', async () => {
  const { forgeRoot, ground } = fixture();
  const exit = process.exit;
  let code: number | undefined;
  process.exit = ((c?: number) => { code = c; }) as never;
  try {
    await cmdAgentDispatch(['onboarding-agent', '--run-id', 'tx-fail', '--project', 'weave'], forgeRoot, agentThatEdits(ground, true));
    assert.equal(code, 1);
    assert.equal(g(ground, ['rev-list', '--count', 'main..forge-studio']), '0');
    assert.match(g(ground, ['status', '--porcelain']), /\.gitignore/);
  } finally {
    process.exit = exit;
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('a run that creates a new directory holding an ignored file still completes, and commits the real file', async () => {
  const { forgeRoot, ground } = fixture();
  try {
    appendFileSync(join(ground, '.gitignore'), '__pycache__/\n');
    g(ground, ['commit', '-q', '-am', 'ignore pycache']);
    const deps = {
      dispatch: (async (opts: { slug: string; runId: string }) => {
        mkdirSync(join(ground, 'pkg', '__pycache__'), { recursive: true });
        writeFileSync(join(ground, 'pkg', '__pycache__', 'm.pyc'), 'x');
        writeFileSync(join(ground, 'pkg', 'm.py'), 'x = 1\n');
        return { slug: opts.slug, runId: opts.runId, result: { suppressed: false, costUsd: 0 } };
      }) as never,
    };
    const exit = process.exit;
    let code: number | undefined;
    process.exit = ((c?: number) => { code = c; }) as never;
    try {
      await cmdAgentDispatch(['onboarding-agent', '--run-id', 'tx-dir', '--project', 'weave'], forgeRoot, deps);
    } finally {
      process.exit = exit;
    }
    assert.equal(code, undefined, 'a successful run is not turned into a failure by its commit');
    assert.deepEqual(g(ground, ['show', '--name-only', '--pretty=', 'HEAD']).split('\n'), ['pkg/m.py']);
    assert.equal(g(ground, ['status', '--porcelain']), '');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
