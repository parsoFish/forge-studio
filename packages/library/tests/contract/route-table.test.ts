/**
 * route-table.test.ts — the contract for `packages/library/routes.ts`.
 *
 * M4 §4 step 2 turns SEVEN monolithic prefix dispatchers, which
 * `apps/forge/ui-bridge.ts` called in sequence (`:2365` skills, `:2366` hooks,
 * `:2367` authoring, `:2368` templates, `:2417` instructions, `:2422`
 * connections, `:2423` community), into ONE declarative table that
 * `apps/forge/routes.ts` assembles and the host dispatches at `:2094`,
 * before its own switch.
 *
 * THIRTY-ONE of the table's 34 routes came from that carve. The other
 * three — the community-registry item's POST/PUT/DELETE arms
 * (`bridge-studio-community-crud.ts`) — are an M4 §4 step 2 RESIDUE carve:
 * they left an EIGHTH legacy dispatcher, `handleStudioWriteRoutes`
 * (`apps/forge/bridge-studio-writes.ts` `:583` `:615` `:654`), that a separate carve
 * (M4-projects) had already been pulling routes out of one at a time.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS — an if-chain rewritten as a
 * table has four ways to go quietly wrong, and every assertion here exists
 * for one of them:
 *
 *  1. A ROUTE IS DROPPED. Thirty-four arms spread over eight files (plus one
 *     genuinely new route, forge-8vfn.5.2 — see below) are only visible by
 *     reading all of them; a lost route 404s where it used to work with
 *     nothing red. `everyRouteIsTabled` pins the exact 35.
 *  2. TWO ENTRIES CONTEND FOR ONE URL. `dispatchRoute` is first-match-wins,
 *     so an overlapping pair dispatches by POSITION — and dispatching the
 *     wrong handler still returns 200, which no status-code assertion catches.
 *     Knowledge's table pins its one real collision by order. LIBRARY HAS
 *     NONE: re-checked entry-by-entry, no two of these 34 share a method and
 *     both claim any one URL (`dispatchRoute` filters on method BEFORE it
 *     calls `matches`, `packages/kernel/route-entry.ts:108`, and every
 *     same-method near-pair is separated by segment count). An ORDER
 *     assertion would therefore pin nothing — it would pass under a swap, the
 *     green-test-over-nothing shape this lane refuses to write. So this file
 *     pins the INVARIANT THAT MAKES ORDER IRRELEVANT instead:
 *     `noTwoEntriesClaimOneUrl`. It holds today, it subsumes the order
 *     question while it holds, and the day someone adds an overlapping entry
 *     it fails and names both rows — which is exactly the case an order
 *     assertion would have accepted in silence.
 *  3. A HANDLER STOPS NORMALISING ITS OWN URL. The if-chains ran after the
 *     host had already called `pathOnly`; an extracted handler receives the
 *     RAW url and must strip the query itself, or it fails its anchored
 *     regex against `…?x=1`, declines, and the request 404s with nothing red
 *     (measured on the knowledge lane's carve). `everyEntryMatchesWithAQuery`
 *     pins it for all 34 at once.
 *  4. A ROUTE LOSES ITS DRY CLASSIFICATION. `cli/dry-bridge.ts` classifies
 *     every mutating route so `FORGE_DRY_BRIDGE=1` can refuse or stub it. A
 *     carved route whose `dryClassification` is dropped becomes a route that
 *     acts for real under a dry bridge.
 *     `everyEntryCarriesADryClassification` pins that.
 *
 * This file is added to `_1.0/gate-manifests/M4-library.txt` while it is RED,
 * never after it goes green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { libraryRoutes } from '../../routes.ts';

/**
 * The 31 routes the seven dispatchers matched at `c323dc04`, in the order
 * their if-chains matched them, grouped in the order `apps/forge/ui-bridge.ts`
 * called the dispatchers, PLUS the 3 residue routes `handleStudioWriteRoutes`
 * (`apps/forge/bridge-studio-writes.ts`) still answered at that same commit.
 * Derived by reading every `url === …` / `url.match(…)` arm in all eight
 * files, not from prose:
 *   bridge-studio-skills.ts       :105 :122 :186 :273 :360 :420 :473
 *   bridge-studio-hooks.ts        :275 :286 :389 :430 :475 :500 :595 :630
 *   bridge-studio-authoring.ts    :471-474
 *   bridge-studio-templates.ts    :175 :300 :301 :306 :317
 *   bridge-studio-instructions.ts :89
 *   bridge-studio-connections.ts  :129 :140 :153 :212
 *   bridge-studio-community.ts    :406 :440 :469 :533 :539
 *   bridge-studio-writes.ts       :583 :615 :654 (residue — see this table's
 *                                  own trailing group, and the file header)
 *
 * PLUS ONE: `POST /api/studio/hooks/:id/decline` (bridge-studio-hooks-
 * decline.ts, forge-8vfn.5.2) — a genuinely NEW route, not carved from an
 * if-chain (bridge-studio-hooks.ts sits at the 800-line hard cap, so the
 * route lives in a sibling file from birth; see that file's own header).
 */
