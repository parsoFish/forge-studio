/**
 * AT6 — SERPENTINE RETIRED (R4-13: the project Roadmap tab becomes a dependency
 * DAG, replacing the SerpentineTimeline). Marker: AT6-SERPENTINE-RETIRED.
 *
 * This is a SOURCE / FILESYSTEM gate, not a render test. It uses `node:fs` +
 * a repo-tree grep rather than rendering a component, because the thing it
 * pins is the ABSENCE of code: after F1 deletes the serpentine, no file, no
 * import, and no journey selector for it may survive. A render test cannot
 * assert "this component no longer exists"; only an fs/grep gate can.
 *
 * ── RED-AT-BASE (bd7490bc) ──────────────────────────────────────────────────
 * Three of the four tests below are RED on today's tree — verified before this
 * file was committed:
 *   • forge-ui/components/studio/SerpentineTimeline.tsx EXISTS (11979 bytes).
 *   • forge-ui/app/projects/[id]/page.tsx:23 imports
 *       `{ SerpentineTimeline, STATUS_COLOURS }` from that module, and
 *       lines 1071 / 1122 / 1128 render/reference it.
 * The killed implementation this gate names explicitly: **the SerpentineTimeline
 * left in the tree (dead component) OR a dangling import / usage / journey
 * selector pointing at it after the DAG lands** — the exact rot an "I swapped
 * the JSX but forgot to delete the old file / drop the old import" change
 * leaves behind. Each of those would let R4-13 look done while the serpentine
 * still ships or still poisons the build graph.
 *
 * ── GREEN CONDITION (this file's expiry) ────────────────────────────────────
 * This whole file goes GREEN once F1 (a) deletes SerpentineTimeline.tsx and
 * (b) rewrites page.tsx to the DAG so no source file references
 * `SerpentineTimeline` / `STATUS_COLOURS` any more. It then stands as a
 * permanent regression lock: the serpentine can never quietly return.
 *
 * ── SCOPE NOTE ──────────────────────────────────────────────────────────────
 * This file asserts the serpentine is GONE. It intentionally does NOT assert
 * the DAG is PRESENT (its `data-roadmap-dag` container, topo layout, run-link
 * joins) — those positive contracts are pinned by the DAG render/journey ATs in
 * sibling files, not here. Keeping this gate one-sided (absence only) is what
 * lets it be a clean, un-rottable retirement lock.
 *
 * `STATUS_COLOURS` (British plural) is unique to the serpentine — the shared
 * palette in forge-ui/lib/status-colors.ts exports `STATUS_COLOR` (singular,
 * different token), so grepping the plural has no false-positive collision.
 *
 * RUN: npx vitest run lib/roadmap-serpentine-retired.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Walk up from this test file (forge-ui/lib/) to forge-ui/ (one level) and to
// the repo root (two levels), mirroring the convention in
// forge-ui/lib/flow-artifact-catalog.test.ts.
const HERE = dirname(fileURLToPath(import.meta.url)); // .../forge-ui/lib
const FORGE_UI_ROOT = join(HERE, '..'); // .../forge-ui
const REPO_ROOT = join(HERE, '..', '..'); // repo root
const THIS_FILE = fileURLToPath(import.meta.url);

const SERPENTINE_FILE = join(FORGE_UI_ROOT, 'components', 'studio', 'SerpentineTimeline.tsx');
const JOURNEYS_DIR = join(REPO_ROOT, 'scripts', 'journeys');

const SKIP_DIRS = new Set(['node_modules', '.next', '.turbo', 'dist', 'out', 'coverage', '.git']);

/** Recursively list files under `root` whose name matches `pred`, skipping
 *  build/dep dirs and this very test file. Absolute paths. */
function listFiles(root: string, pred: (name: string) => boolean): string[] {
  const acc: string[] = [];
  if (!existsSync(root)) return acc;
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(full);
      } else if (ent.isFile() && pred(ent.name) && full !== THIS_FILE) {
        acc.push(full);
      }
    }
  };
  walk(root);
  return acc;
}

const isTsSource = (name: string): boolean => /\.tsx?$/.test(name);
const isTestFile = (name: string): boolean => /\.test\.tsx?$/.test(name);
const isJourney = (name: string): boolean => /\.mjs$/.test(name);

