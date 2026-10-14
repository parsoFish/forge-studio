/**
 * forge-nk1y.42 at the preflight door: both `preflightDemoCommands` callers
 * (the pre-claim check and the integrate band) refuse a checkpoint head that
 * would run a PATH copy of the tree's own command, and accept it once the
 * project declares an in-tree run prefix (`demoMeans.run`). No command is
 * spawned: every case is a resolution over a tmp tree (§6.16).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { preflightDemoCaptureCommands, preflightDemoCommands } from '../../phases/orchestrated-capture.ts';
import { demoCheckpointPreflightRefusal } from '../../demo-checkpoint-preflight.ts';
import { writeWorkItem } from '../../work-item.ts';

const PYPROJECT = '[project]\nname = "gitweave"\n\n[project.scripts]\ngw = "gitweave.cli:main"\n';

function withTree(fn: (tree: string, staleGw: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'preflight-in-tree-'));
  const tree = join(root, 'tree');
  const stale = join(root, 'stale-bin');
  mkdirSync(join(tree, '.forge'), { recursive: true });
  mkdirSync(stale);
  writeFileSync(join(stale, 'gw'), '#!/bin/sh\necho stale\n');
  chmodSync(join(stale, 'gw'), 0o755);
  writeFileSync(join(tree, 'pyproject.toml'), PYPROJECT);
  writeFileSync(join(tree, 'cli.mjs'), '');
  const saved = process.env.PATH;
  process.env.PATH = [stale, dirname(process.execPath)].join(delimiter);
  try {
    fn(tree, join(stale, 'gw'));
  } finally {
    process.env.PATH = saved;
    rmSync(root, { recursive: true, force: true });
  }
}

function declareRun(tree: string, run: Record<string, string> | undefined): void {
  writeFileSync(
    join(tree, '.forge', 'project.json'),
    JSON.stringify({ testProcess: { local: { cmd: ['true'] } }, ...(run ? { demoMeans: { run } } : {}) }),
  );
}

test('preflightDemoCommands refuses a PATH copy of the tree’s own command by name', () => {
  withTree((tree, staleGw) => {
    const r = preflightDemoCommands([{ label: 'AC 1: WI-1', command: 'gw plan' }], tree);
    assert.equal(r.ok, false);
    assert.ok(r.problems[0]!.includes(`checkpoint "AC 1: WI-1": \`gw\` resolves to ${staleGw} outside the capture tree`), r.problems[0]);
  });
});

test('preflightDemoCommands accepts it under a declared run prefix', () => {
  withTree((tree) => {
    const r = preflightDemoCommands([{ label: 'AC 1: WI-1', command: 'gw plan' }], tree, { runPrefixes: { gw: 'node ./cli.mjs' } });
    assert.deepEqual(r, { ok: true, problems: [] });
  });
});

test('an absolute path-bearing head outside the tree is refused at preflight', () => {
  withTree((tree, staleGw) => {
    const r = preflightDemoCommands([{ label: 'cp', command: `${staleGw} plan` }], tree);
    assert.equal(r.ok, false);
    assert.match(r.problems[0]!, /outside the capture tree/);
  });
});

test('preflightDemoCaptureCommands reads the project’s demoMeans.run from the tree', () => {
  withTree((tree) => {
    const demoJson = join(tree, 'demo.json');
    writeFileSync(demoJson, JSON.stringify({ checkpoints: [{ label: 'Plan 1', command: 'gw plan' }] }));
    declareRun(tree, undefined);
    assert.equal(preflightDemoCaptureCommands(demoJson, tree).ok, false);
    declareRun(tree, { gw: 'node ./cli.mjs' });
    assert.deepEqual(preflightDemoCaptureCommands(demoJson, tree), { ok: true, problems: [] });
  });
});

test('the pre-claim check reads the project’s demoMeans.run from the tree', () => {
  withTree((tree) => {
    writeWorkItem(
      {
        work_item_id: 'WI-1',
        initiative_id: 'INIT-2026-01-01-test',
        status: 'pending',
        depends_on: [],
        acceptance_criteria: [{ given: 'g', when: 'the operator runs `gw plan`', then: 't' }],
        files_in_scope: ['gitweave/cli.py'],
        estimated_iterations: 1,
        quality_gate_cmd: ['true'],
        body: '# WI-1\n',
      },
      tree,
    );
    declareRun(tree, undefined);
    assert.match(demoCheckpointPreflightRefusal(tree, 'code') ?? '', /outside the capture tree.*demoMeans\.run/);
    declareRun(tree, { gw: 'node ./cli.mjs' });
    assert.equal(demoCheckpointPreflightRefusal(tree, 'code'), null);
  });
});

test('an unreadable project.json is a named refusal, never "no prefixes"', () => {
  withTree((tree) => {
    const demoJson = join(tree, 'demo.json');
    writeFileSync(demoJson, JSON.stringify({ checkpoints: [{ label: 'Plan 1', command: 'node -v' }] }));
    writeFileSync(join(tree, '.forge', 'project.json'), '{not json');
    const r = preflightDemoCaptureCommands(demoJson, tree);
    assert.equal(r.ok, false);
    assert.match(r.problems[0]!, /project\.json/);
  });
});
