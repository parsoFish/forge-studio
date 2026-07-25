/**
 * Tests for orchestrator/webhook-verify.ts (R2-04, ADR-041).
 *
 * FAIL CLOSED is the security-sensitive property under test: a missing or
 * empty secret env value must ALWAYS be a 503, never a silent pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { verifyWebhookSignature } from './webhook-verify.ts';

const SECRET_ENV = 'TEST_WEBHOOK_SECRET_R204';
const PREVIOUS_SECRET_ENV = 'TEST_WEBHOOK_SECRET_R204_PREV';

function githubSig(secret: string, payload: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

// ---------------------------------------------------------------------------
// github / gitea (shared X-Hub-Signature-256 HMAC scheme)
// ---------------------------------------------------------------------------

test('github: valid HMAC signature verifies ok', () =>
  withEnv({ [SECRET_ENV]: 'sekrit' }, async () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const sig = githubSig('sekrit', rawBody.toString('utf8'));
    const result = await verifyWebhookSignature({
      provider: 'github',
      rawBody,
      headers: { 'x-hub-signature-256': sig },
      secretEnv: SECRET_ENV,
    });
    assert.deepEqual(result, { ok: true });
  }));

test('github: invalid signature (wrong secret) → 401', () =>
  withEnv({ [SECRET_ENV]: 'sekrit' }, async () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const sig = githubSig('wrong-secret', rawBody.toString('utf8'));
    const result = await verifyWebhookSignature({
      provider: 'github',
      rawBody,
      headers: { 'x-hub-signature-256': sig },
      secretEnv: SECRET_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 401);
  }));

test('github: tampered body → 401', () =>
  withEnv({ [SECRET_ENV]: 'sekrit' }, async () => {
    const signedBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const sig = githubSig('sekrit', signedBody.toString('utf8'));
    const tamperedBody = Buffer.from(JSON.stringify({ hello: 'mallory' }));
    const result = await verifyWebhookSignature({
      provider: 'github',
      rawBody: tamperedBody,
      headers: { 'x-hub-signature-256': sig },
      secretEnv: SECRET_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 401);
  }));

test('github: missing signature header → 401', () =>
  withEnv({ [SECRET_ENV]: 'sekrit' }, async () => {
    const result = await verifyWebhookSignature({
      provider: 'github',
      rawBody: Buffer.from('{}'),
      headers: {},
      secretEnv: SECRET_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 401);
  }));

test('gitea: shares the X-Hub-Signature-256 scheme', () =>
  withEnv({ [SECRET_ENV]: 'gitea-secret' }, async () => {
    const rawBody = Buffer.from('{"push":true}');
    const sig = githubSig('gitea-secret', rawBody.toString('utf8'));
    const result = await verifyWebhookSignature({
      provider: 'gitea',
      rawBody,
      headers: { 'x-hub-signature-256': sig },
      secretEnv: SECRET_ENV,
    });
    assert.deepEqual(result, { ok: true });
  }));

// ---------------------------------------------------------------------------
// secret unavailable → fail closed (503)
// ---------------------------------------------------------------------------

test('missing secret env value → 503 (fail closed), never a silent pass', () =>
  withEnv({ [SECRET_ENV]: undefined }, async () => {
    const rawBody = Buffer.from('{}');
    const result = await verifyWebhookSignature({
      provider: 'github',
      rawBody,
      headers: { 'x-hub-signature-256': githubSig('anything', rawBody.toString('utf8')) },
      secretEnv: SECRET_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 503);
    assert.equal((result as { reason: string }).reason, 'secret unavailable');
  }));

test('empty-string secret env value → 503 (fail closed)', () =>
  withEnv({ [SECRET_ENV]: '' }, async () => {
    const result = await verifyWebhookSignature({
      provider: 'gitlab',
      rawBody: Buffer.from('{}'),
      headers: { 'x-gitlab-token': 'whatever' },
      secretEnv: SECRET_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 503);
  }));

// ---------------------------------------------------------------------------
// rotation: secretEnvPrevious fallback (github via verifyWithFallback)
// ---------------------------------------------------------------------------

test('github: old secret verifies via secretEnvPrevious fallback during rotation', () =>
  withEnv({ [SECRET_ENV]: 'new-secret', [PREVIOUS_SECRET_ENV]: 'old-secret' }, async () => {
    const rawBody = Buffer.from('{"rotated":true}');
    const sigWithOldSecret = githubSig('old-secret', rawBody.toString('utf8'));
    const result = await verifyWebhookSignature({
      provider: 'github',
      rawBody,
      headers: { 'x-hub-signature-256': sigWithOldSecret },
      secretEnv: SECRET_ENV,
      secretEnvPrevious: PREVIOUS_SECRET_ENV,
    });
    assert.deepEqual(result, { ok: true });
  }));

test('github: current secret still verifies when secretEnvPrevious is also set', () =>
  withEnv({ [SECRET_ENV]: 'new-secret', [PREVIOUS_SECRET_ENV]: 'old-secret' }, async () => {
    const rawBody = Buffer.from('{"rotated":true}');
    const sigWithNewSecret = githubSig('new-secret', rawBody.toString('utf8'));
    const result = await verifyWebhookSignature({
      provider: 'github',
      rawBody,
      headers: { 'x-hub-signature-256': sigWithNewSecret },
      secretEnv: SECRET_ENV,
      secretEnvPrevious: PREVIOUS_SECRET_ENV,
    });
    assert.deepEqual(result, { ok: true });
  }));

test('github: neither current nor previous secret verifies → 401', () =>
  withEnv({ [SECRET_ENV]: 'new-secret', [PREVIOUS_SECRET_ENV]: 'old-secret' }, async () => {
    const rawBody = Buffer.from('{"rotated":true}');
    const sigWithWrongSecret = githubSig('totally-wrong', rawBody.toString('utf8'));
    const result = await verifyWebhookSignature({
      provider: 'github',
      rawBody,
      headers: { 'x-hub-signature-256': sigWithWrongSecret },
      secretEnv: SECRET_ENV,
      secretEnvPrevious: PREVIOUS_SECRET_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 401);
  }));

test('github: secretEnvPrevious set but its env value is empty → not consulted (no fallback)', () =>
  withEnv({ [SECRET_ENV]: 'new-secret', [PREVIOUS_SECRET_ENV]: '' }, async () => {
    const rawBody = Buffer.from('{"rotated":true}');
    // Sign with what WOULD be the "previous" secret if it were consulted —
    // since the env value is empty it must NOT be, so this must fail.
    const sig = githubSig('old-secret', rawBody.toString('utf8'));
    const result = await verifyWebhookSignature({
      provider: 'github',
      rawBody,
      headers: { 'x-hub-signature-256': sig },
      secretEnv: SECRET_ENV,
      secretEnvPrevious: PREVIOUS_SECRET_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 401);
  }));

// ---------------------------------------------------------------------------
// gitlab: static X-Gitlab-Token header, timing-safe compare
// ---------------------------------------------------------------------------

test('gitlab: matching token verifies ok', () =>
  withEnv({ [SECRET_ENV]: 'gitlab-token-value' }, async () => {
    const result = await verifyWebhookSignature({
      provider: 'gitlab',
      rawBody: Buffer.from('{}'),
      headers: { 'x-gitlab-token': 'gitlab-token-value' },
      secretEnv: SECRET_ENV,
    });
    assert.deepEqual(result, { ok: true });
  }));

test('gitlab: mismatched token (same length) → 401', () =>
  withEnv({ [SECRET_ENV]: 'gitlab-token-value' }, async () => {
    const result = await verifyWebhookSignature({
      provider: 'gitlab',
      rawBody: Buffer.from('{}'),
      headers: { 'x-gitlab-token': 'gitlab-token-wrong' }, // same length as the secret
      secretEnv: SECRET_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 401);
  }));

test('gitlab: mismatched token LENGTH → 401 without throwing (timingSafeEqual guard)', () =>
  withEnv({ [SECRET_ENV]: 'gitlab-token-value' }, async () => {
    // A length mismatch must be pre-checked and short-circuit to 401 —
    // node's timingSafeEqual THROWS on unequal buffer lengths, which this
    // must never let escape as an unhandled rejection.
    await assert.doesNotReject(
      verifyWebhookSignature({
        provider: 'gitlab',
        rawBody: Buffer.from('{}'),
        headers: { 'x-gitlab-token': 'short' },
        secretEnv: SECRET_ENV,
      }),
    );
    const result = await verifyWebhookSignature({
      provider: 'gitlab',
      rawBody: Buffer.from('{}'),
      headers: { 'x-gitlab-token': 'short' },
      secretEnv: SECRET_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 401);
  }));

test('gitlab: missing token header → 401', () =>
  withEnv({ [SECRET_ENV]: 'gitlab-token-value' }, async () => {
    const result = await verifyWebhookSignature({
      provider: 'gitlab',
      rawBody: Buffer.from('{}'),
      headers: {},
      secretEnv: SECRET_ENV,
    });
    assert.equal(result.ok, false);
    assert.equal((result as { status: number }).status, 401);
  }));

test('gitlab: rotation — old token verifies via secretEnvPrevious', () =>
  withEnv({ [SECRET_ENV]: 'new-gitlab-token', [PREVIOUS_SECRET_ENV]: 'old-gitlab-token' }, async () => {
    const result = await verifyWebhookSignature({
      provider: 'gitlab',
      rawBody: Buffer.from('{}'),
      headers: { 'x-gitlab-token': 'old-gitlab-token' },
      secretEnv: SECRET_ENV,
      secretEnvPrevious: PREVIOUS_SECRET_ENV,
    });
    assert.deepEqual(result, { ok: true });
  }));
