/**
 * W7-A3 (sessions-kinds-08/12, artifact-plan-22/23, flows-23); M7-E row 205
 * (D-12) — DOM contract pins for `ArchitectCommittedView`
 * (`components/studio/session/ArchitectCommittedView.tsx`), the shared
 * post-approve panel rendered by BOTH the architect session page (committed
 * phase) and the /artifact plan payoff.
 *
 * Kills: the hardcoded "Approved — manifests queued; the autonomous loop is
 * building it now" + `/flows/forge-develop` DEFINITION link — the panel must
 * name the initiative(s), link the RUN, and read the queue + the live serve
 * status for its claim; a not-running serve must surface the shared
 * read-only notice right there.
 *
 * RUN: npx vitest run lib/architect-committed-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArchitectCommittedView } from '@/components/studio/session/ArchitectCommittedView';
import type { InitiativeLinkage } from '../../lib/architect-plan-view.ts';
import type { ServeStatus } from '../../lib/bridge-client.ts';

const SESSION = { sessionId: '2026-08-18T13-27-13-8ee491f5', project: 'demo-project' };
const INIT = 'INIT-2026-08-18-add-version-flag';
const RUNNING: ServeStatus = { state: 'running', pid: 1, restarts: 0, nextRestartAt: null, halt: null };
const DOWN: ServeStatus = { state: 'down', pid: null, restarts: 0, nextRestartAt: null, halt: null };

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
    serve: null,
    linkageReady: true,
    ...props,
  }));
}

test('queued + serve not running → honest headline, initiative row linking the RUN, the shared notice inside the panel', () => {
  const html = render({ linkage: [link('queued')], serve: DOWN });
  expect(html).toContain('data-section="architect-committed"');
  expect(html).toContain('data-commit-tone="queued-not-running"');
  expect(html).toContain('data-serve-not-ready="true"');
  expect(html).toContain(`${INIT} is queued — forge serve is not currently running; it will resume once Studio brings it back.`);
  expect(html).toContain(`data-initiative-link`);
  expect(html).toContain(`data-initiative-id="${INIT}"`);
  expect(html).toContain('data-queue-state="queued"');
  expect(html).toMatch(new RegExp(`<a[^>]*data-action="open-initiative-run"[^>]*href="/flows/forge-architect/run/${INIT}"`));
  expect(html).toContain('data-component="serve-status-notice"');
  expect(html).toContain('data-serve-state="down"');
  expect(html).not.toContain('the autonomous loop is building');
});

test('active run + serve running → the ONLY case that claims the loop is building', () => {
  const html = render({ linkage: [link('building', { flowId: 'forge-develop', runId: 'c1', runHref: '/flows/forge-develop/run/c1', monitorHref: '/flows/forge-develop' })], serve: RUNNING });
  expect(html).toContain('data-commit-tone="building"');
  expect(html).toContain(`The autonomous loop is building ${INIT} now.`);
  expect(html).toContain('data-serve-not-ready="false"');
  expect(html).not.toContain('data-component="serve-status-notice"');
  // watch-it-build lands on the run's OWN flow monitor, not a hardcoded definition.
  expect(html).toMatch(/<a[^>]*data-action="watch-it-build"[^>]*href="\/flows\/forge-develop"/);
});

test('active run + serve not running → claimed-not-running, no "building" claim, the shared notice offered', () => {
  const html = render({ linkage: [link('building')], serve: DOWN });
  expect(html).toContain('data-commit-tone="claimed-not-running"');
  expect(html).not.toContain('the autonomous loop is building');
  expect(html).toContain('data-component="serve-status-notice"');
});

test('no linkage rows → unknown tone, still the roadmap + watch-it-build affordances (never a dead end)', () => {
  const html = render({ linkage: [], serve: RUNNING });
  expect(html).toContain('data-commit-tone="unknown"');
  expect(html).toContain('Approved — no queue entry found for this session yet.');
  expect(html).toMatch(/<a[^>]*data-action="open-roadmap"[^>]*href="\/projects\/demo-project#roadmap"/);
  expect(html).toMatch(/<a[^>]*data-action="watch-it-build"[^>]*href="\/flows"/);
});

test('linkage not yet read → "Reading the queue…" (never a fabricated claim while loading)', () => {
  const html = render({ linkage: [], linkageReady: false, serve: RUNNING });
  expect(html).toContain('Reading the queue…');
  expect(html).toContain('data-commit-tone="unknown"');
});

test('one row per initiative, an unknown row carries no run link', () => {
  const html = render({ linkage: [link('queued'), link('unknown', { initiativeId: 'INIT-2026-01-01-b' })], serve: RUNNING });
  expect(html.match(/data-initiative-link/g)?.length).toBe(2);
  expect(html).toContain('data-initiative-id="INIT-2026-01-01-b"');
  expect(html.match(/data-action="open-initiative-run"/g)?.length).toBe(1);
});

// ---------------------------------------------------------------------------
// W8-B3 (sessions-kinds-08) — "Watch it build →" must never be a dead end.
//
// Live evidence from the wave-7 re-gate: 22 of 63 runs carry the `"unknown"`
// flow sentinel, and on 8 of 12 committed architect sessions this CTA
// navigated to `/flows/unknown`, which renders «flow "unknown" is retired».
// ---------------------------------------------------------------------------

test('sessions-kinds-08: with no live flow monitor, "Watch it build →" falls back to the initiative\'s OWN run page — never /flows/unknown', () => {
  const html = render({
    linkage: [link('complete', { flowId: 'unknown', runHref: `/flows/unknown/run/${INIT}`, monitorHref: null })],
  });
  expect(html).toContain(`data-action="watch-it-build"`);
  expect(html).toContain(`href="/flows/unknown/run/${INIT}"`);
  expect(html).not.toContain('href="/flows/unknown"');
});

test('sessions-kinds-08: a live flow monitor is still preferred when one exists', () => {
  const html = render({
    linkage: [link('building', { flowId: 'forge-develop', runHref: `/flows/forge-develop/run/${INIT}`, monitorHref: '/flows/forge-develop' })],
  });
  expect(html).toContain('href="/flows/forge-develop"');
});
