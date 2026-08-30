/**
 * file-package-poll-stability-wiring.test.ts — sessions-kinds-R09 (S1), the
 * COMPONENT half of the fix.
 *
 * lib/file-package.test.ts's R09 pins cover the pure half (a `preferredPath`
 * that survives a re-fetched, reference-distinct `files` array). That half is
 * inert unless `FilePackage.tsx` actually stops resetting on array identity
 * and actually threads the operator's pick back in — which is exactly what
 * the live repro measured: `data-active-file` snapped back to file[0] 2s
 * after the click on `/sessions/project-brain/...` (a 3s-polling route),
 * while the same component on the static `/skills/<id>` page held for the
 * full 9s window.
 *
 * WHY SOURCE TEXT, not a render test: forge-ui's vitest `environment` is
 * `node` — no jsdom, no @testing-library (see run-panel-render.test.ts's
 * header, which pins the same boundary). `renderToStaticMarkup` runs neither
 * effects nor click handlers, so the poll-tick reset is unreachable from a
 * render assertion. This mirrors the source-text technique already used by
 * lib/knowledge-page-tabs.test.ts et al.
 *
 * RUN: cd forge-ui && npx vitest run lib/file-package-poll-stability-wiring.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPONENT_PATH = resolve(__dirname, '../components/studio/FilePackage.tsx');
const rawSource = readFileSync(COMPONENT_PATH, 'utf8');

/** CODE only — `//` and block comments stripped. The component's own header
 *  quotes the defective effect verbatim (so the next reader knows what was
 *  retired and why), and a comment must never satisfy or violate a wiring
 *  assertion about what the component actually DOES. */
const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

test('R09 wiring: FilePackage does NOT re-derive its tab state from an effect keyed on the `files` ARRAY IDENTITY — the poll tick that wiped the operator selection', () => {
  // The defect verbatim: `useEffect(() => { setState(filePackageTabs(files)); }, [files])`.
  // `files` is a brand-new array every SHELL_POLL_MS tick, so this fires on
  // every poll and snaps the strip back to index 0.
  expect(
    source,
    'an effect with `files` in its dependency array fires on every 3s poll tick — GenerationGallery.tsx already retired exactly this shape (R4-16 round 2, pin 3)',
  ).not.toMatch(/useEffect\([\s\S]*?\[\s*files\s*\]\s*\)/);
});

test('R09 wiring: FilePackage threads the operator-selected PATH back into filePackageTabs, so the selection is re-applied by value on every re-derivation', () => {
  expect(
    source,
    'filePackageTabs(files) must be called with the remembered path as its second argument, mirroring generationGalleryView(artifact, preferredNumber)',
  ).toMatch(/filePackageTabs\(\s*files\s*,/);
});
