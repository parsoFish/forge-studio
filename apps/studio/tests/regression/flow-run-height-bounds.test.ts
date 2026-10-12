/**
 * forge-nk1y.18 — the flow-run page measured 3,899 px at S10 beat 23 against
 * a scrolling-page budget of 3 viewports (dev/UI-CONSTRAINTS.md §1). Two
 * things grew with the run: an expanded node's log (every line, unbounded)
 * and the review findings (every finding with its evidence). §3.3: raw
 * logs and long text go in a `--pane-*` box. Both are contained at the call
 * site — `RunLog` and `ReviewFindingsPanel` are shared (the standalone run
 * view and the verdict gate contain them their own way) and stay unchanged.
 * Containment, never pagination: S10 reads `timeline-row`, `node-id`,
 * `review-findings` and finding rows by attribute, so every row stays in the
 * DOM, and the run controls and failures are never collapsed (§3.4).
 *
 * KILLS: a node log or the findings panel back to an unbounded height, a
 * contained height off the pane scale, or the containment moved inside the
 * shared component (changing the gate and run view with it).
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STUDIO = join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(STUDIO, rel), 'utf8');

/** The opening JSX tag carrying `marker` — a tag, never a mention in a comment. */
function styleOf(src: string, marker: string): string {
  const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = src.match(new RegExp(`<[a-z]+\\s[^<>]*${esc}[^<>]*>`));
  expect(m, `${marker} on a tag`).not.toBeNull();
  return m![0];
}

test.each([
  ['data-section="node-log"', 'lg'],
  ['data-section="run-findings-pane"', 'xl'],
])('FlowRunDetail: %s is contained at --pane-%s', (marker, pane) => {
  const style = styleOf(read('components/studio/FlowRunDetail.tsx'), marker);
  expect(style).toMatch(new RegExp(`maxHeight: 'var\\(--pane-${pane}\\)'`));
  expect(style).toMatch(/overflowY: 'auto'/);
});

test('the findings pane wraps the shared panel; the shared components carry no height of their own', () => {
  const src = read('components/studio/FlowRunDetail.tsx');
  const pane = src.slice(src.indexOf('data-section="run-findings-pane"'));
  expect(pane.indexOf('<ReviewFindingsPanel')).toBeGreaterThan(-1);
  expect(pane.indexOf('<ReviewFindingsPanel')).toBeLessThan(pane.indexOf('</div>'));
  expect(read('components/studio/RunLog.tsx')).not.toMatch(/maxHeight/);
  expect(read('components/ReviewFindingsPanel.tsx')).not.toMatch(/maxHeight/);
});
