/**
 * W7-A3 (sessions-kinds-08/12, artifact-plan-22/23, flows-23) — DOM contract
 * pins for `ArchitectCommittedView` (`components/studio/session/
 * ArchitectCommittedView.tsx`), the shared post-approve panel rendered by BOTH
 * the architect session page (committed phase) and the /artifact plan payoff.
 *
 * Kills: the hardcoded "Approved — manifests queued; the autonomous loop is
 * building it now" + `/flows/forge-develop` DEFINITION link — the panel must
 * name the initiative(s), link the RUN, and read the queue + scheduler for
 * its claim; a stopped scheduler must surface a Start control right there.
 *
 * RUN: npx vitest run lib/architect-committed-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArchitectCommittedView } from '@/components/studio/session/ArchitectCommittedView';
import type { InitiativeLinkage } from './architect-plan-view.ts';

const SESSION = { sessionId: '2026-08-18T13-27-13-8ee491f5', project: 'demo-project' };
const INIT = 'INIT-2026-08-18-add-version-flag';

function link(queueState: InitiativeLinkage['queueState'], over: Partial<InitiativeLinkage> = {}): InitiativeLinkage {
  const has = queueState !== 'unknown';
  return {
    initiativeId: INIT,
    runId: has ? INIT : null,
    flowId: has ? 'forge-architect' : null,
    runStatus: null,
    queueState,
    runHref: has ? `/flows/forge-architect/run/${INIT}` : null,
    monitorHref: has ? '/flows/forge-architect' : null,
    ...over,
  };
}

function render(props: Partial<React.ComponentProps<typeof ArchitectCommittedView>>): string {
  return renderToStaticMarkup(React.createElement(ArchitectCommittedView, {
    session: SESSION,
    linkage: [],
    scheduler: null,
    schedulerReady: true,
    linkageReady: true,
    ...props,
  }));
}

test('queued + scheduler stopped → honest headline, initiative row linking the RUN, Start control inside the panel', () => {
  const html = render({ linkage: [link('queued')], scheduler: { running: false } });
  expect(html).toContain('data-section="architect-committed"');
  expect(html).toContain('data-commit-tone="queued-stopped"');
  expect(html).toContain('data-needs-scheduler-start="true"');
  expect(html).toContain(`${INIT} is queued — the scheduler is stopped. Start it to build.`);
  expect(html).toContain(`data-initiative-link`);
  expect(html).toContain(`data-initiative-id="${INIT}"`);
  expect(html).toContain('data-queue-state="queued"');
  expect(html).toMatch(new RegExp(`<a[^>]*data-action="open-initiative-run"[^>]*href="/flows/forge-architect/run/${INIT}"`));
  expect(html).toContain('data-action="scheduler-start"');
  expect(html).not.toContain('the autonomous loop is building');
});

test('active run + scheduler running → the ONLY case that claims the loop is building', () => {
  const html = render({ linkage: [link('building', { flowId: 'forge-develop', runId: 'c1', runHref: '/flows/forge-develop/run/c1', monitorHref: '/flows/forge-develop' })], scheduler: { running: true, pid: 9 } });
  expect(html).toContain('data-commit-tone="building"');
  expect(html).toContain(`The autonomous loop is building ${INIT} now.`);
  expect(html).toContain('data-needs-scheduler-start="false"');
  expect(html).not.toContain('data-action="scheduler-start"');
  // watch-it-build lands on the run's OWN flow monitor, not a hardcoded definition.
  expect(html).toMatch(/<a[^>]*data-action="watch-it-build"[^>]*href="\/flows\/forge-develop"/);
});

test('active run + scheduler stopped → claimed-stopped, no "building" claim, Start offered', () => {
  const html = render({ linkage: [link('building')], scheduler: { running: false } });
  expect(html).toContain('data-commit-tone="claimed-stopped"');
  expect(html).not.toContain('the autonomous loop is building');
  expect(html).toContain('data-action="scheduler-start"');
});

test('no linkage rows → unknown tone, still the roadmap + watch-it-build affordances (never a dead end)', () => {
  const html = render({ linkage: [], scheduler: { running: true } });
  expect(html).toContain('data-commit-tone="unknown"');
  expect(html).toContain('Approved — no queue entry found for this session yet.');
  expect(html).toMatch(/<a[^>]*data-action="open-roadmap"[^>]*href="\/projects\/demo-project#roadmap"/);
  expect(html).toMatch(/<a[^>]*data-action="watch-it-build"[^>]*href="\/flows"/);
});

test('linkage not yet read → "Reading the queue…" (never a fabricated claim while loading)', () => {
  const html = render({ linkage: [], linkageReady: false, scheduler: { running: true } });
  expect(html).toContain('Reading the queue…');
  expect(html).toContain('data-commit-tone="unknown"');
});

test('one row per initiative, an unknown row carries no run link', () => {
  const html = render({ linkage: [link('queued'), link('unknown', { initiativeId: 'INIT-2026-01-01-b' })], scheduler: { running: true } });
  expect(html.match(/data-initiative-link/g)?.length).toBe(2);
  expect(html).toContain('data-initiative-id="INIT-2026-01-01-b"');
  expect(html.match(/data-action="open-initiative-run"/g)?.length).toBe(1);
});
