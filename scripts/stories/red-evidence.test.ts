/**
 * On a RED run the trailing sweep must not remove the ground before anything
 * has read it.
 *
 * Bead `forge-8vfn.6.11.42` (P1, T1 ruling 356b). S2 run 8 went red at beat 12
 * because the architect logged `interview round 2 — 2 question(s) for the
 * operator` at 21:12:30 and the page did not present `question-freetext` for
 * 7 m 40 s. Whether the questions were WRITTEN late or RENDERED late is the
 * whole question — and it could not be answered, because the trailing sweep
 * removed `projects/story-s2` before anything read
 * `_architect/<sid>/questions.json`. The sweep was working exactly as designed;
 * nothing had asked it to wait.
 *
 * **The mtimes are the load-bearing datum**, not the contents: "written at
 * 21:12:30 and rendered at 21:20:10" and "written at 21:20:10" hold identical
 * JSON and are different defects. So they are recorded explicitly in a manifest
 * rather than left to whatever a copy happens to preserve.
 *
 * A GREEN run still sweeps clean — that behaviour is pinned here too, because a
 * capture that fired on every run would quietly turn the sweep off.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { captureBeatDom, captureRedEvidence, redEvidenceDir } from './red-evidence.mjs';

/** One run's stamp — `6.11.50`: every capture of a run shares exactly one. */
const STAMP = '2026-09-07T04-00-11-553Z';

/** A ground mid-interview: two session kinds, the architect one carrying questions. */
function ground(): { root: string; project: string; sessionDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'red-evidence-'));
  // The name the SWEEP would remove for story `S2` — `storyFixtureNames`'
  // `story-<id>`. The capture is keyed off the sweep's own list, so a fixture
  // that invented its own name would prove nothing about the real thing.
  const project = 'story-S2';
  const sessionDir = join(root, 'projects', project, '_architect', '2026-09-06T21-10-48-ec4ede4c');
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, 'questions.json'), JSON.stringify([{ id: 'q1', text: 'which gate?' }]));
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify({ phase: 'awaiting-answers', round: 2 }));
  writeFileSync(join(sessionDir, 'answers.json'), JSON.stringify([{ id: 'q1', text: 'npm test' }]));
  // The exact fact that separates "written late" from "rendered late".
  const written = new Date('2026-09-06T21:12:30.845Z');
  for (const f of ['questions.json', 'status.json', 'answers.json']) utimesSync(join(sessionDir, f), written, written);
  mkdirSync(join(root, 'projects', project, '_demo', 'sid2'), { recursive: true });
  writeFileSync(join(root, 'projects', project, '_demo', 'sid2', 'status.json'), JSON.stringify({ phase: 'locked' }));
  return { root, project, sessionDir };
}

test('6.11.42: a RED run captures the session dir BEFORE anything sweeps it', () => {
  const { root, project } = ground();
  const out = captureRedEvidence({ root, storyId: 'S2', red: true, runStamp: STAMP });

  assert.notEqual(out, null, 'a red run must capture');
  const captured = join(redEvidenceDir(root, 'S2', STAMP), 'story-S2', '_architect', '2026-09-06T21-10-48-ec4ede4c', 'questions.json');
  assert.ok(existsSync(captured), `questions.json must survive the sweep at ${captured}`);
  assert.deepEqual(JSON.parse(readFileSync(captured, 'utf8')), [{ id: 'q1', text: 'which gate?' }]);
});

test('6.11.42: the MTIMES are recorded explicitly — "written late" and "rendered late" hold identical JSON', () => {
  const { root, project } = ground();
  captureRedEvidence({ root, storyId: 'S2', red: true, runStamp: STAMP });

  const manifest = readFileSync(join(redEvidenceDir(root, 'S2', STAMP), 'MTIMES.txt'), 'utf8');
  assert.match(manifest, /_architect\/2026-09-06T21-10-48-ec4ede4c\/questions\.json/);
  assert.match(
    manifest,
    /2026-09-06T21:12:30\.845Z/,
    `the manifest must carry the real mtime, not the copy's — got:\n${manifest}`,
  );
});

test('6.11.42: EVERY session kind under the ground is captured, not just the architect', () => {
  const { root, project } = ground();
  captureRedEvidence({ root, storyId: 'S2', red: true, runStamp: STAMP });
  assert.ok(
    existsSync(join(redEvidenceDir(root, 'S2', STAMP), 'story-S2', '_demo', 'sid2', 'status.json')),
    'the demo session is evidence too — a red beat is not always the architect\'s',
  );
});

test('6.11.42 POSITIVE CONTROL: a GREEN run captures nothing, so the sweep is not quietly turned off', () => {
  const { root, project } = ground();
  const out = captureRedEvidence({ root, storyId: 'S2', red: false, runStamp: STAMP });

  assert.equal(out, null, 'a green run must capture nothing');
  assert.ok(!existsSync(redEvidenceDir(root, 'S2', STAMP)), 'and leave no directory behind');
});

test('6.11.42: a story with no ground, or a ground already gone, is not an error — a red run still reports', () => {
  const root = mkdtempSync(join(tmpdir(), 'red-evidence-none-'));
  assert.equal(captureRedEvidence({ root, storyId: 'smoke', red: true, runStamp: STAMP }), null, 'a story that leaves no ground captures nothing');
  assert.doesNotThrow(() => captureRedEvidence({ root, storyId: 'S2', red: true, runStamp: STAMP }));
});

test('6.11.42: the capture lands OUTSIDE the ground the sweep removes', () => {
  const { root, project } = ground();
  captureRedEvidence({ root, storyId: 'S2', red: true, runStamp: STAMP });
  const dir = redEvidenceDir(root, 'S2', STAMP);
  assert.ok(
    !dir.startsWith(join(root, 'projects')),
    `capturing INTO the directory about to be removed would preserve nothing — got ${dir}`,
  );
  assert.ok(statSync(dir).isDirectory());
});

