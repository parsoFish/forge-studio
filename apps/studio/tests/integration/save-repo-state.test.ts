/**
 * forge-mfv5.1.22 — a Save against a protected default branch opens a PR (saved,
 * shown as a link, still pending), and a base stranded ahead of origin comes back
 * as a recovery proposal the operator confirms from the page with its two shas.
 */
import { test, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { SaveRepoState } from '../../components/studio/project-builder/SaveRepoState';
import { fetchRepoStatus, saveProject } from '@/lib/studio-client';

vi.mock('../../lib/bridge-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/bridge-client.ts')>();
  return {
    ...actual,
    resolveBridgeUrl: vi.fn(async () => 'http://bridge.test'),
    bridgeFetch: vi.fn(async (path: string, init?: RequestInit) => fetch(`http://bridge.test${path}`, init)),
  };
});

afterEach(() => vi.unstubAllGlobals());

const PR = 'https://github.com/acme/weave/pull/7';
const HEAD = 'a'.repeat(40);
const ORIGIN = 'b'.repeat(40);
const json = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

test('a Save that opened a PR on a protected default branch is saved, not a refusal', async () => {
  vi.stubGlobal('fetch', json({ ok: true, id: 'weave', save: { merged: false, pushed: true, prUrl: PR, detail: `opened PR ${PR} (default branch protected)` } }));
  const r = await saveProject('weave', { name: 'weave' });
  expect(r.ok).toBe(true);
});

test('a Save that did not open the PR (pushed:false) is still not saved', async () => {
  vi.stubGlobal('fetch', json({ ok: true, id: 'weave', save: { merged: false, pushed: false, detail: 'not saved — gh pr create failed: x' } }));
  const r = await saveProject('weave', { name: 'weave' });
  expect(r.ok).toBe(false);
  expect(r.error).toContain('gh pr create failed');
});

test('a stranded-base proposal comes back as not saved, carrying the recovery to confirm', async () => {
  const detail = '2 commits move to forge-studio; local main resets to origin/main bbbbbbb';
  vi.stubGlobal('fetch', json({ ok: true, id: 'weave', save: { merged: false, pushed: false, detail, recovery: { commits: 2, subjects: ['two', 'one'], localHead: HEAD, resetTo: ORIGIN, base: 'main' } } }));
  const r = await saveProject('weave', { name: 'weave' });
  expect(r.ok).toBe(false);
  expect(r.recovery).toEqual({ commits: 2, subjects: ['two', 'one'], localHead: HEAD, resetTo: ORIGIN, base: 'main', detail });
});

test('repo-status carries the open PR link; a non-PR string is dropped', async () => {
  vi.stubGlobal('fetch', json({ pending: true, branch: 'forge-studio', uncommitted: [], prUrl: PR }));
  expect((await fetchRepoStatus('weave')).prUrl).toBe(PR);
  for (const bad of ['javascript:alert(1)', 'https://evil.example/x/pull/1', 'https://github.com.evil.io/a/b/pull/1', 'https://github.com/a/b/pull/1"onmouseover', null]) {
    vi.stubGlobal('fetch', json({ pending: true, branch: 'forge-studio', uncommitted: [], prUrl: bad }));
    expect((await fetchRepoStatus('weave')).prUrl).toBeUndefined();
  }
});

test('the panel links the PR and lists the stranded commits with a confirm control', () => {
  const html = renderToStaticMarkup(React.createElement(SaveRepoState, {
    prUrl: PR, busy: false, onRecover: () => {},
    recovery: { commits: 2, subjects: ['two', 'one'], localHead: HEAD, resetTo: ORIGIN, base: 'main', detail: '2 commits move to forge-studio' },
  }));
  expect(html).toContain('data-section="save-pr"');
  expect(html).toContain(`href="${PR}"`);
  expect(html).toContain('data-section="save-recovery"');
  expect(html).toContain('data-recovery-commits="2"');
  expect(html).toContain('data-action="confirm-recovery"');
  expect(html).toContain('2 commits move to forge-studio');
  const busy = renderToStaticMarkup(React.createElement(SaveRepoState, {
    prUrl: undefined, busy: true, onRecover: () => {},
    recovery: { commits: 1, subjects: ['one'], localHead: HEAD, resetTo: ORIGIN, base: 'main', detail: 'd' },
  }));
  expect(busy).toContain('data-disabled-reason="Saving…"');
  expect(busy).not.toContain('data-section="save-pr"');
});

