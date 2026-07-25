/**
 * R2-04 (ADR-041) — webhook signature verification for the bridge's
 * `POST /api/hooks/:hookId` route (cli/bridge-hooks.ts).
 *
 * github/gitea share GitHub's `X-Hub-Signature-256` HMAC-SHA256 scheme
 * (verified via `@octokit/webhooks-methods`, battle-tested rather than
 * hand-rolled HMAC comparison); gitlab uses a static `X-Gitlab-Token` header,
 * compared with `crypto.timingSafeEqual`. The shared secret is resolved from
 * the OPERATOR's environment by NAME (`WebhookTriggerConfig.secretEnv`) —
 * never from the flow.yaml declaration itself, which only ever carries the
 * env-var name.
 *
 * FAIL CLOSED is the one security-sensitive line in this module: a missing
 * or empty secret env value is ALWAYS a 503 (secret unavailable), never
 * treated as "skip verification" or silently accepted.
 */
import { timingSafeEqual } from 'node:crypto';
import { verify, verifyWithFallback } from '@octokit/webhooks-methods';

export type WebhookProvider = 'github' | 'gitea' | 'gitlab';

export type VerifyWebhookSignatureInput = {
  provider: WebhookProvider;
  /** The RAW request body — HMAC/signature verification runs over these exact
   *  bytes, BEFORE any JSON.parse (a re-serialized body will not match). */
  rawBody: Buffer;
  /** Node http headers — already lower-cased by node's http module. */
  headers: Record<string, string | string[] | undefined>;
  /** Env-var NAME holding the shared secret; the value is read from
   *  `process.env` here, never passed in directly. */
  secretEnv: string;
  /** Optional previous-secret env-var name — rotation window via
   *  `verifyWithFallback` (github/gitea) / a second timing-safe compare
   *  (gitlab). Only consulted when its env value is a non-empty string. */
  secretEnvPrevious?: string;
};

export type VerifyWebhookSignatureResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; reason: string };

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Length-checked BEFORE `timingSafeEqual`, which throws on a length
 *  mismatch rather than returning false. */
function constantTimeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify a webhook receipt's signature/token per provider. Resolves the
 * secret(s) from `process.env` by the NAMES the caller supplies (never takes
 * a secret value directly) so the fail-closed check lives in exactly one
 * place. Returns a typed ok/reason result — never throws on a bad or missing
 * signature (only a truly unexpected error, e.g. from the underlying crypto
 * calls, escapes as a rejected promise).
 */
export async function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
): Promise<VerifyWebhookSignatureResult> {
  const secret = process.env[input.secretEnv];
  if (!secret) {
    return { ok: false, status: 503, reason: 'secret unavailable' };
  }
  const previous = input.secretEnvPrevious ? process.env[input.secretEnvPrevious] : undefined;

  if (input.provider === 'github' || input.provider === 'gitea') {
    const sig = headerValue(input.headers, 'x-hub-signature-256');
    if (!sig) {
      return { ok: false, status: 401, reason: 'missing signature header' };
    }
    const payload = input.rawBody.toString('utf8');
    const valid = previous
      ? await verifyWithFallback(secret, payload, sig, [previous])
      : await verify(secret, payload, sig);
    if (!valid) {
      return { ok: false, status: 401, reason: 'signature verification failed' };
    }
    return { ok: true };
  }

  // gitlab: a static shared-secret token header, timing-safe compared —
  // there is no HMAC scheme, so no @octokit helper applies here.
  const token = headerValue(input.headers, 'x-gitlab-token');
  if (!token) {
    return { ok: false, status: 401, reason: 'missing token header' };
  }
  if (constantTimeStringEqual(token, secret)) {
    return { ok: true };
  }
  if (previous && constantTimeStringEqual(token, previous)) {
    return { ok: true };
  }
  return { ok: false, status: 401, reason: 'token mismatch' };
}