test('6.11.42: the DOM at the red is captured beside the session files — the ground says what the PRODUCT had, the DOM says what the OPERATOR could see', async () => {
  const root = mkdtempSync(join(tmpdir(), 'red-evidence-dom-'));
  const page = { content: async () => '<main data-page="session" data-session-phase="awaiting-answers"></main>' };
  const p = await captureBeatDom(page as never, root, 'S2', 11, 'Open the session again and answer', STAMP);

  assert.notEqual(p, null);
  const html = readFileSync(p!, 'utf8');
  assert.match(html, /red beat 12/, 'named by the beat number the operator sees, not the index');
  assert.match(html, /data-session-phase="awaiting-answers"/, 'the phase the screen was showing at the red');
});

test('6.11.42: a page that has already gone does not turn a recorded red into a crash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'red-evidence-gone-'));
  const dead = { content: async () => { throw new Error('Target page, context or browser has been closed'); } };
  assert.equal(await captureBeatDom(dead as never, root, 'S2', 0, 'a beat', STAMP), null);
});

test('6.11.42: the capture is keyed off the SWEEP\'s own target list, not a separately-derived ground name', () => {
  // `proof` declares its ground as `mdtoc`, which the sweep never touches; what
  // it actually removes is `projects/story-proof`. A capture keyed on the
  // DECLARED ground would read a directory that was never at risk and preserve
  // nothing of the one that was — measured on the green-path proof run.
  const root = mkdtempSync(join(tmpdir(), 'red-evidence-sweeptruth-'));
  const declaredButSafe = join(root, 'projects', 'mdtoc', '_architect', 'sid');
  const actuallySwept = join(root, 'projects', 'story-proof', '_architect', 'sid');
  mkdirSync(declaredButSafe, { recursive: true });
  mkdirSync(actuallySwept, { recursive: true });
  writeFileSync(join(declaredButSafe, 'status.json'), '{"phase":"never-at-risk"}');
  writeFileSync(join(actuallySwept, 'status.json'), '{"phase":"about-to-be-removed"}');

  captureRedEvidence({ root, storyId: 'proof', red: true, runStamp: STAMP });

  const dir = redEvidenceDir(root, 'proof', STAMP);
  assert.ok(
    existsSync(join(dir, 'story-proof', '_architect', 'sid', 'status.json')),
    'the ground the sweep removes must be the one that is read',
  );
  assert.ok(
    !existsSync(join(dir, 'mdtoc')),
    'and a ground the sweep never touches must not be copied — it was never at risk',
  );
});

// ── 6.11.48 (harness half): THE URL AT THE RED, because a mode lives in it
//
// S1 run 10 beat 11 failed on ONE key — `data-plan-mode: expected "gate", got
// "view"` — after opening AND approving the plan (the architect committed at
// 03:46:22). `plan-mode` is the artifact page's URL-resolved mode, and
// `open-plan`'s href is chosen from the session's phase at press time
// (`architectPlanArtifactHref(id, phase === 'awaiting-verdict' ? 'gate' :
// 'view')`). `PLAN.md` was written at 03:46:13 and the press landed at
// 03:46:15 — two seconds, against two independent 3000 ms polls.
//
// So the question is whether the story arrived at `?mode=view`, and NOTHING
// recorded the URL: the DOM alone cannot answer it, because the mode is not in
// the markup, it is in the address. T1 ruling 366 asks for the datum rather
// than another round of inference.

test('6.11.48: the capture records the URL the page was on, because a mode lives in the address and not in the markup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'red-evidence-url-'));
  const page = {
    url: () => 'http://localhost:4124/artifact?session=arch-1&kind=architect&mode=view',
    content: async () => '<main data-page="artifact" data-plan-mode="view"></main>',
  };
  const p = await captureBeatDom(page as never, root, 'S1', 10, 'Open the session, read the plan and press Approve', STAMP);

  assert.notEqual(p, null);
  const html = readFileSync(p!, 'utf8');
  assert.match(html, /mode=view/, 'the mode the beat disagreed about is in the URL, so the URL must be recorded');
  assert.match(html, /red beat 11/);
});

test('6.11.48: a page that cannot say where it is still yields a capture — the URL is evidence, never a requirement', async () => {
  // `captureBeatDom` runs inside a red that has already happened. A fake, a
  // closed context or an older page object with no `url()` must not turn
  // recorded evidence into no evidence at all.
  const root = mkdtempSync(join(tmpdir(), 'red-evidence-nourl-'));
  const page = { content: async () => '<main data-page="session"></main>' };
  const p = await captureBeatDom(page as never, root, 'S1', 10, 'a beat', STAMP);

  assert.notEqual(p, null, 'the DOM is still captured when the URL cannot be read');
  assert.match(readFileSync(p!, 'utf8'), /data-page="session"/);
});

test('6.11.50: two runs of one story do not write into the same directory', () => {
  // S2 run 10's capture sat beside run 9's, with only MTIMES.txt rewritten, so
  // a reader could take the previous run's ground for this one's — the two were
  // distinguishable only by reading a session id out of the JSON. Evidence that
  // quietly mixes two runs is worse than no evidence: it reads as one run.
  const root = mkdtempSync(join(tmpdir(), 'red-evidence-perrun-'));
  const nine = redEvidenceDir(root, 'S2', '2026-09-06T22-58-43-000Z');
  const ten = redEvidenceDir(root, 'S2', '2026-09-07T03-59-58-000Z');

  assert.notEqual(nine, ten, 'each run owns its own directory');
  assert.ok(ten.includes('S2'), 'still filed under the story');
});
