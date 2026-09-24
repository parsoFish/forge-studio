/**
 * knowledge-38 (forge-6gv.6.1): `/knowledge?seedSession=<id>` — WIRING pin.
 * The pure copy derivation (`lib/kb-seed-banner.ts`'s `kbSeedBannerCopy`) is
 * unit-tested on its own (`tests/unit/kb-seed-banner.test.ts`); this file
 * pins that the PAGE actually reads the session's real phase (via that same
 * module's `useKbSeedSessionPhase` hook — pulled out of the page itself,
 * which is already an over-cap size exemption) and renders that
 * derivation's copy, instead of the old hardcoded "…is running for it"
 * string that fired off nothing but the query param's presence.
 *
 * Source-text pin, not a rendered-DOM pin: both files are `use client`
 * code whose banner state arrives from an effect-driven fetch, invisible to
 * `renderToStaticMarkup` (same reasoning as every other bespoke wiring test
 * in this directory).
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readPage = (): string => readFileSync(resolve(__dirname, '..', '..', 'app', 'knowledge', 'page.tsx'), 'utf8');
const readBanner = (): string => readFileSync(resolve(__dirname, '..', '..', 'lib', 'kb-seed-banner.ts'), 'utf8');

test('the page no longer hardcodes "is running" — it renders kbSeedBannerCopy\'s own text, sourced from useKbSeedSessionPhase', () => {
  const src = readPage();
  expect(src).toMatch(/import \{ kbSeedBannerCopy, useKbSeedSessionPhase \} from '@\/lib\/kb-seed-banner'/);
  expect(src).toMatch(/kbSeedBannerCopy\(useKbSeedSessionPhase\(seedSessionParam\)\)/);
  // The literal claim this bead's own defect made — gone from the PAGE (it
  // may still appear inside kb-seed-banner.ts's own copy for the genuinely-
  // running phases, but never as a hardcoded literal on the page itself).
  expect(src).not.toMatch(/a seeding session is running for it/);
});

test('the page\'s seed banner root carries data-seed-session-running, sourced from the derivation\'s own running flag — never a static guess', () => {
  const src = readPage();
  expect(src).toMatch(/data-seed-session-running=\{[^}]*\.running[^}]*\}/);
});

test('useKbSeedSessionPhase fetches the session\'s real phase (fetchProjectBrainSessions) when an id is present, and finds ITS OWN session by id', () => {
  const src = readBanner();
  expect(src).toMatch(/import \{ fetchProjectBrainSessions, type ProjectBrainSession \} from '\.\/bridge-client'/);
  expect(src).toMatch(/if \(!seedSessionId\) return;/);
  expect(src).toMatch(/fetchProjectBrainSessions\(\)/);
  expect(src).toMatch(/\.find\(\(s\) => s\.session_id === seedSessionId\)/);
});

test('a failed phase read never fabricates "running" — the hook resets to null, not a guessed phase', () => {
  const src = readBanner();
  // The catch branch of the seed-phase effect must not silently invent a
  // phase — it explicitly resets to the honest `null` state
  // `kbSeedBannerCopy` renders identically to "not yet read".
  expect(src).toMatch(/fetchProjectBrainSessions\(\)[\s\S]{0,400}\.catch\(\(\) => \{[\s\S]{0,80}setPhase\(null\)/);
});

// ---------------------------------------------------------------------------
// forge-t4pp — `?seedSession=<id>` used to mint `[data-action="open-
// seed-session"]`'s href straight off the raw URL param: a hand-typed or
// stale id rendered a link whose target 404s. `useKbSeedSessionPhase`
// ALREADY performs the one session-id validity predicate this page has
// (`.find((s) => s.session_id === seedSessionId)`, pinned above) — its
// return is `null` for every dishonest case alike (not yet checked, the
// read failed, or no such session), and a REAL phase value only once a
// matching session was actually found. The fix reuses that SAME predicate
// to gate the link instead of adding a second one: no link renders until
// `seedBanner.phase !== null`.
// ---------------------------------------------------------------------------

test('forge-t4pp: the seed-session link is gated on the session actually having been found (seedBanner.phase !== null) — never on the raw query param alone', () => {
  const src = readPage();
  const bannerIdx = src.indexOf('data-component="kb-seed-banner"');
  expect(bannerIdx, 'the seed banner section was not found').toBeGreaterThan(-1);
  const linkIdx = src.indexOf('data-action="open-seed-session"', bannerIdx);
  expect(linkIdx, 'open-seed-session was not found inside the seed banner').toBeGreaterThan(-1);
  // The nearest preceding conditional gating that render must name
  // seedBanner.phase, not merely re-check seedSessionParam (already the
  // banner's own outer gate — validating the SAME fact twice proves nothing).
  const between = src.slice(bannerIdx, linkIdx);
  expect(between).toMatch(/seedBanner\.phase !== null/);
});