const PINNED: ReadonlyArray<readonly [string, string]> = [
  // ---- bridge-studio-skills.ts (7) ----
  ['GET', '/api/studio/skills'],
  ['POST', '/api/studio/skills'],
  ['POST', '/api/studio/skills/install'],
  ['POST', '/api/studio/skills/:id/approve'],
  ['PUT', '/api/studio/skills/:id'],
  ['DELETE', '/api/studio/skills/:id'],
  ['GET', '/api/studio/skills/:id'],
  // ---- bridge-studio-hooks.ts (8) + bridge-studio-hooks-decline.ts (1) ----
  ['GET', '/api/studio/hooks'],
  ['POST', '/api/studio/hooks'],
  ['POST', '/api/studio/hooks/:id/approve'],
  ['POST', '/api/studio/hooks/:id/override'],
  ['POST', '/api/studio/hooks/:id/revoke-approval'],
  ['POST', '/api/studio/hooks/:id/decline'],
  ['PUT', '/api/studio/hooks/:id'],
  ['DELETE', '/api/studio/hooks/:id'],
  ['GET', '/api/studio/hooks/:id'],
  // ---- bridge-studio-authoring.ts (1) ----
  ['POST', '/api/studio/authoring/finalize'],
  // ---- bridge-studio-templates.ts (5) ----
  ['POST', '/api/studio/templates'],
  ['PUT', '/api/studio/templates/:id'],
  ['DELETE', '/api/studio/templates/:id'],
  ['GET', '/api/studio/templates'],
  ['GET', '/api/studio/templates/:id'],
  // ---- bridge-studio-instructions.ts (1) ----
  ['POST', '/api/studio/agents/:slug/instructions-draft'],
  // ---- bridge-studio-connections.ts (4) ----
  ['GET', '/api/studio/connections'],
  ['POST', '/api/studio/connections/:id/probe'],
  ['POST', '/api/studio/connections/:id/install'],
  ['GET', '/api/studio/connections/:id'],
  // ---- bridge-studio-community.ts (5) ----
  ['GET', '/api/studio/community'],
  ['GET', '/api/studio/community/registry/items/:id'],
  ['POST', '/api/studio/community/refresh'],
  ['POST', '/api/studio/community/:kind/:id/install'],
  ['GET', '/api/studio/community/:kind/:id'],
  // ---- bridge-studio-community-crud.ts (3, RESIDUE — see file header) ----
  ['POST', '/api/studio/community/registry/items'],
  ['PUT', '/api/studio/community/registry/items/:id'],
  ['DELETE', '/api/studio/community/registry/items/:id'],
];

/** A concrete URL for an entry's own `path`. `:param` segments are filled
 *  with a value that is not a literal segment of any other route in the
 *  table, so a match by another entry is a real overlap and never an
 *  artefact of the probe's choice of value. */
function concreteUrl(path: string): string {
  return path.split('/').map((seg) => (seg.startsWith(':') ? 'PARAM' : seg)).join('/');
}

const key = (method: string, path: string): string => `${method} ${path}`;