test('the page re-sends Save with the proposal\'s two shas when the operator confirms', () => {
  const page = readFileSync(resolve(__dirname, '../../app/projects/[id]/page.tsx'), 'utf8');
  expect(page).toMatch(/<SaveRepoState prUrl=\{repo\?\.prUrl\} prState=\{repo\?\.prState\} prDetail=\{repo\?\.prDetail\} recovery=\{recovery\}/);
  expect(page).toMatch(/localHead: recovery\.localHead, resetTo: recovery\.resetTo/);
  expect(page).toMatch(/setRecovery\(result\.recovery \?\? null\)/);
});

// forge-mfv5.1.23 — the PR panel names the verdict Save acts on; "Save again after it merges" is gone.
const NO_REQ = 'no required check reports on this branch — merge on GitHub yourself or add a required check';
const panel = (prState: string | undefined, prDetail: string | undefined) => renderToStaticMarkup(React.createElement(SaveRepoState, {
  prUrl: PR, prState: prState as never, prDetail, recovery: null, busy: false, onRecover: () => {},
}));

test('the PR panel carries data-pr-state and state-appropriate text for every verdict', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['pending', 'checks pending: build, ci/legacy', /checks pending: build, ci\/legacy/],
    ['failing', 'checks failing: build', /checks failing: build/],
    ['green', 'required checks green: build', /Save to merge it/],
    ['merged', 'PR merged', /merged/i],
    ['blocked-by-ruleset', 'GitHub refused the merge (GraphQL: Repository rule violations found) — merge on GitHub yourself', /Repository rule violations found/],
    ['blocked-no-required-check', NO_REQ, new RegExp(NO_REQ)],
    ['stale-head', 'PR head fffffff is not the pushed aaaaaaa', /fffffff/],
    ['unreadable', 'PR state unreadable: gh api graphql failed: HTTP 502', /HTTP 502/],
  ];
  for (const [state, detail, text] of cases) {
    const html = panel(state, detail);
    expect(html).toContain(`data-pr-state="${state}"`);
    expect(html).toMatch(text);
    expect(html).not.toContain('Save again after it merges');
  }
  expect(panel(undefined, undefined)).toContain('data-pr-state=""');
});

test('repo-status carries the PR state by name and its detail; an unknown state is dropped', async () => {
  vi.stubGlobal('fetch', json({ pending: true, branch: 'forge-studio', uncommitted: [], prUrl: PR, prState: 'failing', prDetail: 'checks failing: build' }));
  const r = await fetchRepoStatus('weave');
  expect(r.prState).toBe('failing');
  expect(r.prDetail).toBe('checks failing: build');
  vi.stubGlobal('fetch', json({ pending: true, branch: 'forge-studio', uncommitted: [], prUrl: PR, prState: 'lgtm', prDetail: 7 }));
  const bad = await fetchRepoStatus('weave');
  expect(bad.prState).toBeUndefined();
  expect(bad.prDetail).toBeUndefined();
});

test('a Save whose merge GitHub refused (blocked-by-ruleset) reports not saved, naming why', async () => {
  const detail = `updated open PR ${PR} (default branch protected) — forge-studio → main; GitHub refused the merge (GraphQL: Repository rule violations found) — merge on GitHub yourself`;
  vi.stubGlobal('fetch', json({ ok: true, id: 'weave', save: { merged: false, pushed: true, prUrl: PR, prState: 'blocked-by-ruleset', detail } }));
  const r = await saveProject('weave', { name: 'weave' });
  expect(r.ok).toBe(false);
  expect(r.error).toContain('merge on GitHub yourself');
});
