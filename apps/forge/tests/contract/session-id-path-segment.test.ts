/**
 * A session id that reaches a filesystem path segment is VALIDATED at the
 * boundary — `forge-8vfn.7.6.47`, D's ruling 776, raised to P1 by T1.
 *
 * THE OBSERVED DEFECT. SK-6 and HK-5 read a sid from a URL that publish-and-stay
 * had stopped filling, got `null`, and a route wrote
 * `tests/fixtures/live-capture/r4-19-f2-live-capture/status.json` — a directory literally named
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
 * ROW 206 (forge-8vfn.8.5.56). The generic affordance route —
 * `POST /api/studio/sessions/:kind/:sessionId/:affordance`
 * (packages/sessions/bridge-studio-sessions-affordances.ts) — is the ONE
 * write surface for instructions' brief/answer/verdict and demo-builder's
 * brief, so this file pins it for every dispatching kind. One kind alone
 * would not be enough: the route's containment code
 * (`project`/`sessionId` → `resolveGuardedPath`) runs identically whatever
 * `:kind` names, but which per-kind handler a traversal would reach if that
 * containment ever failed differs by kind — `handleInstructionsBrief` writes
 * `prompt.md`, `handleDemoVerdict` writes a generation record, `
 * handleKbCleanupVerdict` drains a KB, `handleAuthoringVerdict` copies a
 * staging dir into the library — so `DISPATCH_TUPLES` below runs the SAME
 * three cases (positive control, real-victim sessionId traversal, bogus-id
 * sweep) for every `(kind, affordance)` pair the route actually dispatches to
 * a handler, read off `studio/session-kinds.yaml` crossed with the route's
 * own dispatch chain — not just the one kind a prior pass happened to reach
 * for. `architect` and `project-brain` carry neither a `panel` nor a
 * `turnSpec` in that registry, so `deriveSessionAffordances` always yields
 * `[]` for them and this route can never dispatch to either — their own
 * write surfaces (the bespoke `/api/architect/*` and `/api/project-brain/*`
 * routes) are pinned instead by `sec04-architect-containment.test.ts` /
 * `sec04-projectbrain-demo-containment.test.ts`, which is why neither kind
 * appears in the table below.
 *
 * WHAT THIS DOOR ACTUALLY PINS, measured rather than assumed, because most of
 * it pins less than it appears to. Every BOGUS-shape case below (`'null'`,
 * JSON `null`, an empty string, `'undefined'`, a single dot) is refused by
 * mere ABSENCE — no session exists at that id, so the route 404s whatever the
 * id looks like, and it would stay green with every guard removed. It is
 * regression value, not evidence.
 *
 * The assertion is each REAL-VICTIM traversal case — one sessionId-shaped and
 * one project-shaped per dispatching `(kind, affordance)` / kind below — and
 * each earns that by exercising the SAME three checks
 * `bridge-studio-sessions-affordances.ts` runs before any per-kind handler is
 * reached: the `project` shape gate (`invalidProjectReason`, a single-segment
 * charset rule with no `/` or `.` in its alphabet — EXACT_ID_RE), `isSafeRunId`
 * on the sessionId (charset + no `..`), and `resolveGuardedPath`'s per-segment
 * identity walk over `['_sessions', project, "_"+kind, sessionId]` under the logs root. The project-traversal
 * case is caught by the FIRST of those, ahead of the other two; the
 * sessionId-traversal case reaches the second and third. Removing any one
 * check still leaves the others standing between the request and the real
 * victim session planted in another project / outside the containment root —
 * this file does not re-derive which specific checks are redundant with which
 * (that would need mutating `packages/kernel/path-guard.ts` and
 * `packages/agents/run-agent.ts`, out of scope for a test-only pass), only
 * that a traversal attempt is refused AND the victim's `status.json` is
 * byte-for-byte unchanged. That is written down so the next reader does not
 * have to re-derive it — but it does mean this file must not be cited as
 * cover for a single-guard change to either checked-in module.
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const PROJECT = 'demoproj';
const VICTIM_PROJECT = 'victimproj';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;
const outsideDirs: string[] = [];

/**
 * Every `(kind, phase, affordanceId)` tuple the generic affordance route
 * actually DISPATCHES to a per-kind write handler, read off
 * `studio/session-kinds.yaml`'s `panel`/`turnSpec` phase tables (one row per
 * tuple) crossed with the route's own dispatch chain
 * (`packages/sessions/bridge-studio-sessions-affordances.ts`): the
 * question-form if-chain wires `instructions`/`demo`/`onboarding`; the verdict
 * switch wires `instructions`/`demo`/`kb-cleanup`/`authoring`. The
 * `affordance` id is `${phase}-${question-form|verdict}` —
 * `deriveSessionAffordances`'s own id formula
 * (`packages/sessions/studio/session-kinds-affordances.ts`) — hand-copied here
 * (as every sibling affordance test in this tree already does; there is no
 * exported constant for it) rather than imported, so a drift in that formula
 * fails this door loudly instead of silently re-deriving around it.
 */
