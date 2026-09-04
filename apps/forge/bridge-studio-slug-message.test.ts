/**
 * W7-A1 (walkthrough library-13) — the malformed-id error the bridge sends
 * for `/api/studio/{hooks,connections,community}/<bad-id>` must (a) name the
 * RIGHT object kind and (b) survive `sanitizeError`'s path redaction intact.
 *
 * Before: `assertSkillSlug` (orchestrator/skill-path.ts) hard-coded "invalid
 * skill id" for every caller (hooks/connections both reused it verbatim), and
 * embedded the RegExp LITERAL `/^[a-z]…$/` in the message — whose leading `/`
 * `sanitizeError` (apps/forge/bridge-studio.ts, `/\/[^\s:,'"]+/g` → "[path]") ate,
 * producing the garbled `must match [path]:-[a-z0-9]+)*$/` the walkthrough
 * captured on the wire.
 *
 * Kills: a message that still says "skill" for a hook/connection; a message
 * whose pattern text does not survive sanitizeError byte-for-byte.
 *
 * RUN: node --test --experimental-strip-types apps/forge/bridge-studio-slug-message.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSkillSlug, SLUG_RE, SLUG_RULE_TEXT } from '@forge/agents/skill-path.ts';
import { sanitizeError } from './bridge-studio.ts';

function messageFor(id: string, noun?: string): string {
  try {
    if (noun === undefined) assertSkillSlug(id); else assertSkillSlug(id, noun);
  } catch (err) {
    return sanitizeError(err);
  }
  throw new Error(`expected assertSkillSlug(${JSON.stringify(id)}) to throw`);
}

test('the message names the caller-supplied noun: hook / connection / community item — and defaults to "skill"', () => {
  assert.match(messageFor('Bad Id', 'hook'), /^Error: invalid hook id /);
  assert.match(messageFor('Bad Id', 'connection'), /^Error: invalid connection id /);
  assert.match(messageFor('Bad Id', 'community item'), /^Error: invalid community item id /);
  assert.match(messageFor('Bad Id'), /^Error: invalid skill id /);
  assert.doesNotMatch(messageFor('Bad Id', 'hook'), /skill/);
});

test('the slug rule survives sanitizeError intact — the pattern is emitted as its bare source, never a `/…/` literal that the path redaction eats', () => {
  const wire = messageFor('Bad Id', 'hook');
  assert.ok(wire.includes(SLUG_RULE_TEXT), `expected the full rule text on the wire, got: ${wire}`);
  assert.ok(wire.includes(SLUG_RE.source), `expected the bare pattern source ${SLUG_RE.source} on the wire, got: ${wire}`);
  assert.ok(!wire.includes('[path]'), `sanitizeError must not redact any part of the rule text: ${wire}`);
  assert.ok(!wire.includes(String(SLUG_RE)), 'the RegExp literal form (with slashes) must not be on the wire');
});

test('the length-cap message also carries the noun', () => {
  const wire = messageFor('a'.repeat(300), 'connection');
  assert.match(wire, /invalid connection id/);
  assert.match(wire, /length limit for a connection id/);
});

test('a traversal-shaped id is still rejected (the rule did not loosen) and its own path segments ARE redacted — only the rule text is protected', () => {
  const wire = messageFor('../../etc', 'hook');
  assert.match(wire, /^Error: invalid hook id/);
  assert.ok(wire.includes(SLUG_RULE_TEXT));
  assert.ok(wire.includes('[path]'), 'the offending id itself is still path-redacted');
});
