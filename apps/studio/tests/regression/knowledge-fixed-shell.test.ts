/**
 * forge-nk1y.19 — `/knowledge` is a fixed shell (dev/UI-CONSTRAINTS.md §1):
 * exactly one viewport, the panes scroll inside, the page never does. It
 * measured 2,002 px at S6 beat 14: the root said `minHeight: '100vh'`, so it
 * grew with its tallest pane and `overflow: hidden` on a growing box clipped
 * nothing. A fixed shell is `height: 100vh` + `overflow: hidden`, and every
 * tab body is a `flex: 1; minHeight: 0` scroller so it takes the space left
 * and scrolls inside it.
 *
 * KILLS: the root (or its Suspense fallback) back to `minHeight: '100vh'`;
 * a tab body without `minHeight: 0` (a flex child's min-height is its
 * content, so it would push past the viewport and be clipped unreachable);
 * a tab body that clips without scrolling.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', '..', 'app', 'knowledge', 'page.tsx'), 'utf8');

/** Every opening JSX tag carrying `marker` — tags, never comments. */
function tagsWith(marker: string): string[] {
  const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return SRC.match(new RegExp(`<[a-z]+\\s[^<>]*${esc}[^<>]*>`, 'g')) ?? [];
}

test('no main on this route grows past the viewport', () => {
  expect(SRC).not.toMatch(/minHeight: '100vh'/);
  const mains = tagsWith('data-page="knowledge"');
  expect(mains.length).toBe(2); // the page and its Suspense fallback
  for (const m of mains) {
    expect(m).toMatch(/height: '100vh'/);
    expect(m).toMatch(/overflow: 'hidden'/);
  }
});

test.each([
  ['the explore body', 'data-tab-body="explore"', /overflow: 'hidden'/],
  ['the health body', 'data-tab-body="health"', /overflowY: 'auto'/],
  ['the ingest-activity body', 'data-component="ingest-activity"', /overflowY: 'auto'/],
])('%s takes the space left and scrolls inside it', (_name, marker, overflow) => {
  const [tag] = tagsWith(marker);
  expect(tag, `${marker} on a tag`).toBeDefined();
  expect(tag).toMatch(/flex: 1/);
  expect(tag).toMatch(/minHeight: 0/);
  expect(tag).toMatch(overflow);
});
