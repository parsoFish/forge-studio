// @vitest-environment jsdom
/**
 * `RebuildContractPanel`'s drift report — bead forge-mfv5.3.1/forge-mfv5.3.2:
 * the operator surface for "what is this element FOR, and does it still work"
 * (`packages/projects/reset-report.ts`'s `purpose`/`verdict` per row, and
 * `DriftReport.appTypeNote` for the new "no app type needed" outcome). Before
 * this, the panel rendered only `section` + `action` per row and nothing at
 * all about app-type resolution beyond the `needs-app-type` picker — an
 * operator reading the preview had no way to tell what a row was for or
 * whether a checked element (skills resolution, the demo declaration) was
 * actually healthy.
 *
 * Renders the REAL component via `createRoot`/`act` (jsdom), mocking
 * `@/lib/studio-client-reset` directly — the same shape
 * `contract-resolution-instructions-mint.test.ts` uses for a component whose
 * relevant markup only exists after a click's async result lands, which
 * `renderToStaticMarkup`'s one-shot render cannot reach.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const preview = vi.fn();

vi.mock('@/lib/studio-client-reset', () => ({
  previewProjectContractReset: (...args: unknown[]) => preview(...args),
  applyProjectContractReset: vi.fn(async () => ({ ok: false })),
}));

import { RebuildContractPanel } from '@/components/studio/project-builder/RebuildContractPanel';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  preview.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderAndPreview() {
  await act(async () => {
    root.render(React.createElement(RebuildContractPanel, { projectId: 'gitpulse' }));
  });
  const button = container.querySelector<HTMLButtonElement>('[data-action="rebuild-contract"]');
  await act(async () => {
    button!.click();
  });
  await act(async () => {});
}

const ROW_WITH_VERDICT = {
  section: 'skills',
  before: ['a'],
  after: ['a'],
  action: 'unchanged',
  purpose: 'The project-specific skills an agent loads when working this project.',
  verdict: { pass: true, detail: '1 declared skill(s) all resolve to a SKILL.md' },
};

const ROW_WITHOUT_VERDICT = {
  section: 'testProcess.local',
  before: { cmd: ['npm', 'test'] },
  after: { cmd: ['npm', 'test'] },
  action: 'unchanged',
  purpose: 'The command a developer runs locally to check their own work before pushing.',
};

test('every drift row renders its purpose', async () => {
  preview.mockResolvedValue({ ok: true, drift: { projectId: 'gitpulse', appType: 'cli', rows: [ROW_WITH_VERDICT, ROW_WITHOUT_VERDICT], skillMoves: [] } });
  await renderAndPreview();

  const skillsRow = container.querySelector('[data-drift-row="skills"]');
  const localRow = container.querySelector('[data-drift-row="testProcess.local"]');
  expect(skillsRow!.querySelector('[data-drift-purpose]')?.textContent).toBe(ROW_WITH_VERDICT.purpose);
  expect(localRow!.querySelector('[data-drift-purpose]')?.textContent).toBe(ROW_WITHOUT_VERDICT.purpose);
});

test('a row WITH a verdict renders data-drift-verdict="pass"/"fail" and the detail text; a row without one renders neither', async () => {
  preview.mockResolvedValue({ ok: true, drift: { projectId: 'gitpulse', appType: 'cli', rows: [ROW_WITH_VERDICT, ROW_WITHOUT_VERDICT], skillMoves: [] } });
  await renderAndPreview();

  const skillsRow = container.querySelector('[data-drift-row="skills"]');
  const verdictEl = skillsRow!.querySelector('[data-drift-verdict]');
  expect(verdictEl?.getAttribute('data-drift-verdict')).toBe('pass');
  expect(verdictEl?.textContent).toBe(ROW_WITH_VERDICT.verdict.detail);

  const localRow = container.querySelector('[data-drift-row="testProcess.local"]');
  expect(localRow!.querySelector('[data-drift-verdict]')).toBeNull();
});

test('a FAILING verdict renders data-drift-verdict="fail"', async () => {
  const failing = { ...ROW_WITH_VERDICT, verdict: { pass: false, detail: 'missing SKILL.md for x' } };
  preview.mockResolvedValue({ ok: true, drift: { projectId: 'gitpulse', appType: 'cli', rows: [failing], skillMoves: [] } });
  await renderAndPreview();

  const el = container.querySelector('[data-drift-verdict]');
  expect(el?.getAttribute('data-drift-verdict')).toBe('fail');
  expect(el?.textContent).toBe('missing SKILL.md for x');
});

test('appTypeNote renders data-app-type-note with the note text, when present', async () => {
  preview.mockResolvedValue({
    ok: true,
    drift: { projectId: 'gitpulse', appType: null, appTypeNote: 'no app type needed: every section is hand-authored', rows: [ROW_WITHOUT_VERDICT], skillMoves: [] },
  });
  await renderAndPreview();

  const note = container.querySelector('[data-app-type-note]');
  expect(note).not.toBeNull();
  expect(note!.textContent).toBe('no app type needed: every section is hand-authored');
});

test('no appTypeNote in the response -> no data-app-type-note element rendered at all', async () => {
  preview.mockResolvedValue({ ok: true, drift: { projectId: 'gitpulse', appType: 'cli', rows: [ROW_WITHOUT_VERDICT], skillMoves: [] } });
  await renderAndPreview();

  expect(container.querySelector('[data-app-type-note]')).toBeNull();
});
