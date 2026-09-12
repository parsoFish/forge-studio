/**
 * A session id that reaches a filesystem path segment is VALIDATED at the
 * boundary — `forge-8vfn.7.6.47`, D's ruling 776, raised to P1 by T1.
 *
 * THE OBSERVED DEFECT. SK-6 and HK-5 read a sid from a URL that publish-and-stay
 * had stopped filling, got `null`, and a route wrote
 * `projects/mdtoc/_authoring/null/status.json` — a directory literally named
 * `null`. Treated here as a PATH-SEGMENT boundary defect rather than a null-id
 * nit: request input is interpolated into a filesystem path with no shape check,
 * and `null` is the benign symptom of that, not the bug.
 *
 * WHY CONTAINMENT IS NOT ENOUGH, which is the whole point of this file.
 * `guardedSessionDir`/`guardedFile` answer "does this path stay inside the
 * root", and `null`, `''` and `.` all pass that honestly — they traverse
 * nowhere. So every containment guard in the tree can be working perfectly
 * while a route still creates a junk session directory that no surface can see
 * and no operator can remove through the product. Containment and shape are
 * different properties and only one of them was being asserted.
 *
 * THE DOOR ASSERTS BOTH HALVES. A 4xx alone is satisfied by a route that
 * mkdirs, fails later, and reports the failure honestly — the directory is
 * still there. So every case checks the status AND that no new directory was
 * created, which is the assertion D asked for in 776 and the reason a
 * status-only door would have passed on the defective code.
 *
 * SWEEP, not a spot fix (§7.6.47's sibling clause): every route that takes a
 * session id from request input into a path is exercised, and the answer is
 * reported even where it is "this one was already correct".
 *
 * WHAT THIS DOOR ACTUALLY PINS, measured rather than assumed, because most of
 * it pins less than it appears to. Thirty of the cases below are refused by
 * mere ABSENCE — the session does not exist, so the route 404s whatever the id
 * looks like, and they would stay green with every guard removed. They are
 * regression value, not evidence.
 *
 * The assertion is the ENCODED-TRAVERSAL case, and it earns that by mutation:
 *
 *   isSafeRunId removed .................... 32/32 still pass
 *   resolveGuardedPath neutered ............ 32/32 still pass
 *   BOTH removed ........................... 32/32 still pass
 *   all THREE (incl. the guarded status read) → the traversal case REDS, and
 *     reds correctly: the request reached the victim session in ANOTHER
 *     project and the 409 quoted its real phase and kind back.
 *
 * So this route is three-deep, no single-guard mutation is observable, and a
 * future editor deleting ONE guard as redundant will not be caught here. That
 * is a fact about the route, not a defect in the door, and it is written down
 * so the next reader does not have to re-derive it — but it does mean this file
 * must not be cited as cover for a single-guard change.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const PROJECT = 'demoproj';
const VICTIM_PROJECT = 'victimproj';
/** A real, well-formed session in PROJECT — the POSITIVE CONTROL. Without one,
 *  every request 404s on absence and a door asserting "refused" proves nothing
 *  about WHY: measured here by removing both the shape guard and the
 *  containment guard and watching all 30 cases stay green (§15.446 — a control
 *  drawn from your own setup tests the setup). */
const GOOD_SID = '2026-09-12T04-00-00-aaaabbbb';
/** A real session in ANOTHER project that a traversing id resolves onto. This
 *  is the one case the guard alone prevents. */
const VICTIM_SID = '2026-09-12T04-00-00-ccccdddd';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-sid-segment-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', PROJECT), { recursive: true });
  // THE REAL REGISTRY, copied rather than hand-authored. Without it
  // `loadSessionKinds` throws ENOENT and the affordance route answers 500 at
  // step 1 — before the sessionId guard this file exists to test — so every
  // case reds for a reason that has nothing to do with the id. The first draft
  // of this door did exactly that and read as four product defects; a
  // WELL-FORMED id 500s identically, which is the tell. Copying the shipped
  // file also keeps the door honest if the registry changes (§15.13: a verdict
  // about a tree is void unless it measured that tree).
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  copyFileSync(
    join(import.meta.dirname, '..', '..', '..', '..', 'studio', 'session-kinds.yaml'),
    join(forgeRoot, 'studio', 'session-kinds.yaml'),
  );
  seedAuthoringSession(PROJECT, GOOD_SID);
  seedAuthoringSession(VICTIM_PROJECT, VICTIM_SID);
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

/** Every directory now under the project, at any session-kind depth. The door
 *  compares this before and after: a route may 4xx and still have mkdir'd. */
/** A real authoring session at `awaiting-review` — the phase whose row in
 *  `studio/session-kinds.yaml` awaits a `verdict`. `reject` is used throughout
 *  because the authored row marks `requires: [id]` on approve only, so reject
 *  reaches the handler on body shape alone. */
function seedAuthoringSession(project: string, sid: string): void {
  const dir = join(forgeRoot, 'projects', project, '_authoring', sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sid, project, phase: 'awaiting-review', kind: 'authoring',
  }, null, 2));
}

function victimStatusBytes(): string {
  return readFileSync(join(forgeRoot, 'projects', VICTIM_PROJECT, '_authoring', VICTIM_SID, 'status.json'), 'utf8');
}

