/**
 * `lane-lsp.sh` — a lane lists or stops ITS OWN language servers, and nobody
 * else's. `forge-8vfn.7.6.58`, operator instruction via rulings 809/812.
 *
 * The two doors that matter are the ones about what it must NOT touch. A tool
 * that kills processes is only as good as its refusal to kill the wrong ones,
 * and this session has produced both failure modes in one night:
 *
 *   * `pkill -f "test-reporter=spec"` matched the very shell that typed the
 *     pattern — exit 144, ruling 665, and D hit the identical thing an hour
 *     apart with `e2e-journey`. Hence PID-only, never a pattern.
 *   * a census keyed on cmdline alone flagged a sibling's WRAPPER SHELL because
 *     its command text merely contained the word (§15.440). Hence `comm` gates
 *     and `cmdline` only discriminates.
 *
 * The fixtures build a real process tree with `--from` as the anchor, because
 * there is no `claude` ancestor in a test and faking one would test a different
 * program.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync, rmSync } from 'node:fs';

const TOOL = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lane-lsp.sh');

const run = (...args: string[]) => {
  const r = spawnSync('bash', [TOOL, ...args], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};

/** A live `node` whose cmdline carries a server path.
 *
 *  The first draft ran `node <path-to-tsserver.js>` directly — and that path does
 *  not exist here, so node exited instantly and every door read `servers=0`
 *  against a fixture that was already dead. `-e` keeps it alive and the trailing
 *  argument puts the path in the cmdline, which is what the discriminator reads. */
function serverLike(): ChildProcess {
  return spawn(process.execPath,
    ['-e', 'setTimeout(() => {}, 60000)',
     '/home/parso/.nvm/versions/node/v22.21.1/lib/node_modules/typescript/lib/tsserver.js'],
    { stdio: 'ignore' });
}

const alive = (p: number) => { try { process.kill(p, 0); return true; } catch { return false; } };
const settle = () => new Promise((r) => setTimeout(r, 700));

