/**
 * The product's own session-kind registry, read at run time — review finding
 * 1 on `groundMintedSessionPaths` (`ground-hash.mjs`).
 *
 * WHAT WAS WRONG. `groundMintedSessionPaths` licensed ANY new top-level
 * `_<kind>/<id>` prefix born in a story's own ground as a minted session —
 * no check that `<kind>` names a session kind the product actually declares.
 * `mintedSessionDirsToClear` → `captureAndClearMintedSessions` then DELETES
 * whatever this licenses. A new `_snapshots/2026-09-26/report.md` with no
 * `_logs` correlate at all reads as PRODUCED and gets cleared — a directory
 * this run never minted, removed on the strength of matching a shape.
 *
 * WHY READ THE YAML DIRECTLY, NOT `loadSessionKinds()`. The registry the
 * product actually consults is `packages/sessions/studio/session-kinds.ts`'s
 * `loadSessionKinds(forgeRoot)`, iterated by
 * `bridge-studio-session-index.ts:300-321` as `_${descriptor.id}` — but
 * `run.mjs` (and everything it pulls in transitively, including
 * `ground-hash.mjs`) is plain `.mjs` run with NO type stripping
 * (`beats-agent-proc.mjs`'s `STALL_CEILING_MS` and `sweep-teardown.mjs`'s
 * `DAEMON_PID_FILE` state the same constraint), so it cannot import that
 * `.ts` module. And a hand-copied id list is exactly the defect class this
 * exists to avoid: `session-kinds.ts`'s own header says R4-15/16/17 extend
 * the registry by ADDING A DESCRIPTOR to the YAML alone — no code change
 * required — so a copied list would rot the moment a kind shipped without a
 * matching update here. `studio/session-kinds.yaml` is a bare top-level YAML
 * SEQUENCE of descriptor objects (`loadSessionKindsSequence`'s own comment);
 * reading it with the SAME library (`js-yaml`) the loader uses, and taking
 * nothing but each entry's `id`, is the same source read from the other
 * side — no second list to fall out of step with the first.
 *
 * NOT `validateSessionKinds`'s full semantic pass. The containment question
 * this answers is narrower than "is this descriptor well-formed" — just
 * "does this id name a kind the product declares at all" — so this mirrors
 * `loadSessionKinds`'s OWN leniency (structural-only, AT-16): a malformed
 * entry is skipped rather than thrown on, and only a missing file or
 * unparseable YAML — the registry itself being unreadable — throws.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const SESSION_KINDS_YAML_RELATIVE = join('studio', 'session-kinds.yaml');

/**
 * Every registered session-kind id, read fresh from `studio/session-kinds.yaml`.
 *
 * @param {string} forgeRoot the forge repo root (`ground-hash.mjs`'s ROOT —
 *   the checkout that OWNS the registry, never a story's own ground)
 * @returns {Set<string>}
 */
export function loadRegisteredSessionKindIds(forgeRoot) {
  const file = join(forgeRoot, SESSION_KINDS_YAML_RELATIVE);
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`${file}: cannot read the session-kind registry — ${err.message}`);
  }
  let sequence;
  try {
    sequence = yaml.load(raw);
  } catch (err) {
    throw new Error(`${file}: unparseable YAML — ${err.message}`);
  }
  if (!Array.isArray(sequence)) {
    throw new Error(`${file}: expected a top-level YAML sequence of descriptors, got ${typeof sequence}`);
  }
  const ids = new Set();
  for (const entry of sequence) {
    if (entry !== null && typeof entry === 'object' && typeof entry.id === 'string' && entry.id !== '') {
      ids.add(entry.id);
    }
  }
  return ids;
}
