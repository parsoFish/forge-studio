/**
 * SPEC §6: readiness is ONE function. Studio's `ContractReadiness` and the
 * claim gate both call `projectReadiness` from `@forge/contracts`, and neither
 * re-implements its rules. A forked copy (a local `northStar.length <= 200`, a
 * hand-rolled capture+verify scan) would let the gate refuse something Studio
 * shows as ready — or admit something it shows as not.
 *
 * Source-reading, as `runnable-source-single.test.ts` is: the rule's literals
 * (`140`, `'capture'`, `'verify'`) must not appear in either consumer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const CONSUMERS = [
  'apps/studio/components/studio/project-builder/ContractReadiness.tsx',
  'packages/flows/claim-validator.ts',
] as const;

/** Source with comments removed, so prose that explains the rule is not mistaken for the rule. */
function code(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

for (const rel of CONSUMERS) {
  test(`${rel} imports projectReadiness from @forge/contracts and calls it`, () => {
    const src = code(rel);
    assert.match(src, /import\s*\{[^}]*\bprojectReadiness\b[^}]*\}\s*from\s*'@forge\/contracts'/, 'must import the one function');
    assert.match(src, /\bprojectReadiness\(/, 'must call it');
  });

  test(`${rel} does not re-implement the 140-char or capture+verify rule`, () => {
    const src = code(rel);
    assert.doesNotMatch(src, /\b140\b/, 'a 140-char literal means the north-star rule was forked');
    assert.doesNotMatch(src, /'capture'|"capture"/, "a 'capture' literal means the demo rule was forked");
    assert.doesNotMatch(src, /'verify'|"verify"/, "a 'verify' literal means the demo rule was forked");
    assert.doesNotMatch(src, /northStar[^;\n]*\.length\s*[<>]/, 'a north-star length comparison means the rule was forked');
  });
}

test('the rule itself lives in exactly one place: packages/contracts/project-readiness.ts', () => {
  const src = code('packages/contracts/project-readiness.ts');
  assert.match(src, /\b140\b/);
  assert.match(src, /'capture'/);
  assert.match(src, /'verify'/);
});

// Both callers feed `projectReadiness` the SAME clause set: the preflight run WITH
// the runnable-gate (DEPS) clause. Studio's route and the claim gate each name it.
for (const rel of ['packages/projects/project-preflight-read.ts', 'packages/flows/claim-validator.ts']) {
  test(`${rel} runs preflight with requireRunnableGate: true, so DEPS counts in Studio exactly as at the claim`, () => {
    assert.match(code(rel), /runPreflight\([^)]*requireRunnableGate:\s*true/);
  });
}
