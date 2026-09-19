/**
 * The door for `heavy-slot.sh` — park `m7-c-004` §A (rows 32/53/44), T1 ruling
 * 1227: build the tool and its tests, wire nothing.
 *
 * WHAT THIS PROVES, and why each shape is here:
 *
 *   - FIFO: `.suite-lock` bare `flock` gives no ordering guarantee to its
 *     waiters (measured: a 6-deep queue, a 40-minute bounded wait losing to a
 *     later arrival). Three heavy-slot waiters enqueued in sequence must run
 *     in that sequence, because the ticket — not the kernel's wait queue — is
 *     what orders them.
 *   - A dead ticket ahead of ours must not block us: reaped on read.
 *   - The memory floor (never MemFree, always MemAvailable) holds a job until
 *     the fake `/proc/meminfo` is rewritten above it — the `HEAVY_SLOT_MEMINFO`
 *     seam, mirroring `FORGE_PROC_LOCKS` and `lanes.sh`'s own meminfo seams.
 *   - A bare (non-ticketed) `flock` holder on `.suite-lock` still excludes a
 *     heavy-slot waiter even when its ticket is first — every existing bare-
 *     flock caller keeps working unmodified.
 *   - The bounded wait is release-and-requeue (ruling 946), never hold-and-
 *     wait: it removes its own ticket and exits 75.
 *   - `status` names positions, the queued rows and the current flock holder.
 *   - Refusals are BY NAME (§15.504 family): a bad kind, a missing campaign
 *     directory, a command with no `--` before it.
 *   - SIGTERM/SIGINT remove the ticket and kill the child by pid (never
 *     `pkill`), whether caught while still queued or already running.
 *
 * EVERY TEST GETS ITS OWN CAMPAIGN DIR (with-locks.test.ts's lesson: a shared
 * lock tests the host's timing, not this file's).
 *
 * TIMING IS EVENT-BASED, NEVER WALL-CLOCK-ASSERTED: `waitFor` polls a
 * predicate against a generous deadline (`performance.now()`), matching the
 * brief — this suite never asserts "took about N seconds", only "happened
 * (or didn't) by the deadline".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'heavy-slot.sh',
);

const ABUNDANT_KB = 999_999_999;

function camp(): string {
  return mkdtempSync(join(tmpdir(), 'heavy-slot-'));
}

/** A fake `/proc/meminfo` naming only the one line this tool is told to read. */
function meminfo(dir: string, kb: number): string {
  const p = join(dir, 'meminfo');
  writeFileSync(p, `MemTotal:       33554432 kB\nMemAvailable:   ${kb} kB\n`);
  return p;
}

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 15000 });
}

/** Poll a predicate against a generous deadline. Never asserts elapsed time. */
async function waitFor(predicate: () => boolean, timeoutMs = 8000, intervalMs = 50): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return predicate();
}

function ticketFiles(d: string): string[] {
  const q = join(d, 'queue');
  if (!existsSync(q)) return [];
  return readdirSync(q).filter((f) => f.endsWith('.ticket')).sort();
}

