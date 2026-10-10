/**
 * Density tokens — dev/UI-CONSTRAINTS.md §2, DECISIONS D-46.
 *
 * Pins, computed from the REAL sources (no fixture copy):
 *   1. The scale exists in `app/globals.css` with the approved values:
 *      space-1…6, text-xs…xl, pane-xs…xl.
 *   2. A RATCHET on bare contained heights: every `maxHeight: <n>` and every
 *      `height:`/`minHeight: <n>` (or `*_HEIGHT = <n>` constant) of 120 or more in Studio source (and the
 *      `max-height`/`height`/`min-height` px equivalents in globals.css) must
 *      be listed in OFF_SCALE below. A new bare value fails; a listed value
 *      that is gone fails until its row is deleted, so the list only shrinks.
 *      Migrating a row means `'var(--pane-*)'` — and since operator ruling
 *      R45 the migration is zero-pixel: only values already on the pane scale
 *      move; the off-scale rows wait for the 1.x surface redesigns.
 *
 * Why a ratchet and not a style rule: the S10 how-to reached 43,436 px and
 * Studio grew five ad-hoc contained heights with no scale (operator ruling
 * R30, recorded); a scale nobody is held to drifts back the same way.
 *
 * RUN: npm run test:ui (this file: apps/studio/tests/contract/density-tokens.test.ts)
 */
import { test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const STUDIO = resolve(__dirname, '../..');
const css = readFileSync(join(STUDIO, 'app/globals.css'), 'utf8');

const SCALE: Record<string, string> = {
  '--space-1': '4px', '--space-2': '8px', '--space-3': '12px',
  '--space-4': '16px', '--space-5': '24px', '--space-6': '32px',
  '--text-xs': '11px', '--text-sm': '12px', '--text-base': '13px',
  '--text-md': '14px', '--text-lg': '17px', '--text-xl': '22px',
  '--pane-xs': '80px', '--pane-sm': '160px', '--pane-md': '240px',
  '--pane-lg': '320px', '--pane-xl': '480px',
};

/**
 * The bare contained heights left at R45, as `file|prop|value`, one entry per
 * occurrence. Off the pane scale unless the note says why a token is wrong.
 */
const OFF_SCALE: readonly string[] = [
  'app/artifact/page.tsx|height|340',
  'app/connections/[id]/page.tsx|maxHeight|200',
  'app/connections/[id]/page.tsx|maxHeight|200',
  'app/monitor/page.tsx|RUN_RAIL_HEIGHT|420',
  'components/DemoReviewSurface.tsx|height|340',
  'components/studio/ActivityLog.tsx|maxHeight|260',
  'components/studio/FlowTopology.tsx|minHeight|260',
  'components/studio/HistoryLedger.tsx|maxHeight|220',
  'components/studio/PhaseDrawer.tsx|maxHeight|220',
  'components/studio/RoadmapCanvas.tsx|VIEWPORT_HEIGHT|560',
  // a 160×160 verdict badge, not a contained pane: a pane token would misname it
  'components/studio/artifact/VerdictRenderer.tsx|height|160',
  'components/studio/knowledge/KbDrainPanel.tsx|maxHeight|260',
  'components/studio/knowledge/ThemeList.tsx|maxHeight|260',
  'components/studio/project-builder/Instructions.tsx|maxHeight|460',
  'components/studio/project-builder/SkillsBind.tsx|maxHeight|220',
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'tests') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

/** Every bare contained height in `text`, as `prop|value`. */
function bareHeights(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(/\b(maxHeight|minHeight|height)\s*:\s*(\d+(?:\.\d+)?)\b(?!\s*[%a-z])/g)) {
    if (m[1] === 'maxHeight' || Number(m[2]) >= 120) hits.push(`${m[1]}|${m[2]}`);
  }
  for (const m of text.matchAll(/\b([A-Z][A-Z_]*_HEIGHT)\s*=\s*(\d+)\b/g)) {
    if (Number(m[2]) >= 120) hits.push(`${m[1]}|${m[2]}`);
  }
  return hits;
}

/** The same rule for CSS: `max-height: <n>px` always, `height`/`min-height` from 120px. */
function bareCssHeights(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(/(?<![-\w])(max-height|min-height|height)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
    if (m[1] === 'max-height' || Number(m[2]) >= 120) hits.push(`${m[1]}|${m[2]}`);
  }
  return hits;
}

test('the density scale is defined with the approved values', () => {
  for (const [name, value] of Object.entries(SCALE)) {
    const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
    expect(m?.[1].trim(), name).toBe(value);
  }
});

test('the detector sees the shapes it claims and ignores the rest', () => {
  expect(bareHeights("{ maxHeight: 80, height: 160, minHeight: 36, height: '50%' }")).toEqual(['maxHeight|80', 'height|160']);
  expect(bareHeights("{ maxHeight: 'var(--pane-lg)' }")).toEqual([]);
  expect(bareHeights('const RUN_RAIL_HEIGHT = 420; const CAP_HEIGHT = 26;')).toEqual(['RUN_RAIL_HEIGHT|420']);
  expect(bareCssHeights('.a { max-height: 80px; line-height: 200px; height: 64px; min-height: 160px }')).toEqual(['max-height|80', 'min-height|160']);
});

test('no bare contained height outside the shrinking OFF_SCALE list', () => {
  const found: string[] = [];
  for (const file of sourceFiles(STUDIO)) {
    const rel = relative(STUDIO, file).split('\\').join('/');
    for (const hit of bareHeights(readFileSync(file, 'utf8'))) found.push(`${rel}|${hit}`);
  }
  for (const hit of bareCssHeights(css)) found.push(`app/globals.css|${hit}`);
  expect(found.sort(), 'a new bare height: use var(--pane-*) (dev/UI-CONSTRAINTS.md §2); a migrated one: delete its OFF_SCALE row').toEqual([...OFF_SCALE].sort());
});
