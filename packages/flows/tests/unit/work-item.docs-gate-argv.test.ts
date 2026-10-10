/**
 * A WI whose `quality_gate_cmd` is a `forge gate docs …` invocation has its
 * operands validated at plan time (forge-nk1y.21). `apps/forge/cli-gate.ts`
 * exits 2 on any `-`-prefixed operand it does not know, so an operand like
 * `--config=evil.md` made that WI's gate permanently red and burned fix rounds.
 * Operands are also paths that reach a shell-free argv, so the segment charset
 * is pinned to the same conservative set the rest of the plan boundary uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateWorkItem, type WorkItem } from '../../work-item.ts';

function wi(cmd: string[]): WorkItem {
  return {
    work_item_id: 'WI-1',
    initiative_id: 'INIT-2026-10-10-x',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: ['docs/guide.md'],
    estimated_iterations: 1,
    quality_gate_cmd: cmd,
    body: 'b',
  };
}

const docs = (...rest: string[]): string[] => ['forge', 'gate', 'docs', ...rest];
const errs = (cmd: string[]): string[] => validateWorkItem(wi(cmd));

test('positive controls: well-formed docs-gate invocations pass', () => {
  assert.deepEqual(errs(docs('docs/guide.md')), []);
  assert.deepEqual(errs(docs('/abs/_worktrees/INIT-2026-10-10-x/.forge/a.md')), []);
  assert.deepEqual(errs(docs('--', 'docs/a.md', 'docs/b.md')), []);
  assert.deepEqual(errs(docs('--sections', 'A,B', '--no-links', 'docs/a.md')), []);
  assert.deepEqual(errs(docs('--forbid', 'unifier', '--sections', 'Overview', '--', '/x/docs/a.md')), []);
});

for (const bad of ['--config=evil.md', '-x.md', '-']) {
  test(`refuses a leading '-' operand ${JSON.stringify(bad)} (before and after --)`, () => {
    for (const cmd of [docs(bad), docs('--', bad), docs('docs/a.md', bad)]) {
      const e = errs(cmd).filter((s) => s.includes(`operand ${JSON.stringify(bad)} refused`));
      assert.equal(e.length, 1, `names the operand once: ${JSON.stringify(cmd)}`);
    }
  });
}

test('refuses an unknown flag and names it', () => {
  const e = errs(docs('--wat', 'docs/a.md'));
  assert.equal(e.length, 1);
  assert.match(e[0]!, /quality_gate_cmd docs-gate operand "--wat" refused: .*unknown flag/);
});

for (const bad of ['my doc.md', 'a;b.md', 'a|b.md', '$(x).md', 'a`b`.md', 'a&b.md', 'a\nb.md', 'é.md']) {
  test(`refuses an operand with unsafe characters ${JSON.stringify(bad)}`, () => {
    const e = errs(docs(bad));
    assert.equal(e.length, 1);
    assert.ok(e[0]!.includes(`operand ${JSON.stringify(bad)} refused`), e[0]);
  });
}

test('refuses an empty operand, a `..` or `.` segment, and an empty middle segment', () => {
  for (const bad of ['', 'docs/../etc/x.md', '../x.md', 'docs/./a.md', 'a//b.md', 'docs/-x/a.md']) {
    const e = errs(docs(bad));
    // an empty string is already refused by the entries-non-empty rule; the docs
    // rule must not crash on it and must not be the only guard for anything else
    if (bad === '') { assert.ok(e.length >= 1); continue; }
    assert.equal(e.length, 1, `${bad}: ${JSON.stringify(e)}`);
    assert.ok(e[0]!.includes(`operand ${JSON.stringify(bad)} refused`), e[0]);
  }
});

test('refuses --sections / --forbid with a missing, empty or flag-like value', () => {
  for (const cmd of [
    docs('docs/a.md', '--sections'),
    docs('--sections', '--no-links', 'docs/a.md'),
    docs('--forbid', '-x', 'docs/a.md'),
    docs('--sections', '--', 'docs/a.md'),
  ]) {
    const e = errs(cmd);
    assert.equal(e.length, 1, JSON.stringify(cmd));
    assert.match(e[0]!, /quality_gate_cmd docs-gate flag "--(sections|forbid)" refused/);
  }
});

test('refuses a docs gate with no operands (cli-gate exits 2 on it)', () => {
  for (const cmd of [docs(), docs('--'), docs('--no-links'), docs('--sections', 'A')]) {
    const e = errs(cmd);
    assert.equal(e.length, 1, JSON.stringify(cmd));
    assert.match(e[0]!, /docs-gate .*at least one/);
  }
});

test('a second `--` is an operand, not a marker, and is refused as a leading-dash operand', () => {
  const e = errs(docs('--', '--', 'docs/a.md'));
  assert.equal(e.length, 1);
  assert.ok(e[0]!.includes('operand "--" refused'));
});

test('non-docs gates are unaffected', () => {
  assert.deepEqual(errs(['npm', 'test', '--', '--grep', 'x']), []);
  assert.deepEqual(errs(['forge', 'gate']), []);
  assert.deepEqual(errs(['forge', 'gate', 'other', '--weird', 'a b']), []);
  assert.deepEqual(errs(['node', '--test', 'tests/a b.test.ts']), []);
});
