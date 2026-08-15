/**
 * Unit tests for `demo-entry-view.ts` (W6-B10 — the demo-builder entrypoint
 * repair). Pure logic, no jsdom (mirrors `contract-resolution-view.test.ts`'s
 * own convention).
 */
import { test, expect } from 'vitest';

import { findInFlightDemoSession, resolveDemoEntryHref } from './demo-entry-view';
import type { DemoSessionSummary } from './bridge-client';

function session(overrides: Partial<DemoSessionSummary>): DemoSessionSummary {
  return {
    sessionId: 's1',
    project: 'proj-a',
    projectRepoPath: '/repo',
    phase: 'generating',
    mode: 'create',
    targetElement: null,
    hasLockedDemo: false,
    iteration: 1,
    prompt: '',
    demoUrl: null,
    fragments: [],
    ...overrides,
  };
}

test('findInFlightDemoSession: finds a session for the project that is neither locked nor abandoned', () => {
  const sessions = [session({ sessionId: 's1', project: 'proj-a', phase: 'generating' })];
  const found = findInFlightDemoSession(sessions, 'proj-a');
  expect(found?.sessionId).toBe('s1');
});

test('findInFlightDemoSession: excludes a locked session — nothing in flight', () => {
  const sessions = [session({ sessionId: 's1', project: 'proj-a', phase: 'locked' })];
  expect(findInFlightDemoSession(sessions, 'proj-a')).toBeNull();
});

test('findInFlightDemoSession: excludes an abandoned session — nothing in flight', () => {
  const sessions = [session({ sessionId: 's1', project: 'proj-a', phase: 'abandoned' })];
  expect(findInFlightDemoSession(sessions, 'proj-a')).toBeNull();
});

test('findInFlightDemoSession: ignores sessions belonging to a DIFFERENT project', () => {
  const sessions = [session({ sessionId: 's1', project: 'proj-b', phase: 'generating' })];
  expect(findInFlightDemoSession(sessions, 'proj-a')).toBeNull();
});

test('findInFlightDemoSession: no sessions at all -> null', () => {
  expect(findInFlightDemoSession([], 'proj-a')).toBeNull();
});

test('findInFlightDemoSession: multiple sessions — returns the in-flight one for the right project, ignoring locked/abandoned/other-project noise', () => {
  const sessions = [
    session({ sessionId: 'locked-1', project: 'proj-a', phase: 'locked' }),
    session({ sessionId: 'other-proj', project: 'proj-b', phase: 'generating' }),
    session({ sessionId: 'the-one', project: 'proj-a', phase: 'awaiting-review' }),
  ];
  expect(findInFlightDemoSession(sessions, 'proj-a')?.sessionId).toBe('the-one');
});

test('resolveDemoEntryHref: an in-flight session resumes to the dedicated session screen with ?project=', () => {
  const sessions = [session({ sessionId: 'sid-123', project: 'proj-a', phase: 'briefing' })];
  const href = resolveDemoEntryHref(sessions, 'proj-a', 'INIT-7');
  expect(href).toBe('/sessions/demo/sid-123?project=proj-a');
});

test('resolveDemoEntryHref: no in-flight session falls to the kickoff screen, prefilled with project + initiative', () => {
  const href = resolveDemoEntryHref([], 'proj-a', 'INIT-7');
  expect(href).toBe('/sessions/demo/new?project=proj-a&initiative=INIT-7');
});

test('resolveDemoEntryHref: a locked-only session (no in-flight one) falls to kickoff, not the locked session', () => {
  const sessions = [session({ sessionId: 'sid-locked', project: 'proj-a', phase: 'locked' })];
  const href = resolveDemoEntryHref(sessions, 'proj-a', 'INIT-7');
  expect(href).toBe('/sessions/demo/new?project=proj-a&initiative=INIT-7');
});

test('resolveDemoEntryHref: encodes project/session/initiative ids that need it', () => {
  const sessions = [session({ sessionId: 'sid one', project: 'proj a', phase: 'generating' })];
  const href = resolveDemoEntryHref(sessions, 'proj a', 'init/7');
  expect(href).toBe('/sessions/demo/sid%20one?project=proj%20a');

  const kickoffHref = resolveDemoEntryHref([], 'proj a', 'init/7');
  expect(kickoffHref).toBe('/sessions/demo/new?project=proj%20a&initiative=init%2F7');
});
