/**
 * Acceptance tests for the OOTB-provenance badge (forge-3oq, R6-07 batch-H
 * honesty pass — REWRITE of the R6-03-F3 original for the new contract).
 *
 * THE DEFECT: `ProvenanceBadge` was fed by `provenanceOfFlowOrigin(flow.origin)`
 * — a CLIENT-side inference — and only Flow carried any per-object signal at
 * all. The server is gaining a real per-type `provenance` field (Flow /
 * Agent / Project / Kb all gain it, `lib/studio-client.ts`'s
 * `Provenance = 'ootb' | 'operator' | 'unknown'`); the badge must READ that
 * field, never re-derive it, and `provenanceOfFlowOrigin` is DELETED — the
 * client stops inferring.
 *
 * `'unknown'` is the wire's own value for "the server cannot attest" — never
 * a default guessed on the client. It renders NOTHING (same as
 * 'operator'/null/undefined): a badge is only ever shown from a REAL
 * positive signal.
 *
 * RUN: npx vitest run components/ProvenanceBadge.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvenanceBadge } from '../../components/ProvenanceBadge';
// forge-3oq: NOT exported by studio-client.ts yet at pin time — type-only
// import, erased at runtime (no crash), a real `tsc --noEmit` RED
// ("has no exported member 'Provenance'") until the seam lands.
import type { Provenance } from '../../lib/studio-client';
// Star-import so a "does this export still exist" check reads the MODULE,
// not a named binding that would itself resolve to `undefined` and hide the
// intent of the assertion below.
import * as ProvenanceBadgeModule from '../../components/ProvenanceBadge';

// The helper takes the component's OWN union, not a loose `string` (W7-C3,
// forge-opj): every value this suite probes — 'ootb', 'vision', 'operator',
// null, undefined — is inside it, so widening bought nothing and cost the
// type-level pin that a future probe of a value the badge cannot receive
// fails to compile instead of quietly asserting the empty render.
function render(provenance?: ProvenanceBadgeModule.ProvenanceBadgeValue | null): string {
  return renderToStaticMarkup(React.createElement(ProvenanceBadge, { provenance }));
}

test('ootb renders the ootb badge with a machine-readable data-provenance', () => {
  const html = render('ootb');
  expect(html).toContain('badge-ootb');
  expect(html).toContain('data-provenance="ootb"');
  expect(html).toContain('ootb');
});

test('the "vision" token is removed (forge-r2j) — no wire producer ever emits it; an out-of-union probe renders nothing, same as any other unrecognised value', () => {
  // 'vision' used to widen ProvenanceBadgeValue past the wire's real
  // Provenance ('ootb'|'operator'|'unknown', studio-client.ts) for a future
  // caller with no current producer — declared data with no source, the
  // exact antipattern this file's own header already refuses for
  // provenanceOfFlowOrigin. `parseProvenance` (studio-client.ts) and every
  // real call site (LibraryCard.tsx) only ever produce the three real wire
  // tokens, so the cast below is the only way to probe the removed value at
  // all — same "red-while-present" convention as the pin two tests below.
  const html = render('vision' as unknown as ProvenanceBadgeModule.ProvenanceBadgeValue);
  expect(html).toBe('');
  expect(html).not.toContain('data-provenance="vision"');
});

test('operator-authored (and null/undefined) render NOTHING — no fabricated badge', () => {
  // Kills a badge that defaults every object to "ootb".
  expect(render('operator')).toBe('');
  expect(render(undefined)).toBe('');
  expect(render(null)).toBe('');
});

test('a "unknown" provenance value — studio-client\'s own wire type, "the server cannot attest" — renders NOTHING, and must NEVER render the ootb badge', () => {
  // Typed against the REAL wire type (not a hand-picked string literal), so
  // this is red under `tsc --noEmit` today for an honest reason: Provenance
  // is not yet exported by studio-client.ts. Kills a badge that treats an
  // unattested/'unknown' type as if it were shipped OOTB.
  const p: Provenance = 'unknown';
  const html = render(p);
  expect(html).toBe('');
  expect(html).not.toContain('badge-ootb');
  expect(html).not.toContain('data-provenance="ootb"');
});

test('provenanceOfFlowOrigin no longer exists on this module — the client stops inferring provenance from flow.origin', () => {
  // "Red-while-present, not red-while-absent" — same convention
  // lib/studio-client.test.ts's `bootstrapKb` removal pin already uses: the
  // function still exists today (a real, callable export), so this
  // assertion is genuinely RED at pin time and must flip to `undefined` once
  // the fix deletes it. A star-import means a still-missing export resolves
  // to `undefined` on the namespace object rather than crashing collection.
  expect((ProvenanceBadgeModule as unknown as Record<string, unknown>).provenanceOfFlowOrigin).toBeUndefined();
});
