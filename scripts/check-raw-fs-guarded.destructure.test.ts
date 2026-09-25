/**
 * check-raw-fs-guarded.destructure.test.ts — TDD contract for
 * check-raw-fs-guarded.destructure.mjs (bead forge-8vfn.5.63), split out of
 * check-raw-fs-guarded.test.ts to respect the 800-line file-size baseline
 * (same reason check-raw-fs-guarded.allowlist.test.ts and
 * check-raw-fs-guarded.scope.test.ts are separate files, not sections of the
 * main suite).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeModule } from './check-raw-fs-guarded.mjs';
import { destructuredNames, findDestructureBinding } from './check-raw-fs-guarded.destructure.mjs';

const fn = (...lines: string[]) => lines.join('\n');

test('D1 (RED, bead forge-8vfn.5.63): a destructured declaration with a LATER default does not blind findBinding to an EARLIER, defaultless name', () => {
  // Kills: the old `[^=;]*` char-class scan of the pattern, which excluded
  // `=` ENTIRELY — so a later property's default value (`env = process.env`)
  // made an earlier, plain `id` read as UNRESOLVED (the value "came from the
  // caller"), same as an unbound function parameter. `id` is not itself on
  // the curated bare-taint list, so an unresolved `id` silently resolved to
  // NOT-tainted and the finding below vanished — a false NEGATIVE, measured
  // live on hook-runtime.ts's `{ ..., parentEnv = process.env, timeoutMs =
  // HOOK_SPAWN_TIMEOUT_MS } = input` (there via `initiativeId`, which IS on
  // the bare list, so it mis-fired the OTHER way — tainted via the bare
  // fallback instead of via `body` — masking the real reason with a
  // coincidentally-similar verdict; see the removed hook-runtime.ts:199/:326
  // allowlist rows).
  const shapes = {
    'default on a LATER sibling': fn(
      'export function h(body) {',
      "  const { id, env = process.env } = body;",
      "  return readFileSync(join(LOGS, id, 'e.jsonl'), 'utf8');",
      '}',
    ),
    'rename with a later default': fn(
      'export function h(body) {',
      "  const { a: id, env = process.env } = body;",
      "  return readFileSync(join(LOGS, id, 'e.jsonl'), 'utf8');",
      '}',
    ),
    'default expression carries its own comma/parens': fn(
      'export function h(body) {',
      "  const { id, env = pick(a, b) } = body;",
      "  return readFileSync(join(LOGS, id, 'e.jsonl'), 'utf8');",
      '}',
    ),
  };
  for (const [name, text] of Object.entries(shapes)) {
    const findings = analyzeModule(text, 'cli/ui-bridge.ts');
    assert.equal(findings.length, 1, `${name}: id must resolve as tainted-via-body, got ${JSON.stringify(findings)}`);
    assert.equal(findings[0].sink, 'readFileSync');
  }
  // No over-fire twin: the SAME shape off a TRUSTED root stays clean —
  // binding-wins classifies by the resolved RHS, defaults don't taint by
  // themselves.
  const trusted = fn(
    'export function h() {',
    '  const { id, env = process.env } = ctx;',
    "  return readFileSync(join(LOGS, id, 'e.jsonl'), 'utf8');",
    '}',
  );
  assert.deepEqual(analyzeModule(trusted, 'cli/ui-bridge.ts'), []);
});

test('D2: destructuredNames handles shorthand, default, rename, rename+default, nested, array elision, and rest', () => {
  assert.deepEqual([...destructuredNames('{ a, b }')].sort(), ['a', 'b']);
  assert.deepEqual([...destructuredNames('{ a, b = 1 }')].sort(), ['a', 'b']);
  assert.deepEqual([...destructuredNames('{ a: x }')].sort(), ['x'], 'the KEY (a) is not itself a bound name');
  assert.deepEqual([...destructuredNames('{ a: x = f(1, 2) }')].sort(), ['x']);
  assert.deepEqual([...destructuredNames('{ a: { b } }')].sort(), ['b']);
  assert.deepEqual([...destructuredNames('[, a, ...rest]')].sort(), ['a', 'rest']);
});

test('D3: findDestructureBinding returns the WHOLE declaration RHS regardless of which slot bound the name, and null when the name is not in the pattern at all', () => {
  assert.deepEqual(findDestructureBinding('const { id, env = process.env } = input;', 'id'), { rhs: 'input' });
  assert.deepEqual(findDestructureBinding('const { id, env = process.env } = input;', 'env'), { rhs: 'input' }, 'env is ALSO bound (from the whole RHS) — this coarse model does not narrow to input.env specifically, same as the regex it replaced');
  assert.equal(findDestructureBinding('const { id } = input;', 'missing'), null);
  assert.equal(findDestructureBinding('let notADestructure = input;', 'id'), null);
});

test('D4 (mutation-shaped RED twin): a name that appears ONLY inside a default EXPRESSION, not as a binding, is not falsely bound', () => {
  // The OLD `\bname\b` text search over the whole pattern (kept as the
  // "which name is bound" check even after this lane's balanced-bracket
  // close-finding fix would have wrongly matched `logsRoot` here — it
  // appears in `x`'s default, not as a key/binding. destructuredNames must
  // not report it.
  assert.deepEqual([...destructuredNames('{ x = logsRoot }')], ['x']);
});
