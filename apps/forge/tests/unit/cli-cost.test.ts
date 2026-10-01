/**
 * `forge cost by-class` — the VERB's shell: argv in, a table or `--json` out.
 * The producer (`costByClass`) is tested in
 * `packages/flows/tests/unit/cost-by-class.test.ts`; this file only covers
 * what the verb itself owns: flag parsing, the `--root` override, table vs
 * `--json` rendering, and fail-loud-on-mis-invocation (mirrors
 * `cli-gate.test.ts`'s convention for this CLI).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cmdCost } from '../../cli-cost.ts';

function setupForgeRoot(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-cli-cost-'));
  const doneDir = join(forgeRoot, '_queue', 'done');
  mkdirSync(doneDir, { recursive: true });
  writeFileSync(
    join(doneDir, 'INIT-fixture.md'),
    [
      '---',
      'initiative_id: INIT-fixture',
      'project: fixture-project',
      "created_at: '2026-01-01T00:00:00.000Z'",
      'class: code',
      'cycle_id: cyc-fixture',
      '---',
      '',
      '## Goal',
      'Fixture.',
      '',
    ].join('\n'),
  );
  const logDir = join(forgeRoot, '_logs', 'cyc-fixture');
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, 'events.jsonl'),
    JSON.stringify({
      event_id: 'e1', cycle_id: 'cyc-fixture', initiative_id: 'INIT-fixture',
      phase: 'developer-loop', skill: 'dev', event_type: 'end',
      input_refs: [], output_refs: [], cost_usd: 3, started_at: '2026-01-01T00:00:00.000Z',
    }) + '\n',
  );
  return forgeRoot;
}

/** Run the verb with stdout/stderr captured, returning both plus the exit code. */
async function run(args: string[], forgeRoot: string): Promise<{ code: number; out: string; err: string }> {
  const outs = { log: console.log, error: console.error };
  let out = '';
  let err = '';
  console.log = (...a: unknown[]) => { out += a.join(' ') + '\n'; };
  console.error = (...a: unknown[]) => { err += a.join(' ') + '\n'; };
  process.exitCode = 0;
  try {
    cmdCost(args, forgeRoot);
    return { code: process.exitCode ?? 0, out, err };
  } finally {
    console.log = outs.log;
    console.error = outs.error;
    process.exitCode = 0;
  }
}

test('forge cost by-class prints a table with the class/merged/total/mean/unpriced columns, exit 0', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const { code, out } = await run(['by-class'], forgeRoot);
    assert.equal(code, 0);
    assert.match(out, /class/);
    assert.match(out, /merged/);
    assert.match(out, /code/);
    assert.match(out, /\$3\.00/, 'the fixture\'s priced $3 total must appear in the rendered table');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('forge cost by-class --json prints parseable JSON matching the producer', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    const { code, out } = await run(['by-class', '--json'], forgeRoot);
    assert.equal(code, 0);
    const rows = JSON.parse(out) as Array<{ class: string; merged: number; totalUsd: number; unpriced: number }>;
    const code_ = rows.find((r) => r.class === 'code');
    assert.ok(code_, 'expected a "code" row in the JSON output');
    assert.equal(code_!.merged, 1);
    assert.equal(code_!.totalUsd, 3);
    assert.equal(code_!.unpriced, 0);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('forge cost by-class --root <path> reads that root instead of the default', async () => {
  const defaultRoot = mkdtempSync(join(tmpdir(), 'forge-cli-cost-default-'));
  const otherRoot = setupForgeRoot();
  try {
    const { code, out } = await run(['by-class', '--root', otherRoot, '--json'], defaultRoot);
    assert.equal(code, 0);
    const rows = JSON.parse(out) as Array<{ class: string }>;
    assert.ok(rows.some((r) => r.class === 'code'), '--root must override the default forge root, not just decorate it');
  } finally {
    rmSync(defaultRoot, { recursive: true, force: true });
    rmSync(otherRoot, { recursive: true, force: true });
  }
});

test('forge cost by-class on an empty forge root → explanatory message, exit 0 (a reporting verb, not a usage error)', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-cli-cost-empty-'));
  try {
    const { code, out } = await run(['by-class'], forgeRoot);
    assert.equal(code, 0);
    assert.match(out, /no merged initiatives/i);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('forge cost with an unknown subcommand exits 2', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    assert.equal((await run(['bogus'], forgeRoot)).code, 2);
    assert.equal((await run([], forgeRoot)).code, 2);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('forge cost by-class with an unknown flag exits 2 — fails loud instead of silently ignoring it', async () => {
  const forgeRoot = setupForgeRoot();
  try {
    assert.equal((await run(['by-class', '--bogus'], forgeRoot)).code, 2);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
