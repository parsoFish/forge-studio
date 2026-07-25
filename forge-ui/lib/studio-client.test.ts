/**
 * Tests for `parseCapability` (R2-02-F1/AC3) — the client-side parse of the
 * server-computed `capability` field on GET /api/studio/agents and
 * GET /api/studio/starters. AC3 requires the descriptor be carried through
 * verbatim, never re-derived client-side; this locks the parse boundary
 * (well-formed → passed through, absent/malformed → undefined, no throw).
 *
 * Also covers `buildTriggerDeclaration` + `isValidCronSchedule` (R2-04-F4) —
 * the pure, DOM-free trigger-authoring logic FlowHeader's kind selector
 * delegates to, extracted so it's unit-testable without mounting the
 * component.
 */
import { test, expect } from 'vitest';

import { parseCapability, buildTriggerDeclaration, isValidCronSchedule } from './studio-client';

test('parseCapability: a well-formed descriptor is carried through verbatim', () => {
  expect(parseCapability({ interactive: true, runtimeSdks: ['claude-code'] }))
    .toEqual({ interactive: true, runtimeSdks: ['claude-code'] });
  expect(parseCapability({ interactive: false, runtimeSdks: [] }))
    .toEqual({ interactive: false, runtimeSdks: [] });
});

test('parseCapability: undefined/absent input returns undefined', () => {
  expect(parseCapability(undefined)).toBeUndefined();
  expect(parseCapability(null)).toBeUndefined();
});

test('parseCapability: malformed shapes return undefined without throwing (older bridge payload)', () => {
  expect(parseCapability({})).toBeUndefined();
  expect(parseCapability({ interactive: 'yes', runtimeSdks: ['claude-code'] })).toBeUndefined();
  expect(parseCapability({ interactive: true, runtimeSdks: 'claude-code' })).toBeUndefined();
  expect(parseCapability({ interactive: true })).toBeUndefined();
  expect(parseCapability('not-an-object')).toBeUndefined();
  expect(parseCapability(42)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// buildTriggerDeclaration / isValidCronSchedule (R2-04-F4)
// ---------------------------------------------------------------------------

test('buildTriggerDeclaration: flow-complete/merged build {on, target} with no other fields', () => {
  expect(buildTriggerDeclaration('flow-complete', { targetId: 'forge-develop' }))
    .toEqual({ on: 'flow-complete', target: { kind: 'flow', ref: 'forge-develop' } });
  expect(buildTriggerDeclaration('merged', { targetId: 'forge-reflect' }))
    .toEqual({ on: 'merged', target: { kind: 'flow', ref: 'forge-reflect' } });
});

test('buildTriggerDeclaration: missing targetId returns null for every kind', () => {
  expect(buildTriggerDeclaration('flow-complete', { targetId: '' })).toBeNull();
  expect(buildTriggerDeclaration('cron', { targetId: '', schedule: '0 3 * * *' })).toBeNull();
  expect(buildTriggerDeclaration('webhook', {
    targetId: '', webhookId: 'h', webhookProvider: 'github',
    webhookEvents: ['push'], webhookSecretEnv: 'SECRET', webhookSources: 'a/b',
  })).toBeNull();
});

test('buildTriggerDeclaration: cron requires a non-empty schedule; concurrency defaults to forbid', () => {
  expect(buildTriggerDeclaration('cron', { targetId: 'nightly' })).toBeNull();
  expect(buildTriggerDeclaration('cron', { targetId: 'nightly', schedule: '   ' })).toBeNull();
  expect(buildTriggerDeclaration('cron', { targetId: 'nightly', schedule: '0 3 * * *' }))
    .toEqual({ on: 'cron', target: { kind: 'flow', ref: 'nightly' }, schedule: '0 3 * * *', concurrency: 'forbid' });
  expect(buildTriggerDeclaration('cron', { targetId: 'nightly', schedule: '0 3 * * *', concurrency: 'allow' }))
    .toEqual({ on: 'cron', target: { kind: 'flow', ref: 'nightly' }, schedule: '0 3 * * *', concurrency: 'allow' });
});

test('buildTriggerDeclaration: webhook requires id/provider/secretEnv + non-empty events and sources', () => {
  const base = {
    targetId: 'develop', webhookId: 'myproj-push', webhookProvider: 'github' as const,
    webhookEvents: ['push' as const], webhookSecretEnv: 'MYPROJ_WEBHOOK_SECRET', webhookSources: 'parsoFish/myproj',
  };
  expect(buildTriggerDeclaration('webhook', base)).toEqual({
    on: 'webhook',
    target: { kind: 'flow', ref: 'develop' },
    webhook: {
      id: 'myproj-push', provider: 'github', events: ['push'],
      secretEnv: 'MYPROJ_WEBHOOK_SECRET', sources: ['parsoFish/myproj'],
    },
  });
  expect(buildTriggerDeclaration('webhook', { ...base, webhookEvents: [] })).toBeNull();
  expect(buildTriggerDeclaration('webhook', { ...base, webhookSources: '' })).toBeNull();
  expect(buildTriggerDeclaration('webhook', { ...base, webhookSecretEnv: undefined })).toBeNull();
  expect(buildTriggerDeclaration('webhook', { ...base, webhookId: undefined })).toBeNull();
});

test('buildTriggerDeclaration: webhook sources is a trimmed, comma-split list', () => {
  const result = buildTriggerDeclaration('webhook', {
    targetId: 'develop', webhookId: 'h', webhookProvider: 'gitea',
    webhookEvents: ['push', 'release'], webhookSecretEnv: 'SECRET',
    webhookSources: ' parsoFish/a , parsoFish/b ,,',
  });
  expect(result?.webhook?.sources).toEqual(['parsoFish/a', 'parsoFish/b']);
});

test('isValidCronSchedule: valid croner patterns pass, empty/invalid do not throw and return false', () => {
  expect(isValidCronSchedule('0 3 * * *')).toBe(true);
  expect(isValidCronSchedule('*/5 * * * *')).toBe(true);
  expect(isValidCronSchedule('')).toBe(false);
  expect(isValidCronSchedule('   ')).toBe(false);
  expect(isValidCronSchedule('not a cron pattern')).toBe(false);
  expect(isValidCronSchedule('99 99 * * *')).toBe(false);
});
