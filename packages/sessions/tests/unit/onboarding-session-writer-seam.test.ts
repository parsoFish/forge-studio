/**
 * onboarding-session-writer-seam.test.ts — the four SEAM-level tests of
 * `writeOnboardingSession`, moved here by the M4 routes carve.
 *
 * These four (R4-17 AT-13/14/15/18) call the writer DIRECTLY and deliberately.
 * Their subject is the writer itself, not the route: each plants a real
 * filesystem object — a symlinked `status.json`, a symlinked `prompt.md`, a
 * pre-existing session directory — and asserts the write is refused without
 * following the link, with AT-18 as the ACCEPT control proving an ordinary
 * write still succeeds. A status code cannot express any of that, which is why
 * they were written at the seam rather than over HTTP.
 *
 * WHY THEY MOVED. The writer carved into this package with the four
 * session-minting routes, which left `cli/ui-bridge-onboarding-start.test.ts`
 * importing `@forge/sessions` — a `legacy-to-package` edge. The split follows
 * the line the tests already drew: seam-level tests of a package function come
 * to the package (COMMON §5), and the HTTP-level acceptance tests stay in
 * `cli/` (§5's other half), now with no package import.
 *
 * Nothing about the assertions changed — only where they live.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeOnboardingSession } from '../../bridge-studio-kickoff.ts';

test('R4-17 AT-13 (BLOCKER, pin 5 item 1 / pin 6 re-point, REJECT — seam-level, explicit sessionId, real filesystem object, never a status code / thrown-or-not check alone): writeOnboardingSession is called DIRECTLY against a KNOWN session id whose directory already exists with status.json as a SYMLINK to an outside sentinel file; the call must never write through it', async () => {
  const project = 'symlinkstatusleafproj-seam';
  const onboardingDir = mkdtempSync(join(tmpdir(), 'onboarding-seam-status-parent-'));
  const sessionId = 'r4-17-seam-status-fixed-2026-08-06T00-00-00';
  const sessionDir = join(onboardingDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const sentinelDir = mkdtempSync(join(tmpdir(), 'onboarding-status-sentinel-'));
  const sentinelPath = join(sentinelDir, 'outside-status.json');
  const sentinelContent = 'SENTINEL-STATUS-UNTOUCHED-7f3c91';
  writeFileSync(sentinelPath, sentinelContent, 'utf8');
  symlinkSync(sentinelPath, join(sessionDir, 'status.json'));
  try {
    try {
      writeOnboardingSession(onboardingDir, sessionId, project, '_agent-onboarding-seam-status-test', { northStar: 'symlinked status.json probe' });
    } catch { /* expected — refusal is asserted on the filesystem below, not on the throw itself */ }
    assert.equal(
      readFileSync(sentinelPath, 'utf8'), sentinelContent,
      `the outside sentinel target of a planted status.json symlink must be byte-unchanged for the KNOWN session id ${sessionId} — a write-through here means writeOnboardingSession reused a pre-existing session dir and/or wrote through a pre-existing symlink instead of refusing it`,
    );
  } finally {
    rmSync(onboardingDir, { recursive: true, force: true });
    rmSync(sentinelDir, { recursive: true, force: true });
  }
});

