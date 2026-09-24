/**
 * composeProjectSkills — the pure composer (ADR 024 item 90) both agent
 * builders (`runOneShotSpawn` / `createClaudeAgent`) call to fold a
 * project's declared skills into an agent's system prompt. Pure: never
 * mutates `systemPrompt` or the skills array; empty list leaves the prompt
 * byte-identical (undefined stays undefined).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeProjectSkills } from '../../project-skills.ts';

test('composeProjectSkills: empty skills list leaves an undefined systemPrompt unchanged', () => {
  assert.equal(composeProjectSkills(undefined, []), undefined);
});

test('composeProjectSkills: empty skills list leaves a defined systemPrompt byte-identical', () => {
  const prompt = 'You are the developer agent.';
  assert.equal(composeProjectSkills(prompt, []), prompt);
});

test('composeProjectSkills: appends a headed section with one ### per declared skill', () => {
  const result = composeProjectSkills('BASE PROMPT', [
    { id: 'ado-api-explorer', path: '/x/SKILL.md', text: '# ado-api-explorer\n\nDo the thing.' },
  ]);
  assert.ok(result!.startsWith('BASE PROMPT'));
  assert.match(result!, /## Project skills \(declared in \.forge\/project\.json\)/);
  assert.match(result!, /### ado-api-explorer/);
  assert.match(result!, /Do the thing\./);
});

test('composeProjectSkills: multiple skills each get their own ### heading, in order', () => {
  const result = composeProjectSkills(undefined, [
    { id: 'skill-a', path: '/a/SKILL.md', text: 'A body' },
    { id: 'skill-b', path: '/b/SKILL.md', text: 'B body' },
  ]);
  const idxA = result!.indexOf('### skill-a');
  const idxB = result!.indexOf('### skill-b');
  assert.ok(idxA >= 0 && idxB >= 0 && idxA < idxB, 'skills appear in declared order');
  assert.match(result!, /A body/);
  assert.match(result!, /B body/);
});

test('composeProjectSkills: does not mutate the input systemPrompt string or skills array', () => {
  const prompt = 'immutable base';
  const skills = [{ id: 'x', path: '/x/SKILL.md', text: 'x text' }];
  const skillsCopy = JSON.parse(JSON.stringify(skills));
  const result = composeProjectSkills(prompt, skills);
  assert.notEqual(result, prompt, 'a new string is returned, not the same reference mutated');
  assert.deepEqual(skills, skillsCopy, 'the skills array is untouched');
});

test('composeProjectSkills: an undefined base systemPrompt with skills produces JUST the section (no leading blank prompt)', () => {
  const result = composeProjectSkills(undefined, [{ id: 'x', path: '/x/SKILL.md', text: 'x text' }]);
  assert.ok(result!.startsWith('## Project skills'));
});
