/**
 * turnSpec.kindDir is validated by the kernel's OWN `isSafeSegment`, not a hand-mirror of it.
 *
 * `session-kinds-validate.ts` carried `isSafeKindDirSegment`, a copy "kept in exact lockstep by
 * design" because `isSafeSegment` was once not exported. It is exported (`@forge/kernel`), and
 * forge-8vfn.5.59 added DEL and percent-encoded-traversal rejection to it — the copy did not
 * follow, which is the drift class 5.59 closed one file over (lane m7-c's security review,
 * 2026-09-19). Every value the kernel predicate refuses must be refused here too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSafeSegment } from '@forge/kernel';
import { validateSessionKinds } from '../../studio/session-kinds-validate.ts';
import { makeForgeRoot, writeAgentSkill, writeSessionKindsYaml } from '../contract/test-fixtures/session-kinds-core.ts';
import { wellFormedTurnSpec, turnSpecDescriptor } from '../contract/test-fixtures/session-kinds-turnspec.ts';

const DEL = String.fromCharCode(0x7f);

test('a kindDir the kernel guard refuses (DEL, encoded traversal, encoded separator) is refused by the session-kinds lint too', () => {
  for (const bad of [`_arch${DEL}`, '%2e%2e', '_a%2fb', '_a%5cb']) {
    assert.equal(isSafeSegment(bad), false, `precondition: the kernel predicate refuses ${JSON.stringify(bad)}`);
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [turnSpecDescriptor({ ...wellFormedTurnSpec(), kindDir: bad })]);
    const f = validateSessionKinds(root).find((x) => x.check === 'session-kinds/turnspec-unsafe-kind-dir');
    assert.ok(f, `kindDir ${JSON.stringify(bad)} must be refused exactly as the guard would refuse it`);
  }
});

test('every shipped underscore-prefixed kindDir still passes (the reason SLUG_RE cannot be used here)', () => {
  for (const good of ['_authoring', '_architect', '_demo']) {
    assert.equal(isSafeSegment(good), true);
    const root = makeForgeRoot();
    writeAgentSkill(root, 'fixture-agent');
    writeSessionKindsYaml(root, [turnSpecDescriptor({ ...wellFormedTurnSpec(), kindDir: good })]);
    assert.equal(validateSessionKinds(root).some((x) => x.check === 'session-kinds/turnspec-unsafe-kind-dir'), false, good);
  }
});
