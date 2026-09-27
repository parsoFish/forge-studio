/**
 * The demo page shows — and locks — the DECLARATION (bead forge-mfv5.2.8).
 * A demo-builder generation is the `demoProcess` steps it proposes; locking
 * one writes them into `.forge/project.json`. The gallery renders the selected
 * generation's steps under `[data-section="generation-declaration"]`, says
 * whether they drive a checkpoint under the SAME rule the lock and `forge
 * preflight`'s DEMO-SKILL clause apply (`declarationDrivesCheckpoint`), and
 * keeps the lock control disabled, with the rule's reason, when they do not.
 *
 * RUN: npx vitest run --root apps/studio apps/studio/tests/contract/GenerationDeclaration.test.ts
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { GenerationGallery } from '../../components/studio/GenerationGallery';
import type { GenerationGalleryArtifact, GenerationGalleryEntry } from '@/lib/session-client';

function gallery(declaration: GenerationGalleryEntry['declaration']): GenerationGalleryArtifact {
  return {
    kind: 'generation-gallery',
    label: 'Demo generations',
    sourcesScanned: [],
    generations: [{ number: 1, createdAt: '2026-09-27T00:00:00Z', feedback: null, targetElement: null, declaration, items: [] }],
  };
}

function render(artifact: GenerationGalleryArtifact): string {
  return renderToStaticMarkup(
    React.createElement(GenerationGallery, {
      artifact, project: 'p', sessionId: 's', selection: null, onSelect: () => {}, onFinalize: () => {},
    }),
  );
}

function finalizeTag(html: string): string {
  const idx = html.indexOf('data-action="finalize-generation"');
  expect(idx).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf('<button', idx), html.indexOf('>', idx) + 1);
}

test('a drivable declaration renders its steps and a live lock control', () => {
  const html = render(gallery([
    { kind: 'capture', text: 'Run `npm run demo` on both trees.', element: 'cli-capture' },
    { kind: 'verify', text: 'The report lists every file.' },
  ]));
  expect(html).toContain('data-section="generation-declaration"');
  expect(html).toContain('data-declaration-state="drivable"');
  expect(html).toContain('data-declaration-steps="2"');
  expect(html).toContain('data-declaration-step="0"');
  expect(html).toContain('data-step-kind="capture"');
  expect(html).toContain('Run `npm run demo` on both trees.');
  expect(finalizeTag(html)).not.toContain('disabled');
});

test('an undrivable declaration names the rule\'s reason and keeps the lock disabled with it', () => {
  const html = render(gallery([{ kind: 'capture', text: 'Show it somehow.' }]));
  expect(html).toContain('data-declaration-state="undrivable"');
  expect(html).toContain('no inline-code span to run');
  const tag = finalizeTag(html);
  expect(tag).toContain('disabled');
  expect(tag).toContain('data-disabled-reason="This declaration drives no checkpoint');
});

test('a generation with no declaration says so and cannot be locked', () => {
  const html = render(gallery(null));
  expect(html).toContain('data-declaration-state="missing"');
  expect(html).toContain('data-declaration-steps="0"');
  expect(finalizeTag(html)).toContain('disabled');
});
