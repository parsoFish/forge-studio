/**
 * knowledge-38 (forge-6gv.6.1): `/knowledge?seedSession=<id>` used to render
 * "…a seeding session is running for it" UNCONDITIONALLY — a pure
 * presence-of-the-query-param check, never a read of the session's real
 * phase. `startProjectBrain` (lib/bridge-client.ts's own doc comment) always
 * mints a fresh session at `phase: 'briefing'` — idle, waiting for the
 * operator's brief — so the very first thing the operator saw after
 * creating a KB was a wrong state shown as fact: nothing was running yet.
 *
 * `kbSeedBannerCopy` is the pure derivation from the session's real phase
 * (or `null` — not yet read / the read failed, which must NEVER claim
 * "running" either) to honest banner copy + a `running` flag the page's own
 * `data-seed-session-phase`/`data-seed-session-running` attributes mirror.
 */
import { test, expect } from 'vitest';
import { kbSeedBannerCopy } from '../../lib/kb-seed-banner';
import type { ProjectBrainSession } from '../../lib/bridge-client';

test('phase not yet known (still loading, or the read failed) — never claims "running"', () => {
  const copy = kbSeedBannerCopy(null);
  expect(copy.running).toBe(false);
  expect(copy.text.toLowerCase()).not.toMatch(/\bis running\b/);
});

test('"briefing" — the fresh, idle default EVERY seeding session starts at — is honestly NOT running', () => {
  const copy = kbSeedBannerCopy('briefing');
  expect(copy.running).toBe(false);
  expect(copy.text.toLowerCase()).not.toMatch(/\bis running\b/);
  expect(copy.text.toLowerCase()).toMatch(/brief/);
});

test('"analyzing" and "committing" — the agent is genuinely doing something — ARE running', () => {
  for (const phase of ['analyzing', 'committing'] as const) {
    const copy = kbSeedBannerCopy(phase);
    expect(copy.running, phase).toBe(true);
  }
});

test('"awaiting-review" — settled, waiting on the operator, not running', () => {
  const copy = kbSeedBannerCopy('awaiting-review');
  expect(copy.running).toBe(false);
  expect(copy.text.toLowerCase()).toMatch(/review/);
});

test('"committed" and "abandoned" — terminal, not running', () => {
  for (const phase of ['committed', 'abandoned'] as const) {
    const copy = kbSeedBannerCopy(phase);
    expect(copy.running, phase).toBe(false);
  }
});

test('every real ProjectBrainSession phase is handled — a future phase added to the union must fail this exhaustiveness check, not silently default', () => {
  const phases: ProjectBrainSession['phase'][] = ['briefing', 'analyzing', 'awaiting-review', 'committing', 'committed', 'abandoned'];
  for (const phase of phases) {
    expect(() => kbSeedBannerCopy(phase), phase).not.toThrow();
  }
});
