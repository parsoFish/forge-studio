/**
 * forge-nk1y.15 — `/monitor` broke dev/UI-CONSTRAINTS.md §2 with a bare
 * 420-px run rail (off the pane scale) and §3 with an unbounded "waiting on
 * you" list stacked between six loose sections. The rail now takes
 * `--pane-xl` and the attention list scrolls inside `--pane-md`; every item
 * stays in the DOM (containment, not pagination).
 *
 * KILLS: the rail back to a bare number (or any height off the scale), the
 * attention list growing the page again, the density ratchet still listing
 * the retired `RUN_RAIL_HEIGHT|420` row.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STUDIO = join(__dirname, '..', '..');
const SRC = readFileSync(join(STUDIO, 'app', 'monitor', 'page.tsx'), 'utf8');

function tagWith(marker: string): string {
  const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = SRC.match(new RegExp(`<[a-z]+\\s[^<>]*${esc}[^<>]*>`));
  expect(m, `${marker} on a tag`).not.toBeNull();
  return m![0];
}

test('the run rail height is the --pane-xl token, never a bare number', () => {
  expect(SRC).not.toMatch(/RUN_RAIL_HEIGHT\s*=\s*\d/);
  expect(tagWith('data-component="monitor-run-rail"')).toMatch(/height: 'var\(--pane-xl\)'/);
});

test('the attention list scrolls inside --pane-md', () => {
  const tag = tagWith('data-component="monitor-attention-list"');
  expect(tag).toMatch(/maxHeight: 'var\(--pane-md\)'/);
  expect(tag).toMatch(/overflowY: 'auto'/);
});

test('the density ratchet no longer lists the retired rail row', () => {
  const ratchet = readFileSync(join(STUDIO, 'tests', 'contract', 'density-tokens.test.ts'), 'utf8');
  expect(ratchet).not.toContain('app/monitor/page.tsx|RUN_RAIL_HEIGHT|420');
});