describe('heavy-slot.sh — refusals are named, never guessed or defaulted', () => {
  test('an unknown kind is refused by name', () => {
    const d = camp();
    try {
      const r = run([d, 'sweet', '--', 'true']);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /kind must be 'suite' or 'story'/);
      assert.match(r.stderr, /sweet/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a missing campaign directory is refused by name, never defaulted (row 29)', () => {
    const missing = join(tmpdir(), 'heavy-slot-does-not-exist-xyz');
    const r = run([missing, 'suite', '--', 'true']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('a command with no -- before it is refused', () => {
    const d = camp();
    try {
      const r = run([d, 'suite', 'true']);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /--/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('no command after -- is refused', () => {
    const d = camp();
    try {
      const r = run([d, 'suite', '--']);
      assert.notEqual(r.status, 0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('heavy-slot.sh — admission order and exclusion', () => {
  test('FIFO: three waiters enqueued in sequence run in that order', async () => {
    const d = camp();
    const mem = meminfo(d, ABUNDANT_KB);
    const orderLog = join(d, 'order.log');
    writeFileSync(orderLog, '');
    const env = { HEAVY_SLOT_MEMINFO: mem };
    const children: ChildProcess[] = [];
    try {
      for (const label of ['A', 'B', 'C']) {
        const c = spawn(
          'bash',
          [SCRIPT, d, 'suite', '--', 'bash', '-c', `printf '%s\\n' ${label} >> "${orderLog}"; sleep 0.4`],
          { env: { ...process.env, ...env }, stdio: 'ignore' },
        );
        children.push(c);
        // Stagger enqueues so the intended order IS the enqueue order, not a race.
        await new Promise((r) => setTimeout(r, 300));
      }
      const done = await waitFor(() => {
        const content = existsSync(orderLog) ? readFileSync(orderLog, 'utf8') : '';
        return content.split('\n').filter(Boolean).length >= 3;
      }, 12000);
      assert.ok(done, 'all three waiters should have run to completion');
      assert.equal(readFileSync(orderLog, 'utf8'), 'A\nB\nC\n', 'the ticket order, not the kernel wait queue, must decide who runs next');
    } finally {
      for (const c of children) c.kill('SIGKILL');
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a dead ticket ahead of ours is reaped and does not block admission', async () => {
    const d = camp();
    const mem = meminfo(d, ABUNDANT_KB);
    const q = join(d, 'queue');
    mkdirSync(q, { recursive: true });
    writeFileSync(join(q, '.seq.count'), '1\n');
    // pid 999999 is not a running process on this box — a dead ticket ahead of ours.
    writeFileSync(
      join(q, '0000000001-999999.ticket'),
      'pid=999999\nlane=fake\nkind=suite\ncwd=/tmp\nmem_avail_kb_at_enqueue=999999999\ncmd=fake\n',
    );
    const marker = join(d, 'marker');
    const r = run([d, 'suite', '--', 'bash', '-c', `echo done > "${marker}"`], { HEAVY_SLOT_MEMINFO: mem });
    try {
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stderr, /reaping dead ticket/);
      assert.ok(existsSync(marker), 'the live ticket must have been admitted despite the dead one ahead');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('the memory floor holds a job until the fake meminfo is rewritten above it', async () => {
    const d = camp();
    const memPath = meminfo(d, 1000); // far below the 4 GiB suite floor
    const marker = join(d, 'marker');
    const env = { HEAVY_SLOT_MEMINFO: memPath };
    const child = spawn('bash', [SCRIPT, d, 'suite', '--', 'bash', '-c', `echo done > "${marker}"`], { env: { ...process.env, ...env }, stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 700));
      assert.equal(existsSync(marker), false, 'must still be held by the memory floor, MemAvailable=1000KB');
      writeFileSync(memPath, 'MemAvailable:   999999999 kB\n');
      const done = await waitFor(() => existsSync(marker), 8000);
      assert.ok(done, 'must proceed once MemAvailable clears the floor');
    } finally { child.kill('SIGKILL'); rmSync(d, { recursive: true, force: true }); }
  });

  test('a bare flock holder on .suite-lock blocks admission even when the ticket is first', async () => {
    const d = camp();
    const mem = meminfo(d, ABUNDANT_KB);
    const lockPath = join(d, '.suite-lock');
    writeFileSync(lockPath, '');
    const holder = spawn('flock', [lockPath, 'sleep', '3'], { stdio: 'ignore' });
    spawnSync('sleep', ['0.3']); // let the holder actually acquire before we race it
    const marker = join(d, 'marker');
    const env = { HEAVY_SLOT_MEMINFO: mem };
    const child = spawn('bash', [SCRIPT, d, 'suite', '--', 'bash', '-c', `echo done > "${marker}"`], { env: { ...process.env, ...env }, stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 700));
      assert.equal(existsSync(marker), false, 'a stranger holds .suite-lock — a ticket being first must not cut in front of it');
      holder.kill('SIGKILL');
      const done = await waitFor(() => existsSync(marker), 8000);
      assert.ok(done, 'must be admitted once the stranger releases');
    } finally { child.kill('SIGKILL'); holder.kill('SIGKILL'); rmSync(d, { recursive: true, force: true }); }
  });

  test('a bounded wait releases the ticket and exits 75 (release-and-requeue, ruling 946)', () => {
    const d = camp();
    const mem = meminfo(d, 1000); // never clears the suite floor
    const r = run([d, 'suite', '--', 'true'], { HEAVY_SLOT_MEMINFO: mem, HEAVY_SLOT_MAX_WAIT: '1' });
    try {
      assert.equal(r.status, 75, r.stdout + r.stderr);
      assert.match(r.stderr, /BOUNDED WAIT EXCEEDED/);
      assert.equal(ticketFiles(d).length, 0, 'the ticket must be removed — never held while waiting');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('heavy-slot.sh — status', () => {
  test('status names positions, the queued rows, and the current flock holder', async () => {
    const d = camp();
    const mem = meminfo(d, 1000); // keep both waiting so there is something to list
    const env = { HEAVY_SLOT_MEMINFO: mem };
    const c1 = spawn('bash', [SCRIPT, d, 'suite', '--', 'sleep', '30'], { env: { ...process.env, ...env }, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 400));
    const c2 = spawn('bash', [SCRIPT, d, 'story', '--', 'sleep', '30'], { env: { ...process.env, ...env }, stdio: 'ignore' });
    try {
      await waitFor(() => ticketFiles(d).length === 2, 6000);
      const r = spawnSync('bash', [SCRIPT, d, 'status'], { encoding: 'utf8', env: { ...process.env, ...env } });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /1\)/);
      assert.match(r.stdout, /2\)/);
      assert.match(r.stdout, /kind=suite/);
      assert.match(r.stdout, /kind=story/);
      assert.match(r.stdout, /\.suite-lock/);
    } finally { c1.kill('SIGTERM'); c2.kill('SIGTERM'); rmSync(d, { recursive: true, force: true }); }
  });
});

describe('heavy-slot.sh — signals', () => {
  test('SIGTERM while waiting removes the ticket and exits 143', async () => {
    const d = camp();
    const mem = meminfo(d, 1000); // stays queued, never admitted
    const env = { HEAVY_SLOT_MEMINFO: mem };
    const child = spawn('bash', [SCRIPT, d, 'suite', '--', 'true'], { env: { ...process.env, ...env }, stdio: 'ignore' });
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    try {
      await waitFor(() => ticketFiles(d).length === 1, 5000);
      child.kill('SIGTERM');
      const code = await exited;
      assert.equal(code, 143);
      assert.equal(ticketFiles(d).length, 0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('SIGINT while running kills the child by pid (never pkill) and removes the ticket', async () => {
    const d = camp();
    const mem = meminfo(d, ABUNDANT_KB);
    const env = { HEAVY_SLOT_MEMINFO: mem };
    const marker = join(d, 'never');
    const child = spawn(
      'bash',
      [SCRIPT, d, 'suite', '--', 'bash', '-c', `sleep 30; echo late > "${marker}"`],
      { env: { ...process.env, ...env }, stdio: 'ignore' },
    );
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    try {
      // Give it time to be admitted and to spawn the command.
      await new Promise((r) => setTimeout(r, 700));
      child.kill('SIGINT');
      const code = await exited;
      assert.equal(code, 130);
      assert.equal(ticketFiles(d).length, 0);
      await new Promise((r) => setTimeout(r, 500));
      assert.equal(existsSync(marker), false, 'the child (running "sleep 30; echo late") must have been killed, not left running');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
