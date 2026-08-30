/**
 * W7-FIX-A1 (A1-01 / A1-02) — the ONE shared page-level LOAD-ERROR state
 * (`components/PageLoadError.tsx`) every detail route renders when its own
 * read fails: /agents/<id>, /projects/<id>, /flows/<id>,
 * /projects/<id>/showcase.
 *
 * Why a THIRD shape beside `NotFound` and the inline `FetchErrorState`: a
 * detail page whose roster read failed knows NEITHER that the object exists
 * NOR that it does not — so it must render neither the object (a blank
 * builder — A1-01) nor "No project <id>" (A1-02). It has SETTLED, into a
 * failure — the same route's own `data-page` value with
 * `data-page-ready="true"` + `data-fetch-status="error"` — with the shared
 * `[data-component="fetch-error"]` body, a Retry, and a way back.
 *
 * Contract (docs/forge-ui-dom-and-harness.md → "Shared — page load error"):
 *   <main data-page=<the route's own page> data-page-ready="true"
 *         data-fetch-status="error" data-load-error="true" {...rootAttrs}>
 *     <StudioNav/>                                nav intact
 *     [data-component="page-load-error"]
 *       [data-component="fetch-error"][data-action="retry-fetch"]   the shared failure body
 *       a[data-action="load-error-back"][href=backHref]              a way back
 *
 * Wrong implementations these pins kill:
 *   - rendering `NotFound` for a failed read (the id may well exist);
 *   - a "settled" page that keeps `data-page-ready="false"` forever;
 *   - a page that reports `data-fetch-status="ok"` while its body is an error;
 *   - an error page with no Retry (a bridge blip would need F5) or no way back.
 *
 * RUN: cd forge-ui && npx vitest run lib/page-load-error-render.test.ts
 */
import { test, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/agents/developer-ralph',
  useRouter: () => ({ push: () => {}, replace: () => {} }),
}));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageLoadError } from '@/components/PageLoadError';
import { BridgeReadError } from './bridge-result';
import { fetchErrorPropsFrom } from '@/components/FetchErrorState';

test('PageLoadError: the route\'s OWN data-page + data-page-ready="true" + data-fetch-status="error" + data-load-error, nav intact, shared fetch-error body with Retry, back link', () => {
  const html = renderToStaticMarkup(
    React.createElement(PageLoadError, {
      page: 'agents',
      rootAttrs: { 'data-agent-id': 'developer-ralph' },
      what: 'agent "developer-ralph"',
      error: 'bridge unreachable (Failed to fetch)',
      onRetry: () => {},
      backHref: '/agents',
      backLabel: 'Agents',
    }),
  );
  expect(html).toMatch(/<main[^>]*data-page="agents"/);
  expect(html).toContain('data-page-ready="true"');
  expect(html).toContain('data-fetch-status="error"');
  expect(html).toContain('data-load-error="true"');
  expect(html).toContain('data-agent-id="developer-ralph"');
  // NEVER the not-found treatment — the id may well exist.
  expect(html).not.toContain('data-page="not-found"');
  expect(html).not.toContain('data-component="not-found"');
  // Studio chrome stays.
  expect(html).toContain('data-nav="agents"');
  // The honest body is the shared failure state (unreachable framing here).
  expect(html).toContain('data-component="page-load-error"');
  expect(html).toContain('data-component="fetch-error"');
  expect(html).toContain('data-fetch-reachable="false"');
  expect(html).toContain('Could not reach the forge bridge');
  expect(html).toContain('bridge unreachable (Failed to fetch)');
  expect(html).toContain('data-action="retry-fetch"');
  // …and always a way back.
  expect(html).toMatch(/<a[^>]*data-action="load-error-back"[^>]*href="\/agents"/);
  expect(html).toContain('Agents');
});

test('PageLoadError: a REACHABLE bridge\'s refusal (status present) carries the http status and the bridge\'s own text — never "could not reach" (library-13)', () => {
  const props = fetchErrorPropsFrom(new BridgeReadError('/api/studio/projects', { ok: false, status: 500, error: 'roster scan failed: EACCES' }));
  const html = renderToStaticMarkup(
    React.createElement(PageLoadError, {
      page: 'projects',
      rootAttrs: { 'data-project-id': 'gitpulse' },
      what: 'project "gitpulse"',
      ...props,
      onRetry: () => {},
      backHref: '/projects',
      backLabel: 'Projects',
    }),
  );
  expect(html).toMatch(/<main[^>]*data-page="projects"/);
  expect(html).toContain('data-fetch-http-status="500"');
  expect(html).toContain('data-fetch-reachable="true"');
  expect(html).toContain('roster scan failed: EACCES');
  expect(html).not.toContain('Could not reach');
  expect(html).not.toContain('data-page="not-found"');
});

test('PageLoadError: the id is rendered as text (escaped), never interpreted', () => {
  const html = renderToStaticMarkup(
    React.createElement(PageLoadError, {
      page: 'flow-monitor',
      what: 'flow "<img src=x onerror=alert(1)>"',
      error: 'boom',
      status: 502,
      onRetry: () => {},
      backHref: '/flows',
      backLabel: 'Flows',
    }),
  );
  expect(html).not.toContain('<img');
  expect(html).toContain('&lt;img');
});
