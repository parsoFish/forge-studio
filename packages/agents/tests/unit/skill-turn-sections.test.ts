/**
 * `splitSkillTurnSections` / `loadSkillTurnPrompt` — the LOADER, on its own.
 *
 * Lane R4-23 WI-1's acceptance tests for the shared skill-turn-section loader
 * (`skill-path.ts`), plus round 2's loader-shaped edge cases. What each kills:
 * AT-1 marker lines leaking into `base` or one section bleeding into another ·
 * AT-2 a marker-less doc mis-parsed as having sections · AT-3 concatenating
 * ALL sections instead of selecting the requested one · AT-4 failing OPEN with
 * a generic fallback instead of throwing loudly with skill / turn id /
 * available ids (the declared-data-fails-open antipattern) · AT-5 a cache
 * keyed on skill NAME serving fixture A's content for fixture B ·
 * R2-AT-4 a duplicate turn id silently last-write-wins · R2-AT-5 a marker
 * inside a fenced code block treated as a real boundary · R2-AT-6 a
 * near-miss marker not named in the fail-loud message · R2-AT-7 a CRLF file
 * leaving a stray \r in a section body.
 *
 * ROUND 2 (R2-AT-*). An adversarial review of the landed WI-1 commit
 * (90cbc634) found real defects in the composed prompt and in the loader
 * itself. Those ATs were written BEFORE any fix landed, on the same rule as
 * AT-1..AT-10: an implementer may make them PASS by fixing the defect each
 * comment describes; it may NOT edit them to make them pass.
 *
 * The namespace import below is deliberate and is explained where it sits.
 *
 * SPLIT FROM a 1,027-line file along the three concerns its own banners
 * declare — LOADER, INSTRUCTIONS RUNNER, GREP-ASSERT — with each round-2 AT
 * filed under the concern it actually tests rather than under its number. The
 * three parts are `unit/skill-turn-sections` (the pure loader),
 * `integration/instructions-turn-prompt` (the composed prompt a real turn
 * produces) and `contract/skill-md-prose-migration` (the prose actually left
 * the .ts and reached SKILL.md). The split retires the file's
 * `scripts/baselines/file-size.json` row rather than re-keying it: a move
 * cannot retire an exemption, only a split can.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Namespace import (not a named import of the two new exports): at base,
// `splitSkillTurnSections`/`loadSkillTurnPrompt` do not exist yet. A named
// `import { splitSkillTurnSections } from './skill-path.ts'` would fail
// MODULE INSTANTIATION for the whole file (an ESM "does not provide an
// export named" SyntaxError), which would hide every OTHER AT's true
// red/green state behind one shared load failure. The namespace import
// always succeeds; the missing properties just read as `undefined`, so each
// AT below fails (or passes) on its own, individually diagnosable, footing.
import * as skillPathMod from '../../skill-path.ts';

/** Write `content` to a fresh tmpdir under `<name>` and return the file path.
 *  Duplicated into the parts of this split that need it rather than exported
 *  from a `.test.ts` — the precedent this package already set in
 *  `regression/failure-classifier.rate-limit.test.ts`. */
function writeFixture(label: string, filename: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), `skill-turn-${label}-`));
  const p = join(dir, filename);
  writeFileSync(p, content);
  return p;
}

// ---------------------------------------------------------------------------
// LOADER — pure `splitSkillTurnSections` (AT-1, AT-2)
// ---------------------------------------------------------------------------

test('AT-1: splitSkillTurnSections splits base + N named sections; marker lines never appear in base or any section, and sections do not bleed into each other', () => {
  const doc = [
    '---',
    'name: fixture',
    '---',
    '',
    'Shared preamble line one.',
    'Shared preamble line two.',
    '',
    '<!-- turn: alpha -->',
    '## Alpha turn',
    'Alpha body line.',
    '',
    '<!-- turn: beta -->',
    '## Beta turn',
    'Beta body line.',
    '',
  ].join('\n');

  const { base, turns } = skillPathMod.splitSkillTurnSections(doc);

  assert.equal(turns.size, 2, 'exactly the two declared sections');
  assert.ok(turns.has('alpha') && turns.has('beta'));

  // base excludes both sections.
  assert.match(base, /Shared preamble line one\./);
  assert.doesNotMatch(base, /Alpha turn/);
  assert.doesNotMatch(base, /Alpha body line\./);
  assert.doesNotMatch(base, /Beta turn/);
  assert.doesNotMatch(base, /Beta body line\./);

  // each section carries only its own content.
  const alpha = turns.get('alpha')!;
  const beta = turns.get('beta')!;
  assert.match(alpha, /Alpha body line\./);
  assert.doesNotMatch(alpha, /Beta turn/);
  assert.doesNotMatch(alpha, /Beta body line\./);
  assert.match(beta, /Beta body line\./);
  assert.doesNotMatch(beta, /Alpha turn/);
  assert.doesNotMatch(beta, /Alpha body line\./);

  // marker lines themselves are stripped everywhere.
  for (const chunk of [base, alpha, beta]) {
    assert.doesNotMatch(chunk, /<!--\s*turn:/);
  }
});