const DISPATCH_TUPLES = [
  { kind: 'instructions', phase: 'briefing', affordance: 'briefing-question-form' },
  { kind: 'instructions', phase: 'awaiting-answers', affordance: 'awaiting-answers-question-form' },
  { kind: 'instructions', phase: 'awaiting-verdict', affordance: 'awaiting-verdict-verdict' },
  { kind: 'demo', phase: 'briefing', affordance: 'briefing-question-form' },
  { kind: 'demo', phase: 'awaiting-review', affordance: 'awaiting-review-verdict' },
  { kind: 'onboarding', phase: 'briefing', affordance: 'briefing-question-form' },
  { kind: 'kb-cleanup', phase: 'awaiting-approval', affordance: 'awaiting-approval-verdict' },
  { kind: 'authoring', phase: 'awaiting-review', affordance: 'awaiting-review-verdict' },
] as const;

/** One representative dispatching tuple per kind (its first row above) — used
 *  by the project-traversal case and the bogus-sessionId sweep, neither of
 *  which is sensitive to WHICH affordance is named: both are refused ahead of
 *  the affordance lookup (the project shape gate runs first of all; a bogus
 *  sessionId is refused by `isSafeRunId`/`resolveGuardedPath`, step 2, before
 *  step 3 ever reads `:affordance`). */
const KIND_REPS = DISPATCH_TUPLES.filter((t, i) => DISPATCH_TUPLES.findIndex((u) => u.kind === t.kind) === i);

function goodSid(kind: string, phase: string): string {
  return `good-${kind}-${phase}`;
}

function victimSid(kind: string): string {
  return `victim-${kind}`;
}

/** Where a session of `kind` lives: `<root>/_logs/_sessions/<project>/_<kind>/<sid>`
 *  (under the logs root, never in the project checkout). */
function sessionDirOf(root: string, project: string, kind: string, sid: string): string {
  return join(root, '_logs', '_sessions', project, `_${kind}`, sid);
}

/** Seeds `<root>/_logs/_sessions/<project>/_<kind>/<sid>/status.json` — the minimal shape
 *  every route reads: `session_id`, `project`, `phase`, `kind`. Generalizes
 *  the old authoring-only `seedAuthoringSession` across every registered kind
 *  (the directory is `_${kind}`, never special-cased). */
function seedSession(root: string, project: string, kind: string, sid: string, phase: string): void {
  mkdirSync(join(root, 'projects', project), { recursive: true });
  const dir = sessionDirOf(root, project, kind, sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sid, project, phase, kind,
  }, null, 2));
}

function sessionStatusBytes(root: string, project: string, kind: string, sid: string): string {
  return readFileSync(join(sessionDirOf(root, project, kind, sid), 'status.json'), 'utf8');
}

function newOutsideDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  outsideDirs.push(d);
  return d;
}

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
  // A real, well-formed session per dispatching tuple in PROJECT — the
  // POSITIVE CONTROLs. Without one, every request 404s on absence and a door
  // asserting "refused" proves nothing about WHY.
  for (const { kind, phase } of DISPATCH_TUPLES) {
    seedSession(forgeRoot, PROJECT, kind, goodSid(kind, phase), phase);
  }
  // A real session per kind in ANOTHER project — the victim a traversing
  // sessionId resolves onto. One per kind (not per tuple): the victim's own
  // phase is irrelevant to the "stays byte-unchanged" assertion.
  for (const { kind, phase } of KIND_REPS) {
    seedSession(forgeRoot, VICTIM_PROJECT, kind, victimSid(kind), phase);
  }
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  for (const d of outsideDirs) rmSync(d, { recursive: true, force: true });
});

/** Every directory now under the project's session home (`_logs/_sessions/<p>`)
 *  AND under the project checkout itself (the ground), at any session-kind
 *  depth. The door compares this before and after: a route may 4xx and still
 *  have mkdir'd — and no session dir may ever appear in the ground. */
function sessionDirsUnderProject(): string[] {
  const out: string[] = [];
  for (const [tag, root] of [
    ['sessions', join(forgeRoot, '_logs', '_sessions', PROJECT)],
    ['ground', join(forgeRoot, 'projects', PROJECT)],
  ] as const) {
    let kinds: string[] = [];
    try { kinds = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const k of kinds) {
      out.push(`${tag}:${k}`);
      try {
        for (const s of readdirSync(join(root, k), { withFileTypes: true })) {
          if (s.isDirectory()) out.push(`${tag}:${k}/${s.name}`);
        }
      } catch { /* a file where a dir was expected is not this door's business */ }
    }
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

function is4xx(status: number): boolean {
  return status >= 400 && status < 500;
}

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
  for (const { kind, phase, affordance } of DISPATCH_TUPLES) {
    // THE POSITIVE CONTROL, per dispatching (kind, affordance). Everything
    // below asserts a REFUSAL, and a refusal is only evidence if the SAME
    // request shape can succeed. This proves the route reaches past the
    // registry, the project check, existence, the status read AND the
    // affordance-derivation match for THIS kind/phase — so a 404 below is
    // attributable to the id and nothing else.
    test(`CONTROL (${kind}/${phase}): the same request with a well-formed, existing id is NOT refused as not-found`, async () => {
      const res = await post(`/api/studio/sessions/${kind}/${encodeURIComponent(goodSid(kind, phase))}/${affordance}`,
        { project: PROJECT });
      assert.notEqual(res.status, 404,
        `the control must reach the handler, else every refusal below is vacuous (got 404: ${await res.text()})`);
    });

    // THE CASE THE GUARD ALONE PREVENTS. A traversing id, URL-ENCODED so it
    // survives the route's `([^/]+)` match as ONE segment and is only turned
    // back into `../` by `decodeSegment`, resolves onto a REAL session of the
    // SAME kind in another project. Every BOGUS case below is refused by mere
    // absence — this one would hit something that exists, so it is the one
    // that distinguishes "the guard worked" from "nothing was there anyway".
    test(`sessionId traversal (${kind}/${affordance}): an ENCODED traversing id that resolves onto a real session in another project is refused, and that session is untouched`, async () => {
      const before = sessionStatusBytes(forgeRoot, VICTIM_PROJECT, kind, victimSid(kind));
      const traversing = `../../${VICTIM_PROJECT}/_${kind}/${victimSid(kind)}`;
      const res = await post(`/api/studio/sessions/${kind}/${encodeURIComponent(traversing)}/${affordance}`,
        { project: PROJECT });
      assert.equal(res.status, 404, `a traversing id must be refused, got ${res.status}: ${await res.text()}`);
      assert.equal(sessionStatusBytes(forgeRoot, VICTIM_PROJECT, kind, victimSid(kind)), before,
        'the victim session in another project must be byte-unchanged — a refusal that still acted is not a refusal');
    });
  }

  for (const { kind, affordance } of KIND_REPS) {
    // PROJECT traversal — the shape the sessionId cases above do not cover.
    // `project` is a single JSON body field (no URL segment games needed) and
    // is validated by `invalidProjectReason` (EXACT_ID_RE: one path segment,
    // no "/" or "." at all) BEFORE the kind is even looked up — ahead of
    // `resolveGuardedPath` entirely. A real victim is planted OUTSIDE the
    // containment root so this is still a measured claim, not an assumed one:
    // if the shape gate ever loosened, `resolveGuardedPath`'s own per-segment
    // walk would still have to refuse this `project` value for the victim to
    // stay untouched.
    test(`project traversal (${kind}/${affordance}): a "../" project is refused, and the real victim outside the root is untouched`, async () => {
      const outside = newOutsideDir(`sec04-sid-segment-project-outside-${kind}-`);
      const rel = relative(join(forgeRoot, '_logs', '_sessions'), outside);
      assert.equal(rel.split(sep)[0], '..', 'sanity: the traversal string must genuinely step outside <logsRoot>/_sessions');
      const sid = victimSid(kind);
      const dir = join(outside, `_${kind}`, sid);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'status.json'), JSON.stringify({ session_id: sid, project: 'irrelevant', phase: 'briefing', kind }, null, 2));
      const before = readFileSync(join(dir, 'status.json'), 'utf8');

      const res = await post(`/api/studio/sessions/${kind}/${encodeURIComponent(sid)}/${affordance}`, { project: rel });

      assert.ok(is4xx(res.status), `a traversal project must be rejected 4xx — got ${res.status}: ${await res.text()}`);
      assert.equal(readFileSync(join(dir, 'status.json'), 'utf8'), before,
        'the victim outside the containment root must be byte-unchanged — a refusal that still acted is not a refusal');
    });
  }

  for (const { label, sid } of BOGUS) {
    // The generic affordance route, swept across EVERY kind whose panel/
    // turnSpec actually derives a write affordance (KIND_REPS) — not just
    // `authoring`. The bogus-shape sweep is affordance-agnostic (refused at
    // step 2, `isSafeRunId`/`resolveGuardedPath`, before `:affordance` is
    // ever read at step 3), so one representative affordance per kind is
    // enough to prove the sweep holds for that kind's write surface.
    for (const { kind, affordance } of KIND_REPS) {
      test(`generic affordance route (${kind}) refuses ${label}`, async () => {
        await refusesAndCreatesNothing(`sessions/${kind}/${String(sid)}/${affordance}`, () =>
          post(`/api/studio/sessions/${kind}/${encodeURIComponent(String(sid))}/${affordance}`,
            { project: PROJECT, verdict: 'approve' }));
      });
    }

    test(`POST /api/architect/answer refuses ${label}`, async () => {
      await refusesAndCreatesNothing(`architect/answer sid=${String(sid)}`, () =>
        post('/api/architect/answer', { project: PROJECT, sessionId: sid, answers: [] }));
    });

    // The generic affordance route (row 206, forge-8vfn.8.5.56) is the one
    // write surface for instructions briefing/interview/verdict and for
    // demo-builder's brief — its own bogus-sessionId sweep immediately above
    // now runs for BOTH kinds (and every other registered kind), closing the
    // gap a single `kind='authoring'` loop left open. No forge-ui caller
    // reaches `POST /api/instructions/brief` or `POST /api/demo-builder/brief`.

    test(`POST /api/demo-builder/lock refuses ${label}`, async () => {
      await refusesAndCreatesNothing(`demo-builder/lock sid=${String(sid)}`, () =>
        post('/api/demo-builder/lock', { project: PROJECT, sessionId: sid }));
    });

    test(`POST /api/project-brain/brief refuses ${label}`, async () => {
      await refusesAndCreatesNothing(`project-brain/brief sid=${String(sid)}`, () =>
        post('/api/project-brain/brief', { project: PROJECT, sessionId: sid, brief: 'x' }));
    });
  }
});