test('R4-17 AT-14 (BLOCKER, pin 5 item 1 / pin 6 re-point, REJECT — seam-level, explicit sessionId, real filesystem object, never a status code / thrown-or-not check alone): writeOnboardingSession is called DIRECTLY against a KNOWN session id whose directory already exists with prompt.md as a SYMLINK to an outside sentinel file; the call must never write through it', async () => {
  const project = 'symlinkpromptleafproj-seam';
  const onboardingDir = mkdtempSync(join(tmpdir(), 'onboarding-seam-prompt-parent-'));
  const sessionId = 'r4-17-seam-prompt-fixed-2026-08-06T00-00-00';
  const sessionDir = join(onboardingDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const sentinelDir = mkdtempSync(join(tmpdir(), 'onboarding-prompt-sentinel-'));
  const sentinelPath = join(sentinelDir, 'outside-prompt.md');
  const sentinelContent = 'SENTINEL-PROMPT-UNTOUCHED-a82e4d';
  writeFileSync(sentinelPath, sentinelContent, 'utf8');
  symlinkSync(sentinelPath, join(sessionDir, 'prompt.md'));
  try {
    try {
      writeOnboardingSession(onboardingDir, sessionId, project, '_agent-onboarding-seam-prompt-test', { northStar: 'symlinked prompt.md probe' });
    } catch { /* expected — refusal is asserted on the filesystem below, not on the throw itself */ }
    assert.equal(
      readFileSync(sentinelPath, 'utf8'), sentinelContent,
      `the outside sentinel target of a planted prompt.md symlink must be byte-unchanged for the KNOWN session id ${sessionId} — a write-through here means writeOnboardingSession reused a pre-existing session dir and/or wrote through a pre-existing symlink instead of refusing it`,
    );
  } finally {
    rmSync(onboardingDir, { recursive: true, force: true });
    rmSync(sentinelDir, { recursive: true, force: true });
  }
});

test('R4-17 AT-15 (BLOCKER, pin 5 item 1 / pin 6 re-point, REJECT — seam-level, explicit sessionId, pins exclusive session-dir CREATION independently of any symlink): writeOnboardingSession is called DIRECTLY against a KNOWN session id whose directory already exists as a real, EMPTY directory (no symlinks, no files at all); the call must refuse rather than silently reuse and populate it', async () => {
  const onboardingDir = mkdtempSync(join(tmpdir(), 'onboarding-seam-emptydir-parent-'));
  const sessionId = 'r4-17-seam-emptydir-fixed-2026-08-06T00-00-00';
  const sessionDir = join(onboardingDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  try {
    try {
      writeOnboardingSession(onboardingDir, sessionId, 'preexistingemptydirproj-seam', '_agent-onboarding-seam-emptydir-test', { northStar: 'pre-existing empty dir probe' });
    } catch { /* expected — refusal is asserted on the filesystem below, not on the throw itself */ }
    assert.deepEqual(
      readdirSync(sessionDir), [],
      `pre-existing session dir ${sessionDir} must stay EMPTY (refused, not silently reused/populated) — this is the load-bearing assertion, never a thrown-or-not check alone: a call relying only on an exclusive WRITE flag but not an exclusive directory CREATE would happily populate this pre-staked empty directory and return normally`,
    );
  } finally {
    rmSync(onboardingDir, { recursive: true, force: true });
  }
});

test('R4-17 AT-18 (pin 6 — seam-level ACCEPT control, the counterpart to AT-13/14/15\'s REJECT pins): writeOnboardingSession called DIRECTLY with a fresh, never-before-planted session id under a real "_onboarding" parent succeeds, and writes BOTH status.json and prompt.md at the correct location with the correct shape — proving the three closes are real containment/exclusivity, not a blanket refusal that would break every legitimate onboarding start', async () => {
  const onboardingDir = mkdtempSync(join(tmpdir(), 'onboarding-seam-accept-parent-'));
  const sessionId = 'r4-17-seam-accept-fixed-2026-08-06T00-00-00';
  const runId = '_agent-onboarding-seam-accept-test';
  try {
    const { sessionDir } = writeOnboardingSession(onboardingDir, sessionId, 'acceptcontrolproj-seam', runId, { northStar: 'seam accept control probe 6f2a' });
    assert.equal(sessionDir, join(onboardingDir, sessionId), 'the returned sessionDir must be exactly onboardingParent/sessionId');
    const status = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as {
      phase: string; project: string; runId: string; startedAt: string;
    };
    assert.equal(status.phase, 'running');
    assert.equal(status.project, 'acceptcontrolproj-seam');
    assert.equal(status.runId, runId);
    assert.ok(typeof status.startedAt === 'string' && status.startedAt.length > 0);
    const prompt = readFileSync(join(sessionDir, 'prompt.md'), 'utf8');
    assert.ok(
      prompt.includes('seam accept control probe 6f2a'),
      `prompt.md must render the operator inputs verbatim, got: ${JSON.stringify(prompt)}`,
    );
  } finally {
    rmSync(onboardingDir, { recursive: true, force: true });
  }
});