test('AT-2: a doc with no <!-- turn: --> marker yields an empty turns map (base = the whole doc)', () => {
  const doc = 'Just a plain skill doc with no per-turn sections at all.\n\nSecond paragraph.\n';

  const { base, turns } = skillPathMod.splitSkillTurnSections(doc);

  assert.equal(turns.size, 0, 'no markers ⇒ no sections');
  assert.equal(base, doc, 'the whole doc is the base when there is nothing to split off');
  // loadSkillTurnPrompt against a marker-less doc must then THROW — see AT-4b.
});

// ---------------------------------------------------------------------------
// LOADER — `loadSkillTurnPrompt` selection + fail-loud contract (AT-3, AT-4, AT-5)
// ---------------------------------------------------------------------------

test('AT-3: loadSkillTurnPrompt returns base + ONLY the requested turn section (a sentinel unique to the OTHER section is absent)', () => {
  const SECTION_A_SENTINEL = 'SECTION_A_ONLY_c19f83';
  const SECTION_B_SENTINEL = 'SECTION_B_ONLY_e02a71';
  const path = writeFixture(
    'at3',
    'skill.md',
    [
      'Base preamble sentinel: BASE_ONLY_11ab22',
      '',
      '<!-- turn: section-a -->',
      SECTION_A_SENTINEL,
      '',
      '<!-- turn: section-b -->',
      SECTION_B_SENTINEL,
      '',
    ].join('\n'),
  );

  const prompt = skillPathMod.loadSkillTurnPrompt({
    name: 'fixture-skill',
    turnId: 'section-a',
    skillPromptPath: path,
  });

  assert.match(prompt, /BASE_ONLY_11ab22/, 'base preamble is always included');
  assert.match(prompt, new RegExp(SECTION_A_SENTINEL), 'the requested section is included');
  assert.doesNotMatch(prompt, new RegExp(SECTION_B_SENTINEL), 'the OTHER section must not leak in');
  assert.doesNotMatch(prompt, /<!--\s*turn:/, 'marker lines are stripped from the composed prompt');
});

test('AT-4a: loadSkillTurnPrompt throws fail-loud on an unreadable skillPromptPath (names skill + turn id)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skill-turn-at4a-'));
  const missingPath = join(dir, 'does-not-exist.md');

  assert.throws(
    () =>
      skillPathMod.loadSkillTurnPrompt({
        name: 'fixture-skill',
        turnId: 'interview',
        skillPromptPath: missingPath,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const msg = err.message.toLowerCase();
      assert.ok(msg.includes('fixture-skill'), `message should name the skill, got: ${err.message}`);
      assert.ok(msg.includes('interview'), `message should name the turn id, got: ${err.message}`);
      return true;
    },
  );
});

