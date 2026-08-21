/**
 * W7-C3 (crosscut-06) — per-route browser-tab titles.
 *
 * Every page in Studio rendered the identical tab title "forge"
 * (app/layout.tsx's single static metadata; no route override, no runtime
 * document.title). The fix is ONE derivation — `formatDocumentTitle` — used
 * by the `useDocumentTitle` hook that the two shared shells (`StudioPage`,
 * `StudioArchitectShell`) and the non-shell detail pages call:
 *
 *   formatDocumentTitle(['gitpulse', 'Projects'])  → "gitpulse · Projects · forge"
 *   formatDocumentTitle(['Flows'])                 → "Flows · forge"
 *
 * The shells are pinned by source (they call the hook); pages that bypass
 * the shells call the hook themselves — pinned by the crosscut journey beat.
 *
 * RUN: cd forge-ui && npx vitest run lib/document-title.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatDocumentTitle } from './document-title';

test('joins parts with a middle dot and always ends in the product name', () => {
  expect(formatDocumentTitle(['gitpulse', 'Projects'])).toBe('gitpulse · Projects · forge');
  expect(formatDocumentTitle(['Flows'])).toBe('Flows · forge');
});

test('empty/blank parts are dropped, never rendered as a dangling separator', () => {
  expect(formatDocumentTitle(['', 'Projects'])).toBe('Projects · forge');
  expect(formatDocumentTitle(['  ', ''])).toBe('forge');
  expect(formatDocumentTitle([])).toBe('forge');
});

test('both shared shells call useDocumentTitle (source pin)', () => {
  for (const shell of ['../components/StudioPage.tsx', '../components/StudioArchitectShell.tsx']) {
    const src = readFileSync(resolve(__dirname, shell), 'utf8');
    expect(src, `${shell} must derive the per-route document title`).toMatch(/useDocumentTitle/);
  }
});
