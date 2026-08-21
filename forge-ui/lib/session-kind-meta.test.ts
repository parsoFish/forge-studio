/**
 * Pinned tests — W7-B1: the ONE client-side session-kind meta module
 * (`lib/session-kind-meta.ts`).
 *
 * Findings this encodes (docs/roadmaps/wave-7-walkthrough-findings.md, W7-B1):
 *   - home-sessions-19 / crosscut-13 — two independently hand-kept kickoff
 *     lists (SessionsIndex.tsx's KICKOFF_LINKS vs the kickoff page's
 *     KICKOFF_KINDS) drifted in BOTH directions (one had architect but no
 *     community-refresh; the other the reverse). One shared list now feeds
 *     both surfaces; this file pins that the list covers every generic
 *     kickoff kind PLUS architect's bespoke entry.
 *   - home-sessions-20 / community-21 — the /sessions index rendered raw
 *     registry ids ("Kb-Cleanup") through CSS capitalize instead of the
 *     descriptor's authored title. `sessionKindTitle` is the one lookup.
 *
 * DRIFT PIN: the titles/agents here are client-side declared data — the same
 * class of second copy that caused home-sessions-19. The parity test below
 * reads the REAL `studio/session-kinds.yaml` registry off disk (the same
 * discipline `agent-ledger.test.ts`'s round-8 title check uses) and asserts
 * the module mirrors it kind-for-kind, title-for-title, agent-for-agent —
 * so a registry edit that this module misses turns the suite red instead of
 * silently drifting.
 *
 * RUN: npx vitest run lib/session-kind-meta.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SESSION_KIND_META,
  KICKOFF_ENTRIES,
  KICKOFF_SPECS,
  kickoffSpecFor,
  sessionKindTitle,
  sessionKindAgent,
} from './session-kind-meta.ts';

const YAML_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'studio', 'session-kinds.yaml');

/** Minimal line scanner over the flat `- id:` / `agent:` / `title:` shape of
 *  studio/session-kinds.yaml — deliberately NOT a full YAML parse: the three
 *  keys are one-line scalars on every descriptor and a full parser adds a
 *  cross-package dependency question this test does not need. If the file's
 *  shape ever changes enough to break this scanner, the count assertion
 *  below fails loudly rather than passing on garbage. */
function scanRegistry(): Array<{ id: string; agent: string; title: string }> {
  const lines = readFileSync(YAML_PATH, 'utf8').split('\n');
  const kinds: Array<{ id: string; agent: string; title: string }> = [];
  let current: { id: string; agent?: string; title?: string } | null = null;
  for (const line of lines) {
    const idMatch = /^- id:\s*(\S+)\s*$/.exec(line);
    if (idMatch) {
      if (current) kinds.push(current as { id: string; agent: string; title: string });
      current = { id: idMatch[1] };
      continue;
    }
    if (!current) continue;
    const agentMatch = /^\s{2}agent:\s*(\S+)\s*$/.exec(line);
    if (agentMatch && current.agent === undefined) current.agent = agentMatch[1];
    const titleMatch = /^\s{2}title:\s*(.+?)\s*$/.exec(line);
    if (titleMatch && current.title === undefined) current.title = titleMatch[1];
  }
  if (current) kinds.push(current as { id: string; agent: string; title: string });
  return kinds;
}

// ---- parity with the REAL registry ---------------------------------------

test('SESSION_KIND_META mirrors studio/session-kinds.yaml exactly — same kind set, same titles, same agents (drift pin)', () => {
  const registry = scanRegistry();
  // Sanity: the scanner found a plausible registry (8 kinds today; a shape
  // change that breaks the scanner fails HERE, not silently).
  expect(registry.length).toBeGreaterThanOrEqual(8);
  for (const kind of registry) {
    expect(kind.agent, `registry kind ${kind.id} has an agent line the scanner could read`).toBeTruthy();
    expect(kind.title, `registry kind ${kind.id} has a title line the scanner could read`).toBeTruthy();
  }

  const metaIds = SESSION_KIND_META.map((m) => m.id).sort();
  const registryIds = registry.map((k) => k.id).sort();
  expect(metaIds).toEqual(registryIds);

  for (const kind of registry) {
    expect(sessionKindTitle(kind.id), `title for ${kind.id}`).toBe(kind.title);
    expect(sessionKindAgent(kind.id), `agent for ${kind.id}`).toBe(kind.agent);
  }
});