test('AT-4b: loadSkillTurnPrompt throws fail-loud on a doc with no turn sections (names skill + turn id)', () => {
  const path = writeFixture('at4b', 'skill.md', 'Prose with no turn markers whatsoever.\n');

  assert.throws(
    () =>
      skillPathMod.loadSkillTurnPrompt({
        name: 'fixture-skill',
        turnId: 'interview',
        skillPromptPath: path,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const msg = err.message.toLowerCase();
      assert.ok(msg.includes('fixture-skill'), `message should name the skill, got: ${err.message}`);
      assert.ok(msg.includes('interview'), `message should name the turn id, got: ${err.message}`);
      return true;
    },
  );
});

test('AT-4c: loadSkillTurnPrompt throws fail-loud on an unknown turn id (names skill + turn id + available ids)', () => {
  const path = writeFixture(
    'at4c',
    'skill.md',
    ['Base.', '', '<!-- turn: interview -->', 'Interview body.', '', '<!-- turn: draft -->', 'Draft body.', ''].join(
      '\n',
    ),
  );

  assert.throws(
    () =>
      skillPathMod.loadSkillTurnPrompt({
        name: 'fixture-skill',
        turnId: 'nonexistent-turn',
        skillPromptPath: path,
      }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      const msg = err.message.toLowerCase();
      assert.ok(msg.includes('fixture-skill'), `message should name the skill, got: ${err.message}`);
      assert.ok(msg.includes('nonexistent-turn'), `message should name the requested turn id, got: ${err.message}`);
      assert.ok(msg.includes('interview'), `message should list "interview" as available, got: ${err.message}`);
      assert.ok(msg.includes('draft'), `message should list "draft" as available, got: ${err.message}`);
      return true;
    },
  );
});

test('AT-5: an explicit skillPromptPath is never served from a default-path cache — two fixtures read in sequence each return their own content', () => {
  const pathA = writeFixture('at5a', 'skill.md', ['<!-- turn: only -->', 'SENTINEL_A_9f01c3'].join('\n'));
  const pathB = writeFixture('at5b', 'skill.md', ['<!-- turn: only -->', 'SENTINEL_B_2ee784'].join('\n'));

  const first = skillPathMod.loadSkillTurnPrompt({ name: 'fixture-skill', turnId: 'only', skillPromptPath: pathA });
  const second = skillPathMod.loadSkillTurnPrompt({ name: 'fixture-skill', turnId: 'only', skillPromptPath: pathB });

  assert.match(first, /SENTINEL_A_9f01c3/);
  assert.doesNotMatch(first, /SENTINEL_B_2ee784/);
  assert.match(second, /SENTINEL_B_2ee784/, 'the second read must reflect fixture B, not a cached fixture A');
  assert.doesNotMatch(second, /SENTINEL_A_9f01c3/);
});

// ---------------------------------------------------------------------------
// R2-AT-4 — a duplicate turn id must be refused, not silently last-write-wins
// (today `splitSkillTurnSections` does `turns.set(id, ...)`, so a repeated
// `<!-- turn: draft -->` silently drops the first section).
// ---------------------------------------------------------------------------

test('R2-AT-4: splitSkillTurnSections THROWS on a document with two sections carrying the same turn id, naming the duplicated id', () => {
  const doc = [
    'Base preamble.',
    '',
    '<!-- turn: draft -->',
    'First draft body.',
    '',
    '<!-- turn: draft -->',
    'Second draft body (duplicate id — must be refused, not last-write-wins).',
    '',
  ].join('\n');

  assert.throws(
    () => skillPathMod.splitSkillTurnSections(doc),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('draft'),
        `message should name the duplicated turn id "draft", got: ${err.message}`,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// R2-AT-5 — a marker DOCUMENTED inside a fenced code block is not a real
// section boundary.
// ---------------------------------------------------------------------------

test('R2-AT-5: a <!-- turn: ... --> marker written inside a fenced code block (documenting the syntax) is not treated as a real section boundary', () => {
  const doc = [
    'Base preamble.',
    '',
    'The turn-marker syntax looks like this:',
    '```md',
    '<!-- turn: example -->',
    '## Some turn',
    '```',
    '',
    'End of base preamble sentinel: BASE_TAIL_af03c1',
  ].join('\n');

  const { base, turns } = skillPathMod.splitSkillTurnSections(doc);

  assert.equal(turns.size, 0, 'the fenced-block marker must not be parsed as a real turn boundary');
  assert.equal(base, doc, 'the fenced block stays inside base verbatim, byte-for-byte');
});

// ---------------------------------------------------------------------------
// R2-AT-6 — a malformed marker id is diagnosable: the thrown message must
// mention the near-miss marker line, not just report "no turns available"
// while a marker is visibly present two lines away.
// ---------------------------------------------------------------------------

test('R2-AT-6a: an uppercase near-miss marker ("<!-- turn: Interview -->") is named in the fail-loud message', () => {
  const path = writeFixture(
    'at-r2-6a',
    'skill.md',
    [
      'Base preamble.',
      '',
      '<!-- turn: Interview -->',
      '## Interview (uppercase id — does not match the marker id shape)',
      'Interview body.',
      '',
    ].join('\n'),
  );

  assert.throws(
    () => skillPathMod.loadSkillTurnPrompt({ name: 'fixture-skill', turnId: 'interview', skillPromptPath: path }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('<!-- turn: Interview -->'),
        `message should mention the malformed marker line, not just say no turns are available ` +
          `while one visibly sits two lines away, got: ${err.message}`,
      );
      return true;
    },
  );
});

test('R2-AT-6b: an underscore near-miss marker ("<!-- turn: interview_step -->") is named in the fail-loud message', () => {
  const path = writeFixture(
    'at-r2-6b',
    'skill.md',
    [
      'Base preamble.',
      '',
      '<!-- turn: interview_step -->',
      '## Interview step (underscore id — does not match the marker id shape)',
      'Interview body.',
      '',
    ].join('\n'),
  );

  assert.throws(
    () =>
      skillPathMod.loadSkillTurnPrompt({ name: 'fixture-skill', turnId: 'interview-step', skillPromptPath: path }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.ok(
        err.message.includes('<!-- turn: interview_step -->'),
        `message should mention the malformed marker line, not just say no turns are available ` +
          `while one visibly sits two lines away, got: ${err.message}`,
      );
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// R2-AT-7 — CRLF input must split correctly with no stray `\r` left behind.
// ---------------------------------------------------------------------------

test('R2-AT-7: a CRLF-line-ended SKILL.md splits correctly with no stray \\r left in base or any section body', () => {
  const doc = [
    'Base preamble line one.',
    'Base preamble line two.',
    '',
    '<!-- turn: draft -->',
    '## Draft turn',
    'Draft body line.',
    '',
  ].join('\r\n');

  const { base, turns } = skillPathMod.splitSkillTurnSections(doc);

  assert.equal(turns.size, 1, 'the CRLF-ended marker line must still be recognised as a turn boundary');
  assert.ok(turns.has('draft'));
  assert.match(base, /Base preamble line one\./);
  assert.doesNotMatch(base, /\r/, 'no stray \\r characters may remain in base');
  const draftSection = turns.get('draft')!;
  assert.match(draftSection, /Draft body line\./);
  assert.doesNotMatch(draftSection, /\r/, 'no stray \\r characters may remain in the section body');
});
