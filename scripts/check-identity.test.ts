/**
 * check-identity ratchet — proof the gate BITES.
 *
 * Spec §2 (docs/superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md):
 * "ideas machine", "forge v2", "unifier" and "zep" are retired. This lint
 * fails CI when a CURRENT-STATE doc, skill or README still narrates one.
 *
 * These tests run the REAL checker as a subprocess (the same path CI runs),
 * against fabricated trees for each behaviour and against the real repo for
 * the ratchet itself. A checker only ever run on a clean tree proves nothing.
 *
 * RUN: node --test --experimental-strip-types scripts/check-identity.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-identity.mjs');

function run(root: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, root], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'identity-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  return root;
}

function withFixture(files: Record<string, string>, fn: (r: ReturnType<typeof run>) => void): void {
  const root = fixture(files);
  try {
    fn(run(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a current-state doc narrating a retired token FAILS the gate', () => {
  withFixture({ 'docs/phases/developer-loop.md': 'ok\nThe unifier writes DEMO.md.\n' }, (r) => {
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    assert.match(r.out, /docs\/phases\/developer-loop\.md:2/, r.out);
    assert.match(r.out, /unifier/, r.out);
  });
});

test('the same doc, reworded, PASSES — the gate is about the token, not the file', () => {
  withFixture({ 'docs/phases/developer-loop.md': 'ok\nThe integrate band derives DEMO.md.\n' }, (r) => {
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /0 hit\(s\)/, r.out);
  });
});

test('every retired token is caught, case-insensitively, across the whole scanned set', () => {
  withFixture(
    {
      'README.md': 'Unifier\n',
      'ARCHITECTURE.md': 'the Ideas Machine\n',
      'CLAUDE.md': 'forge V2\n',
      'docs/x.md': 'ZEP backend\n',
      'skills/demo/SKILL.md': 'the unifier\n',
      'docs/schemas/project-config.schema.json': '{"x":"unifier"}\n',
    },
    (r) => {
      assert.equal(r.code, 1, r.out);
      for (const f of [
        'README.md',
        'ARCHITECTURE.md',
        'CLAUDE.md',
        'docs/x.md',
        'skills/demo/SKILL.md',
        'docs/schemas/project-config.schema.json',
      ]) {
        assert.match(r.out, new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${f} not reported:\n${r.out}`);
      }
    },
  );
});

test('word boundaries: zeppelin, Zephyr and zeplin are NOT hits', () => {
  withFixture({ 'docs/x.md': 'A zeppelin over Zephyr; see zeplin and https://x/zeppelin\n' }, (r) => {
    assert.equal(r.code, 0, r.out);
  });
});

test('record-type files are excluded — but a NEW roadmap doc is still policed', () => {
  withFixture(
    {
      'docs/decisions/024-x.md': 'the unifier\n',
      'docs/superpowers/specs/blueprint.md': 'the ideas machine\n',
      'docs/roadmaps/1.0.md': 'the unifier is retired\n',
      'docs/roadmaps/1.0-kickoffs.md': 'the unifier is retired\n',
      'docs/roadmaps/R4-ootb-suite.md': 'the unifier\n',
      'docs/roadmaps/README.md': 'the unifier\n',
      'docs/roadmaps/2.0.md': 'the unifier\n',
    },
    (r) => {
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /docs\/roadmaps\/2\.0\.md/, `a new roadmap doc must be policed:\n${r.out}`);
      for (const excluded of [
        'docs/decisions/024-x.md',
        'docs/superpowers/specs/blueprint.md',
        'docs/roadmaps/1.0.md',
        'docs/roadmaps/1.0-kickoffs.md',
        'docs/roadmaps/R4-ootb-suite.md',
        'docs/roadmaps/README.md',
      ]) {
        assert.doesNotMatch(
          r.out,
          new RegExp(excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `${excluded} is a record-type file and must NOT be reported:\n${r.out}`,
        );
      }
    },
  );
});

test('untracked/ignored trees are not scanned (node_modules, .next, projects, _worktrees)', () => {
  withFixture(
    {
      'docs/node_modules/pkg/readme.md': 'the unifier\n',
      'docs/ok.md': 'clean\n',
    },
    (r) => {
      assert.equal(r.code, 0, r.out);
    },
  );
});

test('a markdown link TARGET into an excluded tree is not a hit — ADR filenames are history', () => {
  // Two real ADRs carry a retired token in their filename (019-cycle-resume-from-unifier.md,
  // 026-review-unifier-wi-list.md). ADR filenames are append-only history. A lint that fires on
  // the LINK PATH pushes authors to de-link the citation to stay green — the guard degrading the
  // docs it exists to protect. Prose on the same line is still a hit.
  withFixture(
    {
      'docs/known-gaps.md':
        'See [ADR 026](./decisions/026-review-unifier-wi-list.md) and [ADR 019](../docs/decisions/019-cycle-resume-from-unifier.md).\n',
    },
    (r) => {
      assert.equal(r.code, 0, `an ADR link target must not be a hit:\n${r.out}`);
    },
  );
  withFixture(
    { 'docs/known-gaps.md': 'The unifier ran here — see [ADR 026](./decisions/026-review-unifier-wi-list.md).\n' },
    (r) => {
      assert.equal(r.code, 1, `prose beside an ADR link must still be a hit:\n${r.out}`);
      assert.match(r.out, /1 hit\(s\)/, r.out);
    },
  );
});

test('THE RATCHET: the real repo scans clean — zero hits, zero tolerance', () => {
  const r = run(ROOT);
  assert.match(r.out, /scanned \d+ file/, `expected a real scan, got: ${r.out}`);
  const scanned = Number(/scanned (\d+) file/.exec(r.out)?.[1] ?? 0);
  // The scanned set is CLAUDE/README/ARCHITECTURE + docs/**/*.{md,json} minus the
  // record-type exclusions + skills/**/SKILL.md — 76 files today. The floor only
  // has to prove a real scan happened, not pin the count.
  assert.ok(scanned > 50, `expected a real scan (> 50 files), got ${scanned}`);
  assert.equal(r.code, 0, `retired vocabulary still present:\n${r.out}`);
});
