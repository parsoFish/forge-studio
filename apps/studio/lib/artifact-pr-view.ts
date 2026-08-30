/**
 * W7-B7 (artifact-plan-17) — the PR artifact page's view model: merge the
 * parsed pr-description.md doc with the run's own PR facts (`run.prUrl`,
 * derived server-side from the cycle's `reviewer.pr-opened` event) so the
 * page links the ACTUAL pull request — the hand-off point out of forge.
 *
 * Honesty rules:
 *  - `url` comes from the run (the recorded fact); a url already present on
 *    the parsed doc wins (it never is today — parsePrDescription extracts
 *    text only — but a future doc-borne url is more specific).
 *  - `number` is derived from the url's `/pull/<n>` tail — never invented.
 *  - `state` is claimed ONLY where the run model supports it: a `complete`
 *    develop run finished through merge-confirmation ⇒ `merged`; a
 *    `gated`/`active` run with a recorded PR has it open ⇒ `open`; a
 *    `failed`/`planned` run's PR state is unknowable here ⇒ omitted.
 *    Live CI check state is deliberately NOT fabricated — it would need a
 *    live `gh` call the bridge does not make; the link hands off to GitHub.
 */
import type { PrDoc } from '@/components/studio/artifact/PrRenderer';
import type { Run } from './studio-client';

export function prNumberFromUrl(url: string | undefined): number | undefined {
  if (!url) return undefined;
  const m = /\/pull\/(\d+)(?:$|[/?#])/.exec(url);
  return m ? Number(m[1]) : undefined;
}

export function prStateFromRun(run: Run | null): 'merged' | 'open' | undefined {
  if (!run) return undefined;
  if (run.status === 'complete') return 'merged';
  if (run.status === 'gated' || run.status === 'active') return 'open';
  return undefined;
}

/**
 * The merged PrDoc, or null when there is neither a parsed description nor a
 * recorded PR url (the page then renders its honest empty state).
 */
export function prDocWithRunLink(prDoc: PrDoc | null, run: Run | null): PrDoc | null {
  const url = prDoc?.url ?? run?.prUrl;
  if (!prDoc && !url) return null;
  const merged: PrDoc = { ...(prDoc ?? {}) };
  if (url !== undefined) merged.url = url;
  const number = prDoc?.number ?? prNumberFromUrl(url);
  if (number !== undefined) merged.number = number;
  const state = prDoc?.state ?? prStateFromRun(run);
  if (state !== undefined) merged.state = state;
  return merged;
}
