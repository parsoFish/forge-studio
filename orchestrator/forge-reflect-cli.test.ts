/**
 * S6B — tests for orchestrator/forge-reflect-cli.ts.
 *
 * Validates the slash-command CLI module pattern (council 06 dx:01):
 *   - `render(input)`         — pure: returns markdown string from disk inputs.
 *   - `writeOutput(input)`    — writes `_logs/<id>/user-feedback.md` and
 *                               auto-invokes `--rerun` per C9.
 *
 * No SDK calls; rerun is stubbed via an injectable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseFeedback,
  readStructuredQuestions,
  render,
  writeOutput,
} from './forge-reflect-cli.ts';

type Harness = {
  logsRoot: string;
  cycleId: string;
  cycleDir: string;
  cleanup: () => void;
};

function setup(cycleId = 'CY-S6B-TEST'): Harness {
  const root = mkdtempSync(join(tmpdir(), 'forge-reflect-cli-test-'));
  const logsRoot = join(root, '_logs');
  const cycleDir = join(logsRoot, cycleId);
  mkdirSync(cycleDir, { recursive: true });
  return {
    logsRoot,
    cycleId,
    cycleDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeQuestionsFile(cycleDir: string, body: string): void {
  writeFileSync(join(cycleDir, 'user-questions.md'), body);
}

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

test('render: with 3 numbered questions returns markdown with each numbered line', () => {
  const h = setup();
  try {
    writeQuestionsFile(
      h.cycleDir,
      [
        '# Stage 2 — Operator questions',
        '',
        '## 1. Should we adopt the new schema?',
        'Context: the proposal landed in cycle X.',
        '',
        '## 2. Was the send-back justified?',
        'The reviewer flagged spec drift on iter 3.',
        '',
        '## 3. Do we keep the auto-fix opt-out?',
        '',
      ].join('\n'),
    );
    const out = render({ cycleId: h.cycleId, logsRoot: h.logsRoot });
    // header
    assert.match(out, new RegExp(`# /forge-reflect.*${h.cycleId}`));
    // each question rendered with its number
    assert.match(out, /### 1\. Should we adopt the new schema\?/);
    assert.match(out, /### 2\. Was the send-back justified\?/);
    assert.match(out, /### 3\. Do we keep the auto-fix opt-out\?/);
    // empty answer block placeholder
    assert.match(out, /> Your answer/);
    // free-form prompt
    assert.match(out, /Anything else for the brain/i);
  } finally {
    h.cleanup();
  }
});

test('render: with 0 questions returns a "no questions" stub but keeps free-form prompt', () => {
  const h = setup();
  try {
    writeQuestionsFile(h.cycleDir, '# Stage 2\n\n_(no questions)_\n');
    const out = render({ cycleId: h.cycleId, logsRoot: h.logsRoot });
    assert.match(out, /no questions/i);
    // free-form still offered
    assert.match(out, /Anything else for the brain/i);
    assert.match(out, /> Your feedback/);
  } finally {
    h.cleanup();
  }
});

test('render: missing user-questions.md returns "reflector has not run yet" stub', () => {
  const h = setup();
  try {
    // no questions file written
    const out = render({ cycleId: h.cycleId, logsRoot: h.logsRoot });
    assert.match(out, /reflector has not.*emitted questions yet/i);
    // free-form still available
    assert.match(out, /Anything else for the brain/i);
  } finally {
    h.cleanup();
  }
});

test('render: missing cycle dir throws with a clear message', () => {
  const h = setup();
  try {
    assert.throws(
      () => render({ cycleId: 'CY-DOES-NOT-EXIST', logsRoot: h.logsRoot }),
      /cycle log directory does not exist/i,
    );
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// writeOutput()
// ---------------------------------------------------------------------------

test('writeOutput: writes user-feedback.md in canonical format with numbered answers + freeform', async () => {
  const h = setup();
  try {
    writeQuestionsFile(
      h.cycleDir,
      [
        '## 1. Should we adopt the new schema?',
        '',
        '## 2. Was the send-back justified?',
        '',
      ].join('\n'),
    );
    const res = await writeOutput({
      cycleId: h.cycleId,
      logsRoot: h.logsRoot,
      answers: ['Yes — but only after the migration step.', 'No — operator typo on the spec.'],
      freeform: 'The dev-loop wedge on iter 4 needs a brain theme.',
      rerun: false,
    });
    assert.ok(existsSync(res.feedbackPath));
    const body = readFileSync(res.feedbackPath, 'utf8');
    assert.match(body, /# Reflection feedback/);
    assert.match(body, /## Answers to numbered questions/);
    assert.match(body, /### 1\. Should we adopt the new schema\?/);
    assert.match(body, /Yes — but only after the migration step\./);
    assert.match(body, /### 2\. Was the send-back justified\?/);
    assert.match(body, /No — operator typo on the spec\./);
    assert.match(body, /## Free-form feedback/);
    assert.match(body, /dev-loop wedge on iter 4/);
    assert.equal(res.rerun, false);
  } finally {
    h.cleanup();
  }
});

test('writeOutput: rerun:true (default per C9) invokes the reflector', async () => {
  const h = setup();
  try {
    writeQuestionsFile(h.cycleDir, '## 1. Q?\n\n');
    let invoked = false;
    let receivedCycleId: string | null = null;
    const res = await writeOutput({
      cycleId: h.cycleId,
      logsRoot: h.logsRoot,
      answers: ['A.'],
      freeform: '',
      // default rerun behaviour — pass nothing
      rerun: undefined,
      _rerunImpl: async ({ cycleId }) => {
        invoked = true;
        receivedCycleId = cycleId;
      },
    });
    assert.equal(invoked, true, 'expected rerun to fire by default');
    assert.equal(receivedCycleId, h.cycleId);
    assert.equal(res.rerun, true);
  } finally {
    h.cleanup();
  }
});

test('writeOutput: rerun:false explicit override skips the reflector invocation', async () => {
  const h = setup();
  try {
    writeQuestionsFile(h.cycleDir, '## 1. Q?\n\n');
    let invoked = false;
    const res = await writeOutput({
      cycleId: h.cycleId,
      logsRoot: h.logsRoot,
      answers: ['A.'],
      freeform: '',
      rerun: false,
      _rerunImpl: async () => {
        invoked = true;
      },
    });
    assert.equal(invoked, false, 'rerun must NOT fire when rerun:false');
    assert.equal(res.rerun, false);
  } finally {
    h.cleanup();
  }
});

test('writeOutput: missing cycle dir throws with clear message', async () => {
  const h = setup();
  try {
    await assert.rejects(
      writeOutput({
        cycleId: 'CY-DOES-NOT-EXIST',
        logsRoot: h.logsRoot,
        answers: [],
        freeform: '',
        rerun: false,
      }),
      /cycle log directory does not exist/i,
    );
  } finally {
    h.cleanup();
  }
});

test('writeOutput: with no questions still writes a free-form-only feedback file', async () => {
  const h = setup();
  try {
    // no questions file at all
    const res = await writeOutput({
      cycleId: h.cycleId,
      logsRoot: h.logsRoot,
      answers: [],
      freeform: 'A standalone observation for the brain.',
      rerun: false,
    });
    const body = readFileSync(res.feedbackPath, 'utf8');
    // no "Answers" section because no questions
    assert.doesNotMatch(body, /## Answers to numbered questions/);
    assert.match(body, /## Free-form feedback/);
    assert.match(body, /A standalone observation for the brain\./);
  } finally {
    h.cleanup();
  }
});

test('writeOutput: with no freeform writes the explicit-no-feedback placeholder', async () => {
  const h = setup();
  try {
    writeQuestionsFile(h.cycleDir, '## 1. Q?\n\n');
    const res = await writeOutput({
      cycleId: h.cycleId,
      logsRoot: h.logsRoot,
      answers: ['A.'],
      freeform: '',
      rerun: false,
    });
    const body = readFileSync(res.feedbackPath, 'utf8');
    assert.match(body, /no additional feedback this cycle/i);
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// parseFeedback — canonical round-trip
// ---------------------------------------------------------------------------

test('parseFeedback: round-trips numbered answers + freeform from a writeOutput result', async () => {
  const h = setup();
  try {
    writeQuestionsFile(
      h.cycleDir,
      ['## 1. First question?', '', '## 2. Second question?', ''].join('\n'),
    );
    const res = await writeOutput({
      cycleId: h.cycleId,
      logsRoot: h.logsRoot,
      answers: ['Answer A.', 'Answer B with multiple lines.\n\nSecond paragraph.'],
      freeform: 'Free-form observation.',
      rerun: false,
    });
    const body = readFileSync(res.feedbackPath, 'utf8');
    const parsed = parseFeedback(body);
    assert.equal(parsed.answers.length, 2);
    assert.equal(parsed.answers[0].question, 'First question?');
    assert.equal(parsed.answers[0].answer.trim(), 'Answer A.');
    assert.equal(parsed.answers[1].question, 'Second question?');
    assert.match(parsed.answers[1].answer, /Answer B with multiple lines/);
    assert.match(parsed.answers[1].answer, /Second paragraph/);
    assert.match(parsed.freeform, /Free-form observation\./);
  } finally {
    h.cleanup();
  }
});

test('parseFeedback: returns empty answers when there is no Answers section', () => {
  const body = [
    '# Reflection feedback — CY-XY',
    '',
    '## Free-form feedback',
    '',
    'Just commentary.',
    '',
  ].join('\n');
  const parsed = parseFeedback(body);
  assert.deepEqual(parsed.answers, []);
  assert.match(parsed.freeform, /Just commentary/);
});

// ---------------------------------------------------------------------------
// readStructuredQuestions() — cwc Amendment
// ---------------------------------------------------------------------------

test('readStructuredQuestions: prefers user-questions.json when present', () => {
  const h = setup();
  try {
    const payload = [
      {
        question: 'Was the 5-WI decomposition right?',
        header: 'WI sizing',
        options: [
          { label: 'Too small', description: '3-4 was correct.' },
          { label: 'Right size', description: '5 was correct.' },
          { label: 'Too large', description: '≥7 was correct.' },
        ],
      },
      {
        question: 'Should we backfill brain?',
        header: 'Brain gap',
        options: [
          { label: 'Yes', description: 'Backfill before next cycle.' },
          { label: 'No', description: 'Existing theme covers it.' },
        ],
      },
    ];
    writeFileSync(join(h.cycleDir, 'user-questions.json'), JSON.stringify(payload));
    // Also write the markdown so we prove JSON wins.
    writeFileSync(join(h.cycleDir, 'user-questions.md'), '## 1. Should be ignored?');

    const r = readStructuredQuestions(h.cycleId, h.logsRoot);
    assert.equal(r.source, 'json');
    assert.equal(r.questions.length, 2);
    assert.equal(r.questions[0].header, 'WI sizing');
    assert.equal(r.questions[0].options.length, 3);
    assert.equal(r.questions[1].header, 'Brain gap');
  } finally {
    h.cleanup();
  }
});

test('readStructuredQuestions: falls back to markdown when JSON absent', () => {
  const h = setup();
  try {
    writeQuestionsFile(h.cycleDir, [
      '## 1. Was the dev-loop iteration count reasonable?',
      'Context paragraph.',
      '## 2. Should the brain gain a theme on this pattern?',
      '',
    ].join('\n'));

    const r = readStructuredQuestions(h.cycleId, h.logsRoot);
    assert.equal(r.source, 'markdown');
    assert.equal(r.questions.length, 2);
    // The first question's text comes through verbatim
    assert.match(r.questions[0].question, /dev-loop iteration count/);
    // Generic synthesised options
    assert.equal(r.questions[0].options.length, 3);
    assert.match(r.questions[0].options[0].label, /Nothing notable/);
    assert.match(r.questions[0].options[1].label, /Worth a theme/);
    assert.match(r.questions[0].options[2].label, /Significant issue/);
    // Header heuristically truncated
    assert.ok(r.questions[0].header.length <= 12, `header too long: ${r.questions[0].header}`);
    assert.ok(r.questions[1].header.length <= 12);
  } finally {
    h.cleanup();
  }
});

test('readStructuredQuestions: returns source:none when neither file exists', () => {
  const h = setup();
  try {
    const r = readStructuredQuestions(h.cycleId, h.logsRoot);
    assert.equal(r.source, 'none');
    assert.deepEqual(r.questions, []);
  } finally {
    h.cleanup();
  }
});

test('readStructuredQuestions: malformed JSON falls through to markdown', () => {
  const h = setup();
  try {
    writeFileSync(join(h.cycleDir, 'user-questions.json'), '{not json');
    writeQuestionsFile(h.cycleDir, '## 1. Fallback question?');

    const r = readStructuredQuestions(h.cycleId, h.logsRoot);
    assert.equal(r.source, 'markdown');
    assert.equal(r.questions.length, 1);
    assert.match(r.questions[0].question, /Fallback question/);
  } finally {
    h.cleanup();
  }
});

test('readStructuredQuestions: JSON with bad shape (options too few/many) rejects, falls through', () => {
  const h = setup();
  try {
    const bad = [
      {
        question: 'q?',
        header: 'h',
        options: [{ label: 'only-one', description: 'too few options' }], // <2
      },
    ];
    writeFileSync(join(h.cycleDir, 'user-questions.json'), JSON.stringify(bad));
    // No markdown fallback → source:none
    const r = readStructuredQuestions(h.cycleId, h.logsRoot);
    assert.equal(r.source, 'none');
    assert.deepEqual(r.questions, []);
  } finally {
    h.cleanup();
  }
});

test('readStructuredQuestions: JSON with empty header field rejects', () => {
  const h = setup();
  try {
    const bad = [
      {
        question: 'q?',
        header: '', // empty header rejected
        options: [
          { label: 'a', description: 'aa' },
          { label: 'b', description: 'bb' },
        ],
      },
    ];
    writeFileSync(join(h.cycleDir, 'user-questions.json'), JSON.stringify(bad));
    const r = readStructuredQuestions(h.cycleId, h.logsRoot);
    assert.equal(r.source, 'none', 'empty header should cause JSON to be rejected');
  } finally {
    h.cleanup();
  }
});
