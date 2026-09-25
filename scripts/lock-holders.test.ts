/**
 * The door for `lock-holders.sh` — T1 ruling 1353, M7 findings row 80.
 *
 * MEASURED, NOT GUESSED (lane D, 3x): a lock held through the campaign's own
 * `exec N>file; flock -n N` idiom (heavy-slot.sh, with-locks.sh, gate.sh all
 * hold `.suite-lock` this way) is genuinely held — a fresh `flock -n` on the
 * same path fails — and has ZERO rows in `/proc/locks`. The external `flock`
 * binary that performs the acquire is invoked against an ALREADY-OPEN fd
 * (`flock -n <fd-number>`, not `flock -n <path>`); it locks the shared open
 * file description and exits immediately since no command follows, so the pid
 * `/proc/locks` would have attributed the lock to is gone a moment later. The
 * lock persists — the parent shell's own copy of the fd keeps the open file
 * description alive — but the listing has nothing left to point at.
 *
 * Confirmed here directly (see the header prose replicated in gate.sh and
 * with-locks.sh): `flock <path> <command>` (execs the command, same pid stays
 * alive) DOES leave a row; `exec N>path; flock -n N` (no command, the locker
 * exits) does NOT. Both are advisory locks the kernel enforces identically —
 * only the LISTING differs.
 *
 * THE RULE THIS FILE'S SUBJECT ENFORCES: a process holds the lock iff
 *   (a) NAMED     — some /proc/<pid>/fd/* resolves (dev+inode) to the file
 *   (b) CONFIRMED — a fresh, independent `flock -n <file> true` FAILS now
 * Neither alone is enough: (a) alone over-reports a released-but-still-open
 * fd as a hold; (b) alone can never name anyone.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HELPER = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lock-holders.sh',
);

function lockFile(): { dir: string; lock: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lock-holders-'));
  const lock = join(dir, '.suite-lock');
  writeFileSync(lock, '');
  return { dir, lock };
}

/** Waits for a "READY" line so callers never race the child's own acquire. */
function waitReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString();
      if (buf.includes('READY')) { child.stdout!.off('data', onData); resolve(); }
    };
    child.stdout!.on('data', onData);
    child.once('exit', (code) => reject(new Error(`holder exited early (${code}); buf=${buf}`)));
  });
}

/** A STRANGER hold: the invisible inherited-fd shape, from a process that is
 *  NOT an ancestor of whatever later runs the checker. */
function holdInvisibleAsStranger(lock: string): ChildProcess {
  const child = spawn(
    'bash', ['-c', `exec 8>${JSON.stringify(lock)}; flock -n 8 || exit 9; echo READY; exec sleep 60`],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return child;
}

/** Opens the lock (fd stays open) then EXPLICITLY RELEASES it — the stale-
 *  opener case a probe-less reader over-reports as held. */
function openThenRelease(lock: string): ChildProcess {
  const child = spawn(
    'bash', ['-c', `exec 8>${JSON.stringify(lock)}; flock -n 8 || exit 9; flock -u 8; echo READY; exec sleep 60`],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return child;
}

/** Holds the lock via the inherited-fd idiom, THEN runs the checker as ITS
 *  OWN CHILD with that fd explicitly closed (`8>&-`) — closed so the checker
 *  does not also appear to hold it, exactly as with-locks.sh/gate.sh close the
 *  descriptor before running whatever they wrap. The checker's ppid is the
 *  holder, so a correct ANCESTOR classification requires walking up, not a
 *  self-match. */
function checkerUnderAncestorHold(lock: string, args: string[]) {
  const argv = args.map((a) => JSON.stringify(a)).join(' ');
  const cmd = `exec 8>${JSON.stringify(lock)}; flock -n 8 || { echo NOFLOCK; exit 9; }; ` +
    `bash ${JSON.stringify(HELPER)} ${argv} 8>&-`;
  return spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
}

const state = (lock: string) => spawnSync('bash', [HELPER, 'state', lock], { encoding: 'utf8' });

describe('lock-holders.sh — named AND confirmed, never /proc/locks alone', () => {
  test('FREE: nobody holds it', () => {
    const { dir, lock } = lockFile();
    try {
      const r = state(lock);
      assert.equal(r.stdout.trim(), 'FREE', r.stdout + r.stderr);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('ANCESTOR: a real inherited-fd hold, held by the checker\'s own parent, is detected — not read as FREE', async () => {
    const { dir, lock } = lockFile();
    try {
      const r = checkerUnderAncestorHold(lock, ['state', lock]);
      assert.match(
        r.stdout.trim(), /^ANCESTOR:\d+$/,
        `must name the parent as holder, not FREE (the /proc/locks-blind failure mode): ${r.stdout}${r.stderr}`,
      );
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('STRANGER: the same invisible shape, held by a NON-ancestor, is named and never dropped to FREE', async () => {
    const { dir, lock } = lockFile();
    const holder = holdInvisibleAsStranger(lock);
    try {
      await waitReady(holder);
      const r = state(lock);
      assert.match(r.stdout.trim(), /^STRANGER:\d+$/, r.stdout + r.stderr);
      assert.equal(Number(r.stdout.trim().split(':')[1]), holder.pid, 'the pid named must be the real holder, not a stand-in');
    } finally { holder.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
  });

  test('CO-OPENER: a process with the file open but never holding the flock is never named — even while someone else genuinely holds it', async () => {
    const { dir, lock } = lockFile();
    const holder = holdInvisibleAsStranger(lock);
    // Opens the SAME file, tries to flock it and FAILS (contended), keeps the
    // fd open anyway — the exact shape the CHECKING process itself is in
    // right before it asks this question (this is what let gate.sh misread a
    // second gate's own collision as ANCESTOR OF ITSELF before this fix: the
    // scan found its own not-yet-flocked fd and a global probe alone could
    // not tell it apart from the real holder's).
    const coOpener = spawn(
      'bash', ['-c', `exec 8>${JSON.stringify(lock)}; flock -n 8 && echo BUG_ACQUIRED; echo READY; exec sleep 60`],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      await waitReady(holder);
      await waitReady(coOpener);
      const r = state(lock);
      assert.match(r.stdout.trim(), /^STRANGER:\d+$/, r.stdout + r.stderr);
      assert.equal(
        Number(r.stdout.trim().split(':')[1]), holder.pid,
        `must name the real holder only, never the co-opener: ${r.stdout}${r.stderr}`,
      );
    } finally { holder.kill('SIGKILL'); coOpener.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
  });

  test('STALE OPENER: an fd left open after its own flock -u must read FREE — naming alone over-reports', async () => {
    const { dir, lock } = lockFile();
    const opener = openThenRelease(lock);
    try {
      await waitReady(opener);
      const r = state(lock);
      assert.equal(r.stdout.trim(), 'FREE', `a released-but-open fd is not a hold: ${r.stdout}${r.stderr}`);
    } finally { opener.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
  });

  test('holders verb prints exactly the confirmed pid(s), one per line', async () => {
    const { dir, lock } = lockFile();
    const holder = holdInvisibleAsStranger(lock);
    try {
      await waitReady(holder);
      const r = spawnSync('bash', [HELPER, 'holders', lock], { encoding: 'utf8' });
      assert.equal(r.stdout.trim(), String(holder.pid), r.stdout + r.stderr);
    } finally { holder.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
  });
});
