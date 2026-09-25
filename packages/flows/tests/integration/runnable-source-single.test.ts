/**
 * `forge-8vfn.7.6.132` — the three surfaces READ the shared rule, and none
 * re-derives it. T1 ruling 1124: "one predicate for one convention, never three
 * hand copies."
 *
 * THE DEFECT WAS THE COPIES, not any one of them. `enqueueFlowRun` has always
 * claimed a `ready-for-review` manifest of a DIFFERENT flow — the architect
 * hand-off, named in its own comment. Three surfaces each wrote their own
 * narrower test and all three drifted the same way:
 *
 *     RoadmapCanvas.tsx       status === 'pending' && ready && planned
 *     kickoff-candidates.ts   if (r.status !== 'planned') continue
 *     planned-initiatives.ts  listed _queue/pending/ only
 *
 * So a source door is the right shape: a fourth surface added next month, or an
 * edit that "simplifies" a call back into a literal comparison, reds here rather
 * than being discovered by a funded story run nineteen attempts later.
 *
 * IT ASSERTS THE IMPORT, NOT THE ABSENCE OF THE STRING. Each surface still has
 * its own additional policy — the picker refuses `done`/`failed` (W7-FIX-A3),
 * the card keeps its `ready && planned` gates — and those are legitimate
 * narrowings ON TOP of the shared rule. Banning every status comparison would
 * red on the policies this bead deliberately preserved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * The files that APPLY the rule. `RoadmapCanvas.tsx` is deliberately NOT here:
 * under T1 1134 the roadmap card reads a boolean derived server-side
 * (`bridge-studio.ts` → `RoadmapInitiative.canStartDevelopment`) rather than
 * re-applying the rule in the browser, which is what took that already-exempted
 * file DOWN a line instead of up. So the third consumer is the bridge, and a
 * door listing the card would pin a coupling the design removed.
 */
const SURFACES = [
  'packages/flows/planned-initiatives.ts',
  'apps/studio/lib/kickoff-candidates.ts',
  'apps/forge/bridge-studio.ts',
];

test('7.6.132: every develop-kickoff surface imports the shared predicate', () => {
  for (const rel of SURFACES) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.match(
      // The ONE rule, read either through contracts' door (forge-8vfn.5.31: external
      // consumers import `@forge/contracts`) or from its own module inside the package.
      src, /import \{[^}]*isRunnableSource[^}]*\} from ['"](?:@forge\/contracts|[^'"]*runnable-source\.ts)['"]/,
      `${rel} must read the ONE rule rather than re-derive it — three hand copies is how all three `
      + 'drifted from the server, and a fourth surface would drift the same way',
    );
  }
});

test('7.6.132: the predicate has exactly ONE definition', () => {
  // A second `export function isRunnableSource` anywhere is the copy this bead
  // exists to prevent, and it would typecheck perfectly.
  const defs = SURFACES.concat([
    'packages/contracts/runnable-source.ts',
    'packages/flows/enqueue-flow-run.ts',
    'apps/studio/components/studio/RoadmapCanvas.tsx',
  ]).filter((rel) => /export function isRunnableSource/.test(readFileSync(join(ROOT, rel), 'utf8')));
  assert.deepEqual(defs, ['packages/contracts/runnable-source.ts'],
    'exactly one file may DEFINE the rule; enqueue-flow-run re-exports it so the rule still reads beside its implementation');
});

test('7.6.132: the pure module stays pure — a client bundle has to import it', () => {
  // MEASURED, not anticipated: both typechecks passed and `npm run build` failed
  // with three UnhandledSchemeErrors when this rule lived in `enqueue-flow-run.ts`,
  // because `RoadmapCanvas.tsx` is a 'use client' component and webpack refuses
  // the `node:` scheme in a browser graph. Any node import added here breaks the
  // studio build, and that break is far from this file.
  const src = readFileSync(join(ROOT, 'packages/contracts/runnable-source.ts'), 'utf8');
  assert.doesNotMatch(src, /from ['"]node:/, 'a node: import here breaks the studio build');
  assert.doesNotMatch(src, /^import /m, 'the module is deliberately importless — keep it that way');
});
