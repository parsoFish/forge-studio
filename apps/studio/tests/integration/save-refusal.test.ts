/**
 * Row 6 of cap-fix-onboarding (ruling T1 1977a) — a refused Save is shown, never
 * read as saved, and offers to commit the named contract files and save again.
 */
import { test, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SaveRefusal } from '../../components/studio/project-builder/SaveRefusal';
import { saveProject } from '@/lib/studio-client';

vi.mock('../../lib/bridge-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/bridge-client.ts')>();
  return {
    ...actual,
    resolveBridgeUrl: vi.fn(async () => 'http://bridge.test'),
    bridgeFetch: vi.fn(async (path: string, init?: RequestInit) => fetch(`http://bridge.test${path}`, init)),
  };
});

afterEach(() => vi.unstubAllGlobals());

test('the refusal names every uncommitted file and offers commit-and-save', () => {
  const html = renderToStaticMarkup(
    React.createElement(SaveRefusal, { files: ['.forge/project.json', 'roadmap.md'], busy: false, onAdopt: () => {} }),
  );
  expect(html).toContain('data-section="save-refused"');
  expect(html).toContain('data-save-refused-count="2"');
  expect(html).toContain('.forge/project.json');
  expect(html).toContain('roadmap.md');
  expect(html).toContain('data-action="adopt-and-save"');
});

test('saveProject reports a refused Save as not ok, carrying the files — never as saved', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    ok: true, id: 'weave',
    save: { merged: false, pushed: false, refused: ['roadmap.md'], detail: 'refused — uncommitted contract file(s) would be missing from main: roadmap.md.' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })));
  const r = await saveProject('weave', { name: 'weave' });
  expect(r.ok).toBe(false);
  expect(r.refused).toEqual(['roadmap.md']);
  expect(r.error).toContain('roadmap.md');
});

test('a Save that failed without a refusal (merged:false, a git error) is reported as not saved', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    ok: true, id: 'weave', save: { merged: false, pushed: false, detail: 'fatal: Unable to create index.lock' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })));
  const r = await saveProject('weave', { name: 'weave' });
  expect(r.ok).toBe(false);
  expect(r.error).toContain('index.lock');
});

test('nothing pending to merge is still a successful save', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    ok: true, id: 'weave', save: { merged: false, pushed: false, detail: 'no pending forge-studio changes' },
  }), { status: 200, headers: { 'content-type': 'application/json' } })));
  expect((await saveProject('weave', { name: 'weave' })).ok).toBe(true);
});
