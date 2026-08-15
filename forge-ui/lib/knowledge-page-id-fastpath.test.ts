/**
 * knowledge-page-id-fastpath.test.ts — W6-P4: pins the Knowledge page's
 * ?id= fast path — a direct id deep-link no longer waits a full round-trip
 * behind the kbs-list fetch before kb-detail (and, on a ?tab=ingest-activity
 * deep link, IngestActivityPanel) can start fetching.
 *
 * `/knowledge`'s page.tsx cannot be render-tested via `renderToStaticMarkup`
 * (`useSearchParams` + effect-gated `currentId` never resolve outside a real
 * app router — proven by spike, see
 * `./knowledge-page-kb-maintenance.test.ts`'s header for the full
 * reasoning). This file follows the same established source-text technique
 * as its siblings (`./knowledge-page-empty-state-wiring.test.ts`,
 * `./knowledge-page-tabs.test.ts`, `./knowledge-page-kb-maintenance.test.ts`).
 *
 * RUN: cd forge-ui && npx vitest run lib/knowledge-page-id-fastpath.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_PATH = resolve(__dirname, '../app/knowledge/page.tsx');
const source = readFileSync(PAGE_PATH, 'utf8');

describe('knowledge page — ?id= optimistic fast path (W6-P4)', () => {
  it('sets currentId from a direct ?id= BEFORE the kbs roster has settled (not gated on kbListReady/allKbs first)', () => {
    expect(source).toMatch(/if\s*\(idParam\)\s*{[\s\S]{0,600}if\s*\(!kbListReady\)\s*{[\s\S]{0,150}setCurrentId\(idParam\)/);
  });

  it('still corrects away from a STALE ?id= once the roster settles — falls back to the first KB, never a phantom selection', () => {
    expect(source).toMatch(/allKbs\.some\(\(k\) => k\.id === idParam\)/);
    expect(source).toMatch(/allKbs\.some\(\(k\) => k\.id === idParam\)[\s\S]{0,300}allKbs\.length > 0[\s\S]{0,150}setCurrentId\(allKbs\[0\]\.id\)/);
  });

  it('clears a stale optimistic id back to \'\' when the roster settles genuinely empty, so the empty-state branch is still reachable', () => {
    expect(source).toMatch(/if\s*\(currentId\)\s*setCurrentId\(''\)/);
  });

  it('the W6-IA-4 empty-state branch (kbListReady && allKbs.length === 0 → setReady(true)) is still intact, unmodified', () => {
    expect(source).toMatch(/kbListReady\s*&&\s*allKbs\.length === 0[\s\S]{0,80}setReady\(true\)/);
  });

  it('the kbs-list fetch effect still fires first/unconditionally, unchanged by the fast path', () => {
    expect(source).toContain('fetchStudioKbs()');
    expect(source).toMatch(/setKbListReady\(true\)/);
  });
});
