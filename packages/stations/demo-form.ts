/**
 * Evidence forms (forge-mfv5.1.19): demo.json's per-checkpoint `form`,
 * `apiPath` and per-demo `narrative` — validated and rendered
 * here so `demo-model.ts` (D-07's one schema) stays under the file cap — and
 * the JSON half of the control `demo-delta.ts` applies to `api-before-after`.
 * The narrative is agent prose, never evidence: DEMO.md labels it so and the
 * control never reads it.
 */

import { isOwnServerPath } from '@forge/projects';

import type { DemoModelCheckpoint } from './demo-model.ts';

export const DEMO_EVIDENCE_FORMS = ['cli-before-after', 'api-before-after', 'screenshot', 'test-evidence'] as const;
export type DemoEvidenceForm = (typeof DEMO_EVIDENCE_FORMS)[number];

/** A narrative longer than this is a second essay, not a paragraph. */
export const NARRATIVE_MAX_WORDS = 120;
export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

export function validateFormFields(cp: Record<string, unknown>, at: string): string[] {
  const errors: string[] = [];
  if (cp.form !== undefined && !(DEMO_EVIDENCE_FORMS as readonly unknown[]).includes(cp.form)) {
    errors.push(`${at}.form must be one of ${DEMO_EVIDENCE_FORMS.join('|')} when set (got ${JSON.stringify(cp.form)})`);
  }
  if (cp.apiPath !== undefined && (typeof cp.apiPath !== 'string' || !isOwnServerPath(cp.apiPath))) {
    errors.push(`${at}.apiPath must be a path on the tree's own server — no scheme, host or traversal (got ${JSON.stringify(cp.apiPath)})`);
  }
  if (cp.apiPath !== undefined && (cp.command !== undefined || cp.form !== 'api-before-after')) {
    errors.push(`${at}.apiPath belongs to form api-before-after alone — one driver per checkpoint, never with a command`);
  }
  return errors;
}

export function validateNarrative(narrative: unknown): string[] {
  if (narrative === undefined) return [];
  if (typeof narrative !== 'string' || narrative.trim() === '') return ['narrative must be a non-empty string when set'];
  const words = wordCount(narrative);
  return words > NARRATIVE_MAX_WORDS ? [`narrative is ${words} words — at most ${NARRATIVE_MAX_WORDS}`] : [];
}

/** DEMO.md's "What this enables" section, labelled as narrative. */
export const narrativeLines = (narrative: string | undefined): string[] =>
  narrative ? ['## What this enables', '', '_Agent narrative — not evidence._', '', narrative.trim(), ''] : [];

/** What a captured checkpoint ran: its command, or the GET on the tree's own server. */
export function sourceLine(c: DemoModelCheckpoint): string | null {
  if (c.command) return `- **Command:** \`${c.command}\``;
  return c.apiPath ? `- **GET (each tree's own server):** \`${c.apiPath}\`` : null;
}

/** Keys that differ on every read of an unchanged resource (dropped at any depth — a real change confined to
 *  them is not seen; DEMO.md says so), plus any `*_url` key. ISO timestamps in values go by the text rules. */
export const DEFAULT_VOLATILE_JSON_KEYS: readonly string[] = Object.freeze([
  'id', 'node_id', 'created_at', 'updated_at', 'pushed_at', 'url', 'etag', 'size', 'watchers', 'watchers_count',
]);

const isVolatile = (key: string, ignoreKeys: readonly string[]): boolean =>
  DEFAULT_VOLATILE_JSON_KEYS.includes(key) || ignoreKeys.includes(key) || key.endsWith('_url');

function strip(value: unknown, ignoreKeys: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => strip(v, ignoreKeys));
  if (value === null || typeof value !== 'object') return value;
  const kept = Object.keys(value).sort().filter((k) => !isVolatile(k, ignoreKeys));
  return Object.fromEntries(kept.map((k) => [k, strip((value as Record<string, unknown>)[k], ignoreKeys)]));
}

/** A JSON body, volatile keys dropped at any depth and keys sorted, one field per line; `null` when not JSON. */
export function normaliseJsonBody(text: string, ignoreKeys: readonly string[]): string | null {
  try {
    return JSON.stringify(strip(JSON.parse(text), ignoreKeys), null, 2);
  } catch {
    return null;
  }
}