function sessionDirsUnderProject(): string[] {
  const root = join(forgeRoot, 'projects', PROJECT);
  const out: string[] = [];
  let kinds: string[] = [];
  try { kinds = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return out; }
  for (const k of kinds) {
    out.push(k);
    try {
      for (const s of readdirSync(join(root, k), { withFileTypes: true })) {
        if (s.isDirectory()) out.push(`${k}/${s.name}`);
      }
    } catch { /* a file where a dir was expected is not this door's business */ }
  }
  return out.sort();
}

/** The values that reach a path segment and are NOT traversal — the case
 *  containment cannot catch. `'null'` is the one actually observed on disk;
 *  the JSON `null` is what the client sent to produce it. */
const BOGUS: readonly { label: string; sid: unknown }[] = [
  { label: 'the string "null" (observed on disk)', sid: 'null' },
  { label: 'a JSON null', sid: null },
  { label: 'an empty string', sid: '' },
  { label: 'the string "undefined"', sid: 'undefined' },
  { label: 'a single dot', sid: '.' },
  { label: 'traversal (containment SHOULD catch this one)', sid: '../escapee' },
];

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${url}${path}`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
}

/** Asserts the pair: refused, and nothing created. */
async function refusesAndCreatesNothing(label: string, send: () => Promise<Response>): Promise<void> {
  const before = sessionDirsUnderProject();
  const res = await send();
  const after = sessionDirsUnderProject();
  // THE DIRECTORY HALF FIRST, deliberately. Asserting the status first hides
  // the more serious property: a run that 500s AND mkdirs reports only the
  // status, and the residue — the thing an operator cannot clear through the
  // product — never gets named. Both are asserted; this one is asserted first
  // so it is the one you see.
  const created = after.filter((d) => !before.includes(d));
  assert.deepEqual(created, [],
    `${label}: status ${res.status} and it CREATED ${JSON.stringify(created)} — a refusal that leaves a directory behind is not a refusal`);
  assert.ok(res.status >= 400 && res.status < 500,
    `${label}: expected a 4xx refusal, got ${res.status} (a 500 is a throw, not a boundary refusal — fail fast, CLAUDE.md)`);
}

describe('7.6.47 — a session id that becomes a path segment is validated at the boundary', () => {
  // THE POSITIVE CONTROL. Everything below asserts a REFUSAL, and a refusal is
  // only evidence if the same request shape can succeed. This proves the route
  // reaches past the registry, the project check, existence and the status read
  // — so a 404 on a bogus id below is attributable to the id and nothing else.
  test('CONTROL: the same request with a well-formed, existing id is NOT refused as not-found', async () => {
    const res = await post(`/api/studio/sessions/authoring/${encodeURIComponent(GOOD_SID)}/verdict`,
      { project: PROJECT, verdict: 'reject' });
    assert.notEqual(res.status, 404,
      `the control must reach the handler, else every refusal below is vacuous (got 404: ${await res.text()})`);
  });

  // THE CASE THE GUARD ALONE PREVENTS. A traversing id, URL-ENCODED so it
  // survives the route's `([^/]+)` match as ONE segment and is only turned back
  // into `../` by `decodeSegment`, resolves onto a REAL session in another
  // project. Every other bogus id below is refused by mere absence — this one
  // would hit something that exists, so it is the only case that distinguishes
  // "the guard worked" from "nothing was there anyway".
  test('an ENCODED traversing id that resolves onto a real session in another project is refused, and that session is untouched', async () => {
    const before = victimStatusBytes();
    const traversing = `../../${VICTIM_PROJECT}/_authoring/${VICTIM_SID}`;
    const res = await post(`/api/studio/sessions/authoring/${encodeURIComponent(traversing)}/verdict`,
      { project: PROJECT, verdict: 'reject' });
    assert.equal(res.status, 404, `a traversing id must be refused, got ${res.status}: ${await res.text()}`);
    assert.equal(victimStatusBytes(), before,
      'the victim session in another project must be byte-unchanged — a refusal that still acted is not a refusal');
  });

  for (const { label, sid } of BOGUS) {
    test(`generic affordance route refuses ${label}`, async () => {
      await refusesAndCreatesNothing(`sessions/authoring/${String(sid)}/verdict`, () =>
        post(`/api/studio/sessions/authoring/${encodeURIComponent(String(sid))}/verdict`,
          { project: PROJECT, verdict: 'approve' }));
    });

    test(`POST /api/architect/answer refuses ${label}`, async () => {
      await refusesAndCreatesNothing(`architect/answer sid=${String(sid)}`, () =>
        post('/api/architect/answer', { project: PROJECT, sessionId: sid, answers: [] }));
    });

    test(`POST /api/instructions/brief refuses ${label}`, async () => {
      await refusesAndCreatesNothing(`instructions/brief sid=${String(sid)}`, () =>
        post('/api/instructions/brief', { project: PROJECT, sessionId: sid, brief: 'x' }));
    });

    test(`POST /api/demo-builder/brief refuses ${label}`, async () => {
      await refusesAndCreatesNothing(`demo-builder/brief sid=${String(sid)}`, () =>
        post('/api/demo-builder/brief', { project: PROJECT, sessionId: sid, brief: 'x' }));
    });

    test(`POST /api/project-brain/brief refuses ${label}`, async () => {
      await refusesAndCreatesNothing(`project-brain/brief sid=${String(sid)}`, () =>
        post('/api/project-brain/brief', { project: PROJECT, sessionId: sid, brief: 'x' }));
    });
  }
});