/** file:line hits where any line of `content` matches `re`, relative to REPO_ROOT. */
function hits(file: string, content: string, re: RegExp): string[] {
  const out: string[] = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) out.push(`${relative(REPO_ROOT, file)}:${i + 1}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// AT6.1 — the component file is gone.
// RED today (the .tsx exists); GREEN after F1 deletes it.
// ---------------------------------------------------------------------------

test('AT6-SERPENTINE-RETIRED: forge-ui/components/studio/SerpentineTimeline.tsx does NOT exist', () => {
  const present = existsSync(SERPENTINE_FILE);
  // Prove it is a real file (not a stray dir) when the assertion fails, so the
  // message is unambiguous about WHAT still exists.
  const detail = present ? `still present (${statSync(SERPENTINE_FILE).size} bytes)` : 'absent';
  expect(present, `SerpentineTimeline.tsx ${detail} — F1 must delete it`).toBe(false);
});

// ---------------------------------------------------------------------------
// AT6.2 — no forge-ui source file IMPORTS the serpentine module (or its
// STATUS_COLOURS export). Import-scoped so an unrelated doc mention in some
// sibling file can never rot this gate — only an actual `import ... from
// '.../SerpentineTimeline'` (or an import naming the identifiers) counts.
// RED today (page.tsx:23); GREEN after F1 drops the import.
// ---------------------------------------------------------------------------

test('AT6-SERPENTINE-RETIRED: no forge-ui source file imports SerpentineTimeline / STATUS_COLOURS', () => {
  const files = listFiles(FORGE_UI_ROOT, isTsSource);
  // An import line: catches both the module-path form
  //   import { SerpentineTimeline, STATUS_COLOURS } from '@/components/studio/SerpentineTimeline'
  // and any import statement that names either identifier.
  const importOfModule = /from\s+['"][^'"]*\/SerpentineTimeline['"]/;
  const importNamingIdent = /^\s*import\b[^\n]*\b(SerpentineTimeline|STATUS_COLOURS)\b/;
  const offenders: string[] = [];
  for (const f of files) {
    const content = readFileSync(f, 'utf8');
    offenders.push(...hits(f, content, importOfModule));
    offenders.push(...hits(f, content, importNamingIdent));
  }
  const unique = [...new Set(offenders)].sort();
  expect(unique, `serpentine import(s) still present:\n${unique.join('\n')}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// AT6.3 — no NON-TEST forge-ui source file references the serpentine
// identifiers at all (dangling JSX usage / dead constant / stale comment).
// Test files are excluded so this gate never couples to a sibling AT's prose
// (this file and the DAG ATs may legitimately name the retired component in
// their own documentation). The component file itself is NOT excluded — while
// it exists it is a legitimate RED here too, and it disappears with F1.
// RED today (page.tsx:1071/1122/1128 + the component's own body);
// GREEN after F1 rewrites page.tsx to the DAG and deletes the component.
// ---------------------------------------------------------------------------

test('AT6-SERPENTINE-RETIRED: no non-test forge-ui source references SerpentineTimeline / STATUS_COLOURS', () => {
  const files = listFiles(FORGE_UI_ROOT, (n) => isTsSource(n) && !isTestFile(n));
  const identRef = /\b(SerpentineTimeline|STATUS_COLOURS)\b/;
  const offenders: string[] = [];
  for (const f of files) {
    offenders.push(...hits(f, readFileSync(f, 'utf8'), identRef));
  }
  const unique = [...new Set(offenders)].sort();
  expect(unique, `dangling serpentine reference(s):\n${unique.join('\n')}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// AT6.4 — FORWARD ROT-GUARD (green-on-arrival; documents its own expiry).
//
// No journey under scripts/journeys/ may select the serpentine container attr
// `[data-roadmap-timeline]`. This is ALREADY GREEN at base bd7490bc: the
// roadmap journey drives the tab through `[data-roadmap-node]` /
// `[data-section="project-roadmap"]` / `[data-roadmap-popover]` and never
// referenced `data-roadmap-timeline` (that attr lives only on the serpentine's
// own container, SerpentineTimeline.tsx:157, which F1 deletes). It is included
// here — not as a red→green pin — as a standing guard so that when the DAG
// lands with its own `data-roadmap-dag` container, nobody re-introduces or
// leaves a `data-roadmap-timeline` selector behind to rot a journey.
//
// EXPIRY: this test flips RED the moment any journey starts matching
// `data-roadmap-timeline` again. It never needs updating for the DAG cutover
// itself (the DAG's own selector is asserted by the DAG journey AT, not here).
// ---------------------------------------------------------------------------

test('AT6-SERPENTINE-RETIRED (forward guard): no journey selects [data-roadmap-timeline]', () => {
  const journeys = listFiles(JOURNEYS_DIR, isJourney);
  // Sanity: the journeys dir must actually contain journeys, else an empty
  // result would make this "pass" vacuously (env-fakes-the-pass).
  expect(journeys.length, `no journeys found under ${relative(REPO_ROOT, JOURNEYS_DIR)}${sep}`).toBeGreaterThan(0);
  const serpentineSelector = /data-roadmap-timeline/;
  const offenders: string[] = [];
  for (const f of journeys) {
    offenders.push(...hits(f, readFileSync(f, 'utf8'), serpentineSelector));
  }
  const unique = [...new Set(offenders)].sort();
  expect(unique, `journey still selects the retired serpentine container:\n${unique.join('\n')}`).toEqual([]);
});
