/**
 * Acceptance tests for `packages/kernel/ids.ts` — the id vocabulary and the
 * one slug guard, quarried out of `packages/agents/skill-path.ts` in M4-library
 * PR 2 (T1 ruling, park #1 Q3).
 *
 * WHY KERNEL AND NOT LIBRARY. `orchestrator/studio/validate.ts:14` already
 * re-exports `SLUG_RE`, `EXACT_ID_RE`, `PROJECT_ID_RE`, `KB_ID_RE`,
 * `MAX_EXACT_ID_LENGTH`, `RESERVED_OBJECT_IDS` and `isReservedId` to validate
 * PROJECTS and KNOWLEDGE BASES — objects library does not own. The vocabulary
 * was never the Skill kind's; it is "the facts every other package needs and
 * none of them owns", which is kernel's own charter.
 *
 * RED BEFORE THE MOVE: every import below fails with `Cannot find module`.
 * Do not stub the module to make this file load.
 *
 * WHICH WRONG IMPLEMENTATION EACH TEST KILLS is named per test — a test that
 * would look identical had the move been wrong is characterization, not
 * acceptance.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  SLUG_RE,
  EXACT_ID_RE,
  PROJECT_ID_RE,
  KB_ID_RE,
  MAX_EXACT_ID_LENGTH,
  MAX_SKILL_ID_LENGTH,
  RESERVED_OBJECT_IDS,
  SLUG_RULE_TEXT,
  isReservedId,
  assertSkillSlug,
  FORGE_ROOT,
} from './ids.ts';

describe('kernel/ids — the slug guard, moved without changing WHICH shapes it rejects', () => {
  // Kills: a move that re-declared a laxer regex, or dropped the join-collapse
  // cases. Every one of these reaches a path join in the caller if it passes.
  for (const bad of ['.', '..', 'a/b', 'a\\b', '/abs', '', 'Upper', '-lead', 'trail-', 'a--b', '_under']) {
    test(`assertSkillSlug rejects ${JSON.stringify(bad)}`, () => {
      assert.throws(() => assertSkillSlug(bad), /invalid skill id/);
    });
  }

  for (const good of ['a', 'skill', 'my-skill', 'a1', 'a1-b2-c3']) {
    test(`assertSkillSlug accepts ${JSON.stringify(good)}`, () => {
      assert.doesNotThrow(() => assertSkillSlug(good));
    });
  }

  // Kills: a move that dropped the length cap, letting a charset-valid id die
  // later as an opaque ENAMETOOLONG from mkdir instead of a named limit.
  test('assertSkillSlug names the length limit rather than letting ENAMETOOLONG happen later', () => {
    assert.equal(MAX_SKILL_ID_LENGTH, 100);
    assert.throws(() => assertSkillSlug('a'.repeat(101)), /exceeds the 100-character length limit/);
    assert.doesNotThrow(() => assertSkillSlug('a'.repeat(100)));
  });

  // Kills: a move that hardcoded "skill" in the message. Library-13: a hooks
  // route used to tell the operator their HOOK id was an invalid SKILL id.
  test('the noun in the message is the caller\'s, not always "skill"', () => {
    assert.throws(() => assertSkillSlug('bad/id', 'hook'), /invalid hook id/);
    assert.throws(() => assertSkillSlug('bad/id', 'connection'), /invalid connection id/);
  });

  // Kills: a move that let sanitizeError eat the rule out of the message.
  test('SLUG_RULE_TEXT carries the bare pattern source, with no leading slash', () => {
    assert.ok(SLUG_RULE_TEXT.includes(SLUG_RE.source));
    assert.ok(!SLUG_RULE_TEXT.includes(`/${SLUG_RE.source}/`));
  });
});

describe('kernel/ids — the project/KB id rule, which is NOT the slug rule', () => {
  // Kills: a move that collapsed the two rules into one. A project id is
  // case-preserving and matched exactly; a slug is lowercase-kebab.
  test('EXACT_ID_RE is case-preserving where SLUG_RE is not', () => {
    assert.ok(EXACT_ID_RE.test('MyProject'));
    assert.ok(!SLUG_RE.test('MyProject'));
    assert.ok(EXACT_ID_RE.test('a_b'));
    assert.ok(!SLUG_RE.test('a_b'));
  });

  test('PROJECT_ID_RE and KB_ID_RE are the SAME predicate, so a project and its KB can never disagree', () => {
    assert.equal(PROJECT_ID_RE, EXACT_ID_RE);
    assert.equal(KB_ID_RE, EXACT_ID_RE);
    assert.equal(MAX_EXACT_ID_LENGTH, 128);
  });
});

describe('kernel/ids — reserved ids', () => {
  test('"new" is reserved, case-insensitively, because /skills/new is a static route', () => {
    assert.ok(RESERVED_OBJECT_IDS.has('new'));
    assert.equal(isReservedId('new'), true);
    assert.equal(isReservedId('New'), true);
    assert.equal(isReservedId('NEW'), true);
    assert.equal(isReservedId('newish'), false);
  });
});

describe('kernel/ids — FORGE_ROOT, re-depthed for packages/kernel/ (T1 park #1 constraint a)', () => {
  // POSITIVE CONTROL, mandatory: the anchor is `resolve(import.meta.dirname,
  // '..', '..')`, so it is DEPTH-DEPENDENT. Moving the file from
  // packages/agents/ to packages/kernel/ keeps the depth, but a future move
  // one level in or out would silently resolve to `packages/` or to the
  // parent of the repo and every skill lookup would read an empty tree
  // rather than fail. These two assertions are what makes that loud.
  test('FORGE_ROOT resolves to a directory that actually holds this repo', () => {
    assert.ok(existsSync(join(FORGE_ROOT, 'package.json')), `${FORGE_ROOT} has no package.json`);
    assert.ok(existsSync(join(FORGE_ROOT, 'skills')), `${FORGE_ROOT} has no skills/ tree`);
    assert.ok(existsSync(join(FORGE_ROOT, 'packages', 'kernel', 'ids.ts')), `${FORGE_ROOT} is not this repo`);
  });

  // Kills: a resolve() that landed on `packages/` — which also exists, so a
  // bare existsSync on the directory itself would have passed.
  test('FORGE_ROOT is NOT the packages/ directory', () => {
    assert.ok(!FORGE_ROOT.endsWith('/packages'), `FORGE_ROOT re-depthed wrong: ${FORGE_ROOT}`);
  });
});
