/**
 * Tests for the pure reflection-form helpers (M7-3, ADR-031). These gate the
 * submit button and assemble the answer payload posted to the bridge — the
 * load-bearing logic re-homed from /reflect/[cycleId] into the unified /artifact
 * reflection gate.
 */
import { test, expect } from 'vitest';
import { reflectionAllAnswered, buildReflectionAnswers } from './reflection-form.ts';
import type { ArchitectQuestion } from './bridge-client.ts';

function q(question: string): ArchitectQuestion {
  return { question, header: question };
}

const QUESTIONS: ArchitectQuestion[] = [q('How was WI sizing?'), q('Did deps hold?')];

test('reflectionAllAnswered: false when no questions', () => {
  expect(reflectionAllAnswered([], {})).toBe(false);
});

test('reflectionAllAnswered: false when some answers missing', () => {
  expect(reflectionAllAnswered(QUESTIONS, { 0: 'good' })).toBe(false);
});

test('reflectionAllAnswered: false when an answer is empty string', () => {
  expect(reflectionAllAnswered(QUESTIONS, { 0: 'good', 1: '' })).toBe(false);
});

test('reflectionAllAnswered: true when every question answered', () => {
  expect(reflectionAllAnswered(QUESTIONS, { 0: 'good', 1: 'yes' })).toBe(true);
});

test('buildReflectionAnswers: pairs each question with its choice', () => {
  const out = buildReflectionAnswers(QUESTIONS, { 0: 'too big', 1: 'held' });
  expect(out).toEqual([
    { question: 'How was WI sizing?', answer: 'too big' },
    { question: 'Did deps hold?', answer: 'held' },
  ]);
});

test('buildReflectionAnswers: marks unanswered questions as skipped', () => {
  const out = buildReflectionAnswers(QUESTIONS, { 0: 'too big' });
  expect(out[1]).toEqual({ question: 'Did deps hold?', answer: '[operator skipped]' });
});

test('buildReflectionAnswers: empty questions → empty payload', () => {
  expect(buildReflectionAnswers([], {})).toEqual([]);
});
