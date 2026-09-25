/**
 * gh-slot.sh — the door for M7 findings row 16.
 *
 * Each lane that needed to serialise `gh` calls hand-rolled its own copy
 * (`_1.0/m6-a-gh-slot.sh`, untracked, lane-local, never shared, never
 * tested). This promotes ONE shared `gh-slot.sh <slot-file> -- <gh args...>`
 * into the skill: flock the given slot file with a bounded wait, run `gh`,
 * pass its exit code through, refuse without a slot path.
 *
 * The tests use a fake `gh` on PATH rather than the real CLI: what matters
 * here is the wrapper's OWN behaviour (serialisation, refusal, exit-code
 * passthrough), not anything `gh` itself does.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GH_SLOT = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gh-slot.sh',
);

/** A scratch dir holding a fake `gh` on its own PATH entry, plus a slot file path. */
function fixture() {
  const d = mkdtempSync(join(tmpdir(), 'gh-slot-'));
  const bin = join(d, 'bin');
  mkdirSync(bin, { recursive: true });
  return { dir: d, bin, slot: join(d, 'slot', '.gh-slot') };
}

/** A fake `gh` that records a start/end timestamp pair (ms epoch) per call to
 *  LOG, sleeping DELAY_MS between them, and exits with EXIT_CODE. Used to
 *  prove two concurrent gh-slot.sh calls never overlap inside the fake gh. */
function writeRecordingGh(bin: string, log: string, delayMs: number, exitCode = 0) {
  const script = `#!/usr/bin/env bash
node -e "require('fs').appendFileSync('${log}', 'start ' + Date.now() + '\\n')"
sleep ${delayMs / 1000}
node -e "require('fs').appendFileSync('${log}', 'end ' + Date.now() + '\\n')"
exit ${exitCode}
`;
  const p = join(bin, 'gh');
  writeFileSync(p, script);
  chmodSync(p, 0o755);
}

function runWithFakeGh(bin: string, args: string[]) {
  return spawnSync('bash', [GH_SLOT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

describe('gh-slot.sh — one shared gh serialisation slot (M7 row 16)', () => {
  test('refuses with no slot-file given', () => {
    const r = spawnSync('bash', [GH_SLOT], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no slot-file given/);
  });

  test('refuses when the gh args are missing entirely (no -- at all)', () => {
    const { slot } = fixture();
    const r = spawnSync('bash', [GH_SLOT, slot], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /expected '--'/);
  });

  test("refuses when '--' is present but no gh args follow it", () => {
    const { slot } = fixture();
    const r = spawnSync('bash', [GH_SLOT, slot, '--'], { encoding: 'utf8' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no gh args given/);
  });

  test('runs gh and passes its exit code through unchanged', () => {
    const { bin, slot } = fixture();
    writeRecordingGh(bin, join(bin, 'unused.log'), 0, 7);
    const r = runWithFakeGh(bin, [slot, '--', 'pr', 'view', '1']);
    assert.equal(r.status, 7);
  });

  test('two concurrent invocations serialise: the second never starts before the first ends', async () => {
    const { bin, slot } = fixture();
    const log = join(bin, 'calls.log');
    writeFileSync(log, '');
    writeRecordingGh(bin, log, 300, 0);

    const spawnOne = () => new Promise<void>((resolve) => {
      const child = spawn('bash', [GH_SLOT, slot, '--', 'pr', 'create'], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      child.on('exit', () => resolve());
    });

    await Promise.all([spawnOne(), spawnOne()]);

    const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => {
      const [kind, ts] = l.split(' ');
      return { kind, ts: Number(ts) };
    });
    assert.equal(lines.length, 4, `expected 2 starts + 2 ends, got: ${JSON.stringify(lines)}`);
    const starts = lines.filter((l) => l.kind === 'start').map((l) => l.ts).sort((a, b) => a - b);
    const ends = lines.filter((l) => l.kind === 'end').map((l) => l.ts).sort((a, b) => a - b);
    // Serialised means: the SECOND call cannot start before the FIRST ends.
    assert.ok(
      starts[1]! >= ends[0]!,
      `the second gh call started (${starts[1]}) before the first ended (${ends[0]}) — the slot did not serialise them`,
    );
  });

  test('the slot file directory is created if it does not exist yet', () => {
    const { bin, slot } = fixture(); // slot's parent dir ("slot/") is not created by fixture()
    writeRecordingGh(bin, join(bin, 'unused.log'), 0, 0);
    const r = runWithFakeGh(bin, [slot, '--', 'pr', 'view', '1']);
    assert.equal(r.status, 0, r.stderr);
  });
});