describe('lane-lsp.sh — only its own session, only by PID (forge-8vfn.7.6.58)', () => {
  test('status LISTS a language server descended from the anchor', async () => {
    const srv = serverLike();
    await settle();
    try {
      const r = run('status', '--from', String(process.pid));
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, new RegExp(`LSP pid=${srv.pid}\\b`), `expected to find pid ${srv.pid}:\n${r.out}`);
      assert.match(r.out, /servers=1\b/, r.out);
    } finally {
      srv.kill();
    }
  });

  test('a server that is NOT a descendant of the anchor is left alone — the door that matters', async () => {
    // A sibling lane's `tsserver` is 500 MB of somebody else's memory. If this
    // door ever goes green wrongly, the tool kills another campaign's work.
    const srv = serverLike();                       // child of THIS test process
    const stranger = spawn('bash', ['-c', 'sleep 30'], { stdio: 'ignore' });
    await settle();
    try {
      // Anchor on a process the server does NOT descend from. `stop`, not
      // `status`, because the consequence of getting this wrong is a kill.
      const r = run('stop', '--from', String(stranger.pid));
      assert.match(r.out, /servers=0\b/, `a non-descendant must not be claimed:\n${r.out}`);
      assert.match(r.out, /nothing to stop/, 'and says so rather than printing an empty success');
      assert.equal(alive(srv.pid!), true, 'the server must survive a run that did not own it');
    } finally {
      srv.kill(); stranger.kill();
    }
  });

  test('stop KILLS by PID and reports what it freed', async () => {
    const srv = serverLike();
    await settle();
    const pid = srv.pid!;
    try {
      const r = run('stop', '--from', String(process.pid));
      assert.equal(r.status, 0, r.out);
      assert.match(r.out, new RegExp(`stopped pid=${pid}\\b`), r.out);
      assert.match(r.out, /freed ~\d+MB/, 'and reports the reclaim');
      await settle();
      assert.equal(alive(pid), false, 'the server must actually be gone');
    } finally {
      if (alive(pid)) srv.kill();
    }
  });

  test('a SHELL whose command text merely mentions tsserver is NOT matched (§15.440)', async () => {
    // The census defect, in a tool that kills rather than counts. This very test
    // file, a job log being catted, or the tool being invoked all put the word in
    // a `bash -c` cmdline — and every one of those is a descendant of the anchor.
    // THE DECOY MUST STAY A SHELL AND KEEP THE WORD. The first draft used
    // `bash -c 'sleep 30 # typescript/lib/tsserver.js decoy'` — and bash EXECS a
    // lone simple command, so it replaced itself with `sleep`: comm became
    // `sleep` and the cmdline lost the marker entirely. The door passed because
    // there was nothing to match, not because the comm gate worked, and removing
    // that gate left it green. `; :` defeats the exec optimisation and the
    // trailing argument puts the path in the cmdline where a wrapper would
    // really carry it.
    const sh = spawn('bash', ['-c', 'sleep 30; :', '/home/parso/x/typescript/lib/tsserver.js'],
      { stdio: 'ignore' });
    await settle();
    try {
      const r = run('status', '--from', String(process.pid));
      assert.doesNotMatch(r.out, new RegExp(`LSP pid=${sh.pid}\\b`),
        `a bash wrapper must never be matched:\n${r.out}`);
      assert.equal(alive(sh.pid!), true);
    } finally {
      sh.kill();
    }
  });

  test('with no claude session and no --from it REFUSES rather than guessing', () => {
    // RUN DETACHED. The first draft called the tool directly and it found
    // `session=249942` — because `node --test` IS a descendant of the lane's own
    // claude session, so discovery worked exactly as designed and the door's
    // premise was false. `setsid` cuts the chain so the refusal path is the one
    // actually exercised. A door whose premise the environment quietly satisfies
    // tests nothing.
    // ORPHANED, not merely setsid'd. `setsid` starts a new SESSION but leaves the
    // parent chain intact, and under `spawnSync` node stays alive as the parent —
    // so discovery still walked up to the lane's real `claude` and the door read
    // `session=249942`. The chain only breaks when the intermediate parent EXITS
    // and the child reparents to init, which is why the same command appeared to
    // work from an interactive shell and not from a test.
    const outFile = join(tmpdir(), `lane-lsp-orphan-${process.pid}.log`);
    spawnSync('bash', ['-c', `setsid bash ${TOOL} status > ${outFile} 2>&1 < /dev/null & exit 0`]);
    const deadline = Date.now() + 5000;
    let out = '';
    while (Date.now() < deadline) {
      try { out = readFileSync(outFile, 'utf8'); } catch { out = ''; }
      if (out.includes('REFUSING') || out.includes('session=')) break;
      spawnSync('sleep', ['0.2']);
    }
    rmSync(outFile, { force: true });
    const r = { status: out.includes('REFUSING') ? 3 : 0, out };
    assert.notEqual(r.status, 0, `expected a refusal:\n${r.out}`);
    assert.match(r.out, /REFUSING/, r.out);
    assert.match(r.out, /own session|parent chain/i, 'and says why');
  });

  test('an anchor pid that is not running REFUSES', () => {
    const r = run('status', '--from', '2');
    // pid 2 exists on Linux (kthreadd) — use one that cannot.
    const r2 = run('status', '--from', '999999');
    assert.notEqual(r2.status, 0, `expected a refusal:\n${r2.out}`);
    assert.match(r2.out, /not running/, r2.out);
    assert.ok(r.status !== undefined);
  });

  test('status reports ZERO explicitly — a clean report, never silence', () => {
    // `forge-e8dn`: an instrument that says nothing when it found nothing is
    // indistinguishable from one that did not run.
    const r = run('status', '--from', String(process.pid));
    assert.match(r.out, /servers=\d+/, `the count must always print:\n${r.out}`);
    assert.match(r.out, /session=\d+/, 'and the anchor it used');
  });
});
