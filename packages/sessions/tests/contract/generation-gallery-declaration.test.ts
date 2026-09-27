/**
 * The demo-builder's generation gallery carries each generation's DECLARATION
 * (bead forge-mfv5.2.8): the `demoProcess` steps its `demo-process.json`
 * snapshot proposes, so the Studio demo page can show — and lock — the
 * declaration itself, not only a list of files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveSessionArtifact } from '../../studio/session-transcript.ts';
import { demoDescriptor, makeTmpDir, parseManifest, writeGeneration } from './test-fixtures/transcript-test-helpers.ts';

type Gallery = { generations: Array<{ number: number; declaration: unknown }> };
const derive = (sessionDir: string) => deriveSessionArtifact({ parseManifest, descriptor: demoDescriptor(), sessionDir }) as unknown as Gallery;

test('a generation carries the steps its demo-process.json snapshot declares', () => {
  const sessionDir = makeTmpDir('gengallery-declaration-');
  const steps = [
    { kind: 'capture', text: 'Run `npm run demo`.', element: 'cli-capture' },
    { kind: 'verify', text: 'It holds.' },
  ];
  writeGeneration(sessionDir, 1, { files: { 'DEMO.html': '<html/>', 'demo-process.json': JSON.stringify(steps) } });
  assert.deepEqual(derive(sessionDir).generations[0]?.declaration, steps);
});

test('a missing, unparsable or mis-shaped declaration is null — never a guessed one', () => {
  const sessionDir = makeTmpDir('gengallery-declaration-bad-');
  writeGeneration(sessionDir, 1, { files: { 'DEMO.html': '<html/>' } });
  writeGeneration(sessionDir, 2, { files: { 'DEMO.html': '<html/>', 'demo-process.json': '{not json' } });
  writeGeneration(sessionDir, 3, { files: { 'DEMO.html': '<html/>', 'demo-process.json': JSON.stringify([{ kind: 'capture' }]) } });
  assert.deepEqual(derive(sessionDir).generations.map((g) => g.declaration), [null, null, null]);
});
