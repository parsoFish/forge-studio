/**
 * PURE MOVE from project-manager.ts: `appendStandingAcs` + its header
 * constant, relocated unchanged so upcoming project-manager.ts work has
 * somewhere to land without pushing that file over its 800-line cap.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeWorkItem, type WorkItem } from '@forge/flows';

/** Heading for the project-contract standing-AC section injected per WI. */
const STANDING_ACS_HEADER = '## Standing acceptance criteria (project contract)';

/**
 * A2b (2026-06-06) — append the project's `standing_work_item_acs` to every WI
 * body as a fixed contract section, then re-serialise the file. Body-only
 * (frontmatter byte-stable via `serializeWorkItem`), idempotent (a WI already
 * carrying the header is left untouched — safe on resume). Best-effort per
 * file: a write error leaves that WI unchanged rather than failing the PM pass.
 * Returns the items with their in-memory bodies updated to match disk.
 */
export function appendStandingAcs(
  workItemsDir: string,
  items: ReadonlyArray<WorkItem>,
  standingAcs: ReadonlyArray<string>,
): WorkItem[] {
  const section = [
    STANDING_ACS_HEADER,
    '',
    'These project-wide testing invariants apply to **every** work item in this initiative, in addition to the work-specific acceptance criteria above. The dev-loop must satisfy them and the reviewer must confirm them:',
    '',
    ...standingAcs.map((ac) => `- ${ac}`),
  ].join('\n');
  return items.map((item) => {
    if (item.body.includes(STANDING_ACS_HEADER)) return item; // idempotent
    const updated: WorkItem = { ...item, body: `${item.body.replace(/\s+$/, '')}\n\n${section}\n` };
    try {
      writeFileSync(join(workItemsDir, `${item.work_item_id}.md`), serializeWorkItem(updated));
      return updated;
    } catch {
      return item; // best-effort — never fail the PM pass on a write error
    }
  });
}
