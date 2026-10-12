/**
 * forge-nk1y.27 — folding the operator's reflection answers into the themes the cycle wrote.
 *
 * A rerun after the operator answers (interactive, `user-feedback.md` present) is a FOLD turn: its
 * prompt names the themes that cite this cycle (`reflector-binding.ts`), and afterwards forge checks
 * which of them changed — `reflector.feedback-folded` naming them, or `reflector.feedback-not-folded`
 * (an error) when none did. gitweave I1's operator corrections reached no theme because nothing
 * asked for the fold and nothing checked it.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EventLogger } from '@forge/kernel';

/** Theme file → content hash, for every theme under `dirs` whose text cites `cycleId`. */
export function cycleThemeSnapshot(dirs: readonly string[], cycleId: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
      const path = join(dir, name);
      const text = readFileSync(path, 'utf8');
      if (text.includes(cycleId)) out.set(path, hash(text));
    }
  }
  return out;
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const currentHash = (path: string): string => (existsSync(path) ? hash(readFileSync(path, 'utf8')) : 'deleted');

/** Which of the snapshot's themes changed since it was taken. */
export function amendedThemes(before: Map<string, string>): string[] {
  return [...before].filter(([path, h]) => currentHash(path) !== h).map(([path]) => path);
}

export function emitFoldOutcome(
  logger: EventLogger,
  ctx: { initiativeId: string; parentEventId: string; skill: string; feedbackPath: string },
  before: Map<string, string>,
): void {
  const amended = amendedThemes(before);
  const folded = amended.length > 0;
  logger.emit({
    initiative_id: ctx.initiativeId,
    parent_event_id: ctx.parentEventId,
    phase: 'reflection',
    skill: ctx.skill,
    event_type: folded ? 'log' : 'error',
    input_refs: [ctx.feedbackPath],
    output_refs: amended,
    message: folded ? 'reflector.feedback-folded' : 'reflector.feedback-not-folded',
    metadata: {
      themes_considered: before.size,
      themes_amended: amended,
      ...(folded ? {} : { reason: before.size === 0 ? 'no theme cites this cycle' : 'no theme changed' }),
    },
  });
}