// ---- title/agent lookups fail honest, never fabricate --------------------

test('sessionKindTitle falls back to the raw kind id for an unknown kind — honest, never a fabricated pretty label', () => {
  expect(sessionKindTitle('some-future-kind')).toBe('some-future-kind');
});

test('sessionKindAgent returns null for an unknown kind — never a guessed slug', () => {
  expect(sessionKindAgent('some-future-kind')).toBeNull();
});

// ---- the ONE kickoff list (home-sessions-19 / crosscut-13) ----------------

test('KICKOFF_ENTRIES carries all seven generic kickoff kinds (community-refresh AND onboarding INCLUDED) plus architect\'s bespoke /architect/new entry', () => {
  const byKind = new Map(KICKOFF_ENTRIES.map((e) => [e.kind, e.href]));
  expect(byKind.get('architect')).toBe('/architect/new');
  expect(byKind.get('instructions')).toBe('/sessions/instructions/new');
  expect(byKind.get('demo')).toBe('/sessions/demo/new');
  expect(byKind.get('project-brain')).toBe('/sessions/project-brain/new');
  expect(byKind.get('kb-cleanup')).toBe('/sessions/kb-cleanup/new');
  expect(byKind.get('authoring')).toBe('/sessions/authoring/new');
  expect(byKind.get('community-refresh')).toBe('/sessions/community-refresh/new');
  expect(byKind.get('onboarding')).toBe('/sessions/onboarding/new');
  expect(KICKOFF_ENTRIES.length).toBe(8);
});

test('every KICKOFF_ENTRIES label is the descriptor\'s own declared title — never a second hand-written label', () => {
  for (const entry of KICKOFF_ENTRIES) {
    expect(entry.label).toBe(sessionKindTitle(entry.kind));
  }
});

test('W7-C1 (sessions-kinds-01/crosscut-14): onboarding IS a generic kickoff kind — the onboard-project flow was retired in favour of the session, so /sessions/onboarding/new must be a real kickoff, not a dead end', () => {
  const entry = KICKOFF_ENTRIES.find((e) => e.kind === 'onboarding');
  expect(entry).toBeDefined();
  expect(entry?.href).toBe('/sessions/onboarding/new');
  const spec = KICKOFF_SPECS['onboarding'];
  expect(spec).toBeDefined();
  expect(spec.agentSlug).toBe('onboarding-agent');
  expect(spec.selector).toBe('project');
});

// ---- KICKOFF_SPECS (the kickoff page's per-kind form spec) ----------------

test('KICKOFF_SPECS covers exactly the seven generic kickoff kinds (architect keeps its bespoke native entry, ADR-043 §4)', () => {
  const specKinds = Object.keys(KICKOFF_SPECS).sort();
  const genericKinds = KICKOFF_ENTRIES.filter((e) => e.kind !== 'architect').map((e) => e.kind).sort();
  expect(specKinds).toEqual(genericKinds);
});

test('every KICKOFF_SPECS entry declares an operator-facing blurb (sessions-kinds-05: plain English first, jargon second)', () => {
  for (const [kind, spec] of Object.entries(KICKOFF_SPECS)) {
    expect(spec.blurb.length, `blurb for ${kind}`).toBeGreaterThan(20);
    // The blurb is operator prose, not provenance jargon.
    expect(spec.blurb).not.toContain('SKILL.md');
    expect(spec.blurb).not.toContain('status.json');
  }
});

test('every KICKOFF_SPECS agentSlug matches the registry descriptor\'s own agent (one source, no drift)', () => {
  for (const [kind, spec] of Object.entries(KICKOFF_SPECS)) {
    expect(spec.agentSlug, `agentSlug for ${kind}`).toBe(sessionKindAgent(kind));
  }
});

test('review round 1 — kickoffSpecFor is hasOwn-guarded: Object.prototype members never leak a truthy fake spec past the unknown-kind guard', () => {
  expect(kickoffSpecFor('constructor')).toBeNull();
  expect(kickoffSpecFor('toString')).toBeNull();
  expect(kickoffSpecFor('__proto__')).toBeNull();
  expect(kickoffSpecFor('not-a-kind')).toBeNull();
  expect(kickoffSpecFor('demo')).toBe(KICKOFF_SPECS['demo']);
});
