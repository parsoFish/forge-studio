/**
 * forge-ler4 — `runBrainFixTurn` is the shared choke point for the drain's
 * round loop, `runBrainConsolidateNow`, and `forge brain fix` (see
 * `kinds/brain-fix.ts`'s own header). It must take the brain-write lease
 * around the WHOLE turn, so a reflector write landing mid-turn can never be
 * misattributed by the edit-soundness gate (`kb-drain-edit-soundness.ts`).
 *
 * These tests hold the SAME real lease externally (via
 * `acquireBrainWriteLease`, not a mock) before dispatching a turn, mirroring
 * `community-registry-lock.test.ts`'s CONTENTION tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runBrainFixTurn, type QueryFn } from '../../kinds/brain-fix.ts';
import { acquireBrainWriteLease } from '@forge/knowledge/brain-write-lease.ts';

/** Minimal single-KB brain fixture (mirrors brain-fix.test.ts's buildFixture). */
function buildFixture(): { forgeRoot: string; themePath: string; before: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'brain-fix-lease-test-'));
  const brain = join(forgeRoot, 'brain');
  const cyclesThemes = join(brain, 'cycles', 'themes');
  const cyclesDir = join(brain, 'cycles');

  mkdirSync(cyclesThemes, { recursive: true });
  writeFileSync(
    join(cyclesDir, 'kb.yaml'),
    'id: cycles\nname: cycles\nbinding: { kind: unique }\ndesc: lease-test fixture.\n',
  );
  writeFileSync(join(brain, 'INDEX.md'), '# Brain\n\nnavigation hub.\n');
  for (const cat of ['patterns', 'antipatterns', 'decisions', 'operations']) {
    writeFileSync(join(cyclesDir, `${cat}.md`), `# ${cat}\n`);
  }

  const before = [
    '---',
    'title: test theme',
    'category: pattern',
    'created_at: 2026-01-01T00:00:00Z',
    'updated_at: 2026-01-01T00:00:00Z',
    'keywords: []',
    'related_themes: []',
    '---',
    '',
    '# theme body',
    '',
  ].join('\n') + '\n';
  const themePath = join(cyclesThemes, 'no-description.md');
  writeFileSync(themePath, before);

  return { forgeRoot, themePath, before };
}

function seedSkillMd(forgeRoot: string): void {
  const dir = join(forgeRoot, 'skills', 'brain-fix');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '# Brain-Fix\n\nApply a single targeted fix.\n');
}

function cleanup(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

function makeFakeQueryThatFixes(themePath: string, before: string): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      writeFileSync(
        themePath,
        before.replace('title: test theme\n', 'title: test theme\ndescription: added mid-turn.\n'),
      );
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.001 };
    }
    return gen();
  };
}

test('forge-ler4: a fix turn REFUSES (cleared=false, typed lease-contention error named in editAudit.errors) when another writer already holds the brain-write lease', async () => {
  const { forgeRoot, themePath, before } = buildFixture();
  seedSkillMd(forgeRoot);
  try {
    const release = await acquireBrainWriteLease(forgeRoot);
    try {
      const result = await runBrainFixTurn({
        runId: 'ler4-lease-contention',
        kbId: 'cycles',
        file: themePath,
        check: 'checkFrontmatter',
        kind: 'frontmatter.missing-field',
        message: 'missing required frontmatter field: description',
        forgeRoot,
        queryFn: makeFakeQueryThatFixes(themePath, before),
      });
      assert.equal(
        result.cleared,
        false,
        'a turn that could not take the brain-write lease must never report cleared',
      );
      assert.ok(
        result.editAudit.errors.some((e) => /brain-write-lease/.test(e)),
        `expected a named lease-contention error in editAudit.errors — got ${JSON.stringify(result.editAudit.errors)}`,
      );
      assert.equal(
        readFileSync(themePath, 'utf8'),
        before,
        'a turn refused before it spawned must never touch the file',
      );
    } finally {
      await release();
    }
  } finally {
    cleanup(forgeRoot);
  }
});

test('forge-ler4: once the lease is free, the turn proceeds normally and can still clear a finding', async () => {
  const { forgeRoot, themePath, before } = buildFixture();
  seedSkillMd(forgeRoot);
  try {
    const result = await runBrainFixTurn({
      runId: 'ler4-lease-free',
      kbId: 'cycles',
      file: themePath,
      check: 'checkFrontmatter',
      kind: 'frontmatter.missing-field',
      message: 'missing required frontmatter field: description',
      forgeRoot,
      queryFn: makeFakeQueryThatFixes(themePath, before),
    });
    assert.equal(result.cleared, true);
  } finally {
    cleanup(forgeRoot);
  }
});