test('everyRouteIsTabled: the table is exactly the 31 routes the seven if-chains dispatched plus the 3 residue routes', () => {
  const tabled = libraryRoutes.map((e) => key(e.method, e.path));
  const pinned = PINNED.map(([m, p]) => key(m, p));

  const missing = pinned.filter((k) => !tabled.includes(k));
  const extra = tabled.filter((k) => !pinned.includes(k));

  assert.deepEqual(missing, [], `routes that left an if-chain without arriving in the table:\n${missing.join('\n')}`);
  assert.deepEqual(extra, [], `table entries with no if-chain arm behind them:\n${extra.join('\n')}`);
  assert.equal(libraryRoutes.length, PINNED.length, 'the table must carry exactly 35 entries — a duplicate is as wrong as a gap');
});

test('theProbeIsNotVacuous: every entry matches the concrete URL built from its own path', () => {
  // Without this, `noTwoEntriesClaimOneUrl` below could pass because NOTHING
  // matches anything — the vacuous-green shape. This assertion is what makes
  // the disjointness result mean something.
  const blind: string[] = [];
  for (const e of libraryRoutes) {
    if (!e.matches(concreteUrl(e.path))) blind.push(`${key(e.method, e.path)} does not match its own URL ${concreteUrl(e.path)}`);
  }
  assert.deepEqual(blind, [], `entries whose matcher does not claim their own path:\n${blind.join('\n')}`);
});

test('noTwoEntriesClaimOneUrl: no two entries share a method and both claim one URL', () => {
  // THE INVARIANT THAT MAKES ORDER IRRELEVANT. While it holds, first-match-wins
  // has nothing to decide and no order assertion can earn its place; the day it
  // stops holding, this failure names both rows and the author must then write
  // the order pin. `dispatchRoute` filters on method before calling `matches`
  // (packages/kernel/route-entry.ts:108), so a shared URL across DIFFERENT
  // methods is not a collision and is not reported here.
  const overlaps: string[] = [];
  for (const a of libraryRoutes) {
    const url = concreteUrl(a.path);
    for (const b of libraryRoutes) {
      if (a === b) continue;
      if (a.method !== b.method) continue;
      if (b.matches(url)) {
        overlaps.push(
          `${key(a.method, a.path)} and ${key(b.method, b.path)} both claim ${url} — ` +
            'first-match-wins now decides by POSITION and dispatching the wrong one still returns 200. ' +
            'Pin which entry must claim this URL in an order assertion here, and state why the overlap is legitimate.',
        );
      }
    }
  }
  assert.deepEqual(overlaps, [], `overlapping route entries:\n${overlaps.join('\n')}`);
});

test('everyEntryMatchesWithAQuery: a handler receives the RAW url and normalises for itself', () => {
  // `dispatchRoute` passes the raw url through; each `matches` calls `pathOnly`.
  // An entry that dropped that call declines against `…?x=1`, the request 404s,
  // and nothing goes red. Positive control for the whole table at once.
  const unnormalised: string[] = [];
  for (const e of libraryRoutes) {
    if (!e.matches(`${concreteUrl(e.path)}?x=1`)) unnormalised.push(key(e.method, e.path));
  }
  assert.deepEqual(unnormalised, [], `entries that stop matching once a query string is present:\n${unnormalised.join('\n')}`);
});

test('everyEntryCarriesADryClassification and a callable handler', () => {
  const allowed = new Set(['refuse', 'stub-actions', 'exempt-local', 'read-only']);
  for (const e of libraryRoutes) {
    assert.ok(allowed.has(e.dryClassification), `${key(e.method, e.path)} carries an unknown dryClassification ${String(e.dryClassification)}`);
    // Callable WITHOUT booting a server (COMMON §5): the handler is a plain
    // function of the five-argument route signature, not a bridge entry point.
    assert.equal(typeof e.handler, 'function', `${key(e.method, e.path)} has no handler function`);
    assert.equal(e.handler.length, 5, `${key(e.method, e.path)}'s handler must take (req, res, ctx, url, method)`);
  }
});
