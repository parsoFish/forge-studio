// @vitest-environment jsdom
/**
 * forge-nk1y.44 — the before/after pair rendered ~544x306 px per side: a 2:1 box beside a 264 px
 * rail inside a fixed 480 px pane, so a 1280x720 capture read at ~5 px type. The pair now spans the
 * gate width: the rail is a strip ABOVE it, each side is a 16:9 box at least --pane-xl + --pane-md
 * (720 px) wide with the media contained, and the block is sized by that width, not a fixed pane.
 * jsdom has no layout, so the box's declared geometry is what is asserted; the PR body carries the
 * pixels measured in a real browser at 1600x1000.
 *
 * RUN: npx vitest run apps/studio/tests/regression/demo-pair-full-width.test.ts
 */
import { test, expect, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { DemoGallery } from '@/components/studio/gate/DemoGallery';
import type { DemoModelCheckpoint } from '@/lib/bridge-client';

const CPS: DemoModelCheckpoint[] = [
  { label: 'Plan 1: WI-1', caption: 'gw plan reads the org', command: 'gw plan', beforeOutput: 'plan: v1', afterOutput: 'plan: v2', delta: 'changed', beforeVideoSrc: '.capture/before/p1.webm', afterVideoSrc: '.capture/after/p1.webm' },
  { label: 'Plan 2: WI-2', caption: 'gw reset', command: 'gw reset', beforeOutput: 'same', afterOutput: 'same', delta: 'unchanged' },
];
const noop = async (): Promise<void> => {};
const handlers = { onAdd: noop, onResolve: noop, onEdit: noop, onDelete: noop } as never;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(DemoGallery, { checkpoints: CPS, apiDiff: [], cycleId: 'c1', bridgeBase: 'http://127.0.0.1:4123', comments: [], disabled: false, handlers }));
  });
}
const q = <T extends HTMLElement = HTMLElement>(sel: string): T => { const el = container.querySelector<T>(sel); if (!el) throw new Error(`missing ${sel}`); return el; };

test('the checkpoint rail is a strip ABOVE the pair, not a column beside it', async () => {
  await render();
  const strip = q('nav[aria-label="Checkpoints"]');
  expect(strip.getAttribute('data-rail')).toBe('strip');
  expect(strip.style.overflowX).toBe('auto');
  const pair = q('[data-section="demo-pair"]');
  // DOCUMENT_POSITION_FOLLOWING: the pair comes after the strip.
  expect(strip.compareDocumentPosition(pair) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(strip.parentElement!.contains(pair)).toBe(true);
  expect(strip.parentElement!.style.gridTemplateColumns).toBe('');
});

test('each side is a 16:9 box at least --pane-xl + --pane-md wide; the pair spans the width', async () => {
  await render();
  const pair = q('[data-section="demo-pair"]');
  expect(pair.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(min(100%, calc(var(--pane-xl) + var(--pane-md))), 1fr))');
  const boxes = container.querySelectorAll<HTMLElement>('[data-media-box]');
  expect(boxes.length).toBe(2);
  for (const box of boxes) {
    expect(box.style.aspectRatio).toBe('16 / 9');
    expect(box.style.width).toBe('100%');
  }
});

test('the demo block is sized by the pair, not a fixed --pane-xl height', async () => {
  await render();
  const section = q('[data-section="demo-comparison"]');
  for (const el of section.querySelectorAll<HTMLElement>('*')) expect(el.style.height).not.toBe('var(--pane-xl)');
});

test('the delta stamp sits on the pair header', async () => {
  await render();
  const header = q('[data-demo-region="checkpoint-1"]');
  expect(header.getAttribute('data-checkpoint-delta')).toBe('changed');
  expect(header.textContent).toContain('changed');
});

test('video and frame are contained in the box (no letterbox crop, no stretch)', async () => {
  await render();
  await act(async () => { q<HTMLButtonElement>('[data-side="before"] [data-media-mode="video"]').click(); });
  const video = q<HTMLVideoElement>('[data-side="before"] video');
  expect(video.style.objectFit).toBe('contain');
});

test('Enlarge still opens the lightbox', async () => {
  await render();
  expect(container.querySelector('[data-action="enlarge-evidence"]')).not.toBeNull();
  expect(container.querySelector('[data-section="evidence-lightbox"]')).not.toBeNull();
});
