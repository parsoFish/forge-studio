/**
 * Acceptance test — the Run control on `/agents/[id]` is reachable without
 * scrolling past the YAML preview and the readiness list (W8-B1, ON-8).
 *
 * The defect: `RunPanel` rendered third in the right column, after
 * `YamlPreview` and `ReadinessPanel`, in normal flow with no pinning. On a
 * real agent (a long declaration, a long readiness list) the one control the
 * page exists for was below the fold, and nothing in the page said so.
 *
 * These are STRUCTURAL assertions over the page source rather than a render
 * assertion, because the page is a hook-driven client component with no
 * jsdom in this repo to mount it in — the same shape
 * `scripts/home-no-new-polling.test.ts` uses to pin a wiring fact. What they
 * pin is order and pinning, which is exactly what regressed.
 *
 * RUN: npx vitest run lib/agent-run-reachable.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_PAGE = join(UI_ROOT, 'app', 'agents', '[id]', 'page.tsx');
const RUN_PANEL = join(UI_ROOT, 'components', 'studio', 'agent-builder', 'RunPanel.tsx');

const pageSrc = readFileSync(AGENT_PAGE, 'utf8');
const runPanelSrc = readFileSync(RUN_PANEL, 'utf8');

test('RunPanel renders BEFORE the YAML preview and the readiness panel', () => {
  // Kills the shipped order (YamlPreview → ReadinessPanel → RunPanel), where
  // the Run control sat third in a scrolling column.
  const run = pageSrc.indexOf('<RunPanel');
  const yaml = pageSrc.indexOf('<YamlPreview');
  const readiness = pageSrc.indexOf('<ReadinessPanel');
  expect(run).toBeGreaterThan(-1);
  expect(yaml).toBeGreaterThan(-1);
  expect(readiness).toBeGreaterThan(-1);
  expect(run).toBeLessThan(yaml);
  expect(run).toBeLessThan(readiness);
});

test('the page mounts exactly ONE RunPanel — reachability is not bought with a second control', () => {
  // Kills the obvious wrong fix: leaving the panel where it was and adding a
  // duplicate Run button at the top. Two controls for one action is its own
  // defect (the operator cannot tell which one is authoritative).
  expect((pageSrc.match(/<RunPanel\b/g) ?? []).length).toBe(1);
});

test('RunPanel declares exactly one dispatch control', () => {
  // Same class, one level down: a single `data-action="run-agent"` button.
  // Counted as a JSX ATTRIBUTE (a line that is only the attribute), not as a
  // substring — the file's own header comment names the attribute too, and a
  // naive substring count reads that documentation as a second control. A
  // count that cannot tell code from prose is not a count.
  const dispatchControls = runPanelSrc
    .split('\n')
    .filter((line) => /^\s*data-action="run-agent"\s*$/.test(line));
  expect(dispatchControls).toHaveLength(1);
});

test('the panel is pinned to its scroll container, reusing the existing sticky idiom', () => {
  // Kills a silent revert to plain flow positioning: first-in-column alone
  // stops being enough the moment the column scrolls.
  expect(runPanelSrc).toMatch(/position:\s*'sticky'/);
  expect(runPanelSrc).toMatch(/top:\s*0/);
});

test('the pinned panel is height-bounded and scrolls internally', () => {
  // Kills an unbounded sticky panel: taller than the viewport, sticky pins
  // its TOP and pushes its own primary button off the bottom — the same
  // unreachable-control defect wearing a different hat.
  expect(runPanelSrc).toMatch(/maxHeight:\s*'calc\(100vh/);
  expect(runPanelSrc).toMatch(/overflowY:\s*'auto'/);
});
