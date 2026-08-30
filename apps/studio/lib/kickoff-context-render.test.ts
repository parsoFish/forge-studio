/**
 * Pinned tests — W7-B1 (sessions-kinds-05): the kickoff context card leads
 * with operator-facing plain English (what the session does, what it
 * produces) and offers a way back out; the agent slug / SKILL path / session
 * directory drop to a secondary provenance line — never the headline.
 *
 * `KickoffContextCard` (components/studio/session/KickoffContextCard.tsx) is
 * pure + props-driven, rendered via renderToStaticMarkup — same precedent as
 * every other *-render.test.ts here.
 *
 * RUN: npx vitest run lib/kickoff-context-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { KickoffContextCard } from '@/components/studio/session/KickoffContextCard';
import { KICKOFF_SPECS } from './session-kind-meta.ts';

function render(kind: string, extra: { sessionDirHint?: string; initiative?: string | null } = {}): string {
  const spec = KICKOFF_SPECS[kind];
  return renderToStaticMarkup(React.createElement(KickoffContextCard, {
    kind,
    spec,
    sessionDirHint: extra.sessionDirHint ?? `projects/<project>/_${kind}/<sessionId>`,
    initiative: extra.initiative ?? null,
  }));
}

test('W7-B1 (sessions-kinds-05): the card LEADS with the plain-English blurb — it appears before the agent slug / SKILL path provenance', () => {
  const html = render('demo');
  expect(html).toContain('data-section="kickoff-context"');
  expect(html).toContain('data-kickoff-blurb');
  const blurbIdx = html.indexOf(KICKOFF_SPECS['demo'].blurb.slice(0, 40));
  const provenanceIdx = html.indexOf('skills/demo-builder/SKILL.md');
  expect(blurbIdx).toBeGreaterThan(-1);
  expect(provenanceIdx).toBeGreaterThan(-1);
  expect(blurbIdx).toBeLessThan(provenanceIdx);
});

test('W7-B1: the provenance line is still there (slug, SKILL path, session dir) — demoted, not deleted', () => {
  const html = render('instructions', { sessionDirHint: 'projects/gitpulse/_instructions/<sessionId>' });
  expect(html).toContain('instructions-creator');
  expect(html).toContain('skills/instructions-creator/SKILL.md');
  expect(html).toContain('projects/gitpulse/_instructions/&lt;sessionId&gt;');
});

test('W7-B1: what the session produces renders as an operator-facing row', () => {
  const html = render('kb-cleanup');
  expect(html).toContain('Cleanup plan');
});

test('W7-B1 (sessions-kinds-05): a back-out link to /sessions renders with data-action="kickoff-back"', () => {
  const html = render('authoring');
  expect(html).toContain('data-action="kickoff-back"');
  expect(html).toContain('href="/sessions"');
});

test('W7-B1: the initiative-context line renders only when an initiative is handed over', () => {
  const withInit = render('demo', { initiative: 'INIT-2026-08-01-x' });
  expect(withInit).toContain('data-section="kickoff-initiative-context"');
  expect(withInit).toContain('INIT-2026-08-01-x');
  const without = render('demo');
  expect(without).not.toContain('data-section="kickoff-initiative-context"');
});
