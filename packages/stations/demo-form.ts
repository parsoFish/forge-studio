/**
 * demo.json's evidence-form fields (forge-mfv5.1.19): per checkpoint `form`,
 * `apiPath`, `ignoreKeys`; per demo a `narrative`. Validated and rendered here
 * so `demo-model.ts` (D-07's one schema) stays under the file cap; it calls in.
 *
 * The narrative says what the change enables. It is agent prose, never
 * evidence: DEMO.md labels it so, and the control never reads it.
 */

import { isOwnServerPath } from '@forge/projects';

import { DEMO_EVIDENCE_FORMS } from './demo-types.ts';
import type { DemoModelCheckpoint } from './demo-model.ts';

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
  if (cp.ignoreKeys !== undefined && (!Array.isArray(cp.ignoreKeys) || cp.ignoreKeys.some((k) => typeof k !== 'string'))) {
    errors.push(`${at}.ignoreKeys must be an array of key names when set`);
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
export function narrativeLines(narrative: string | undefined): string[] {
  if (!narrative) return [];
  return ['## What this enables', '', '_Agent narrative — not evidence._', '', narrative.trim(), ''];
}

/** What a captured checkpoint ran: its command, or the GET on the tree's own server. */
export function sourceLine(c: DemoModelCheckpoint): string | null {
  if (c.command) return `- **Command:** \`${c.command}\``;
  if (c.apiPath) return `- **GET (each tree's own server):** \`${c.apiPath}\``;
  return null;
}
