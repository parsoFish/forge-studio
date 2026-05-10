/**
 * Unit tests for benchmarks/reflection/simulator.ts.
 *
 * The simulator is a file-based shim — its surface is small (write feedback,
 * read questions). Tests cover idempotency + the diagnostic question-heading
 * scan that downstream telemetry depends on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareUserFeedback, readUserQuestions, runSimulator } from './simulator.ts';

function setupCycleLogDir(): { cycleLogDir: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-bench-reflect-sim-'));
  const cycleLogDir = join(root, '_logs', 'CY-test');
  mkdirSync(cycleLogDir, { recursive: true });
  return { cycleLogDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('prepareUserFeedback: writes canned content to user-feedback.md', () => {
  const t = setupCycleLogDir();
  try {
    const r = prepareUserFeedback({
      cycleLogDir: t.cycleLogDir,
      cannedFeedback: 'Hello, reflector.',
    });
    assert.equal(existsSync(r.feedbackPath), true);
    assert.equal(r.feedbackPath, join(t.cycleLogDir, 'user-feedback.md'));
    assert.equal(readFileSync(r.feedbackPath, 'utf8'), 'Hello, reflector.');
    assert.equal(r.bytes, Buffer.byteLength('Hello, reflector.', 'utf8'));
  } finally {
    t.cleanup();
  }
});

test('prepareUserFeedback: creates parent directory when missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-bench-reflect-sim-'));
  try {
    const cycleLogDir = join(root, 'newly', 'nested', 'path');
    const r = prepareUserFeedback({
      cycleLogDir,
      cannedFeedback: 'content',
    });
    assert.equal(existsSync(r.feedbackPath), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prepareUserFeedback: idempotent — same content does not re-write', () => {
  const t = setupCycleLogDir();
  try {
    const first = prepareUserFeedback({
      cycleLogDir: t.cycleLogDir,
      cannedFeedback: 'identical',
    });
    const second = prepareUserFeedback({
      cycleLogDir: t.cycleLogDir,
      cannedFeedback: 'identical',
    });
    assert.equal(first.feedbackPath, second.feedbackPath);
    assert.equal(readFileSync(first.feedbackPath, 'utf8'), 'identical');
  } finally {
    t.cleanup();
  }
});

test('prepareUserFeedback: overwrites when content differs', () => {
  const t = setupCycleLogDir();
  try {
    prepareUserFeedback({
      cycleLogDir: t.cycleLogDir,
      cannedFeedback: 'old',
    });
    const r = prepareUserFeedback({
      cycleLogDir: t.cycleLogDir,
      cannedFeedback: 'new',
    });
    assert.equal(readFileSync(r.feedbackPath, 'utf8'), 'new');
  } finally {
    t.cleanup();
  }
});

test('prepareUserFeedback: accepts empty content (signals no-feedback)', () => {
  const t = setupCycleLogDir();
  try {
    const r = prepareUserFeedback({
      cycleLogDir: t.cycleLogDir,
      cannedFeedback: '',
    });
    assert.equal(existsSync(r.feedbackPath), true);
    assert.equal(r.bytes, 0);
  } finally {
    t.cleanup();
  }
});

test('readUserQuestions: returns empty when file missing', () => {
  const t = setupCycleLogDir();
  try {
    assert.deepEqual(readUserQuestions(t.cycleLogDir), []);
  } finally {
    t.cleanup();
  }
});

test('readUserQuestions: extracts h1/h2/h3 headings', () => {
  const t = setupCycleLogDir();
  try {
    writeFileSync(
      join(t.cycleLogDir, 'user-questions.md'),
      [
        '# What worked unusually well?',
        '',
        '## Was the multi-feature decomposition the right call?',
        '',
        'body text',
        '',
        '### Subheading',
      ].join('\n'),
    );
    const headings = readUserQuestions(t.cycleLogDir);
    assert.deepEqual(headings, [
      'What worked unusually well?',
      'Was the multi-feature decomposition the right call?',
      'Subheading',
    ]);
  } finally {
    t.cleanup();
  }
});

test('readUserQuestions: ignores non-heading lines that contain hashes', () => {
  const t = setupCycleLogDir();
  try {
    writeFileSync(
      join(t.cycleLogDir, 'user-questions.md'),
      [
        '# Real heading',
        'A line with #hashtag in the middle',
        'Some body talking about #1 priority',
      ].join('\n'),
    );
    assert.deepEqual(readUserQuestions(t.cycleLogDir), ['Real heading']);
  } finally {
    t.cleanup();
  }
});

test('readUserQuestions: ignores h4+ headings', () => {
  const t = setupCycleLogDir();
  try {
    writeFileSync(
      join(t.cycleLogDir, 'user-questions.md'),
      [
        '#### Too deep, ignored',
        '##### Also too deep',
        '## Captured',
      ].join('\n'),
    );
    assert.deepEqual(readUserQuestions(t.cycleLogDir), ['Captured']);
  } finally {
    t.cleanup();
  }
});

test('runSimulator: returns combined feedback + questions report', () => {
  const t = setupCycleLogDir();
  try {
    // Pre-write a questions file as if the reflector emitted it.
    writeFileSync(
      join(t.cycleLogDir, 'user-questions.md'),
      '## Question one\n\n## Question two\n',
    );
    const report = runSimulator({
      cycleLogDir: t.cycleLogDir,
      cannedFeedback: 'feedback body',
    });
    assert.equal(report.feedbackWritten, true);
    assert.equal(report.feedbackBytes, Buffer.byteLength('feedback body', 'utf8'));
    assert.deepEqual(report.questionsObserved, ['Question one', 'Question two']);
  } finally {
    t.cleanup();
  }
});

test('runSimulator: feedbackWritten=false when canned content is empty', () => {
  const t = setupCycleLogDir();
  try {
    const report = runSimulator({
      cycleLogDir: t.cycleLogDir,
      cannedFeedback: '',
    });
    assert.equal(report.feedbackWritten, false);
    assert.equal(report.feedbackBytes, 0);
    assert.equal(existsSync(report.feedbackPath), true);
  } finally {
    t.cleanup();
  }
});
