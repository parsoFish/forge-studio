/** StudioNav mounts the one halt control and, only while halted, the global banner (row 207, forge-8vfn.8.5.57). */
import { test, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ServeStatus } from '../../lib/bridge-client-core.ts';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/link', () => ({ default: (p: { href: string; children?: unknown }) => React.createElement('a', { href: p.href }, p.children as never) }));
let mockStatus: ServeStatus | null = null;
vi.mock('@/lib/use-serve-status', () => ({
  useServeStatus: () => ({ status: mockStatus, ready: true, refresh: async () => {} }),
}));

import { StudioNav } from '../../components/StudioNav.tsx';

beforeEach(() => { mockStatus = null; });
const count = (s: string, n: string) => s.split(n).length - 1;

test('not halted: control off, no banner, no release control', () => {
  mockStatus = { state: 'running', pid: 1, restarts: 0, nextRestartAt: null, halt: null };
  const out = renderToStaticMarkup(React.createElement(StudioNav));
  expect(out).toContain('data-halt-state="off"');
  expect(out).not.toContain('emergency-halt-banner');
  expect(out).not.toContain('release-halt');
});

test('halted: control on, banner present, exactly one release-halt', () => {
  mockStatus = { state: 'running', pid: 1, restarts: 0, nextRestartAt: null, halt: { since: null, actor: null, active: 1, queued: 2 } };
  const out = renderToStaticMarkup(React.createElement(StudioNav));
  expect(out).toContain('data-halt-state="on"');
  expect(out).toContain('data-component="emergency-halt-banner"');
  expect(count(out, 'data-action="release-halt"')).toBe(1);
});

test('the landmark comment is not rendered as text', () => {
  const out = renderToStaticMarkup(React.createElement(StudioNav));
  expect(out).not.toContain('W7-C3');
});
