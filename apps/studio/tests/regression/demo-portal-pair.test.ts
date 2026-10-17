// @vitest-environment jsdom
/**
 * forge-8vfn.31 (R70) — a portal checkpoint on the verdict gate: the header names the portal page it opened
 * (as a command checkpoint names its command) beside the caption, and the before/after frames open in the
 * full-width 16:9 pair (forge-nk1y.44), frame first.
 *
 * RUN: npx vitest run apps/studio/tests/regression/demo-portal-pair.test.ts
 */
import { test, expect, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { DemoGallery } from '@/components/studio/gate/DemoGallery';
import type { DemoModelCheckpoint } from '@/lib/bridge-client';

const FRAME = 'data:image/png;base64,iVBORw0KGgo=';
const CPS: DemoModelCheckpoint[] = [
  { label: 'Plan 1: WI-1', caption: 'The org lists the new repository', form: 'portal-before-after', page: '/orgs/acme/repositories', beforeImage: FRAME, afterImage: FRAME, delta: 'changed' },
];
const noop = async (): Promise<void> => {};
const handlers = { onAdd: noop, onResolve: noop, onEdit: noop, onDelete: noop } as never;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

test('a portal checkpoint names its page beside the caption and opens both frames in the full-width pair', async () => {
  await act(async () => {
    root.render(React.createElement(DemoGallery, { checkpoints: CPS, apiDiff: [], cycleId: 'c1', bridgeBase: null, comments: [], disabled: false, handlers }));
  });
  const header = container.querySelector<HTMLElement>('[data-demo-region="checkpoint-1"]')!;
  expect(header.textContent).toContain('The org lists the new repository');
  expect(header.querySelector('code')?.textContent).toBe('page /orgs/acme/repositories');
  const pair = container.querySelector<HTMLElement>('[data-section="demo-pair"]')!;
  expect(pair.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(min(100%, calc(var(--pane-xl) + var(--pane-md))), 1fr))');
  const kinds = [...container.querySelectorAll('[data-side]')].map((s) => s.getAttribute('data-media-kind'));
  expect(kinds).toEqual(['frame', 'frame']);
});
