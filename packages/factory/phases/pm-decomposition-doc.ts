/**
 * The decomposition document the project-manager pass WRITES — split out of
 * `project-manager.ts` with the prompt-context readers so that file comes under
 * the 800-line cap (M5-A exit row 8).
 *
 * One call site, one direction: the pass hands it the work-item set it has just
 * validated and this module renders the operator-facing artifact. It reads the
 * set back off disk for the rendering it needs; nothing here decides anything
 * about the pass's outcome.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { InitiativeManifest } from '@forge/flows/manifest.ts';
import type { WorkItem } from '@forge/flows/work-item.ts';

/**
 * Write `.forge/work-items/_decomposition.md` — a greppable WI list for a
 * fast operator sanity check. Lists each WI (id + the files it touches, so
 * off-target scope is obvious). Excluded from `readWorkItemsFromDir` so it
 * is never parsed as a WI.
 */
export function writeDecompositionDoc(
  workItemsDir: string,
  manifest: InitiativeManifest,
  items: ReadonlyArray<WorkItem>,
): void {
  const lines: string[] = [
    `# Work-item decomposition — ${manifest.initiative_id}`,
    '',
    `${items.length} work item(s) emitted.`,
    '',
  ];

  // A1 advisory (2026-06-06): a top-level-scope summary so the operator can
  // eyeball off-target decomposition AT A GLANCE. If the PM mis-grounds (e.g.
  // hallucinates off the title and touches `releases/`, `docs/`, or `brain/`
  // instead of the project's source tree), the stray top-level dir shows up
  // here immediately. Advisory only — not a hard gate (a legit WI may touch
  // docs/examples); the teeth are the restate-the-target step + the live-acc-WI
  // requirement.
  const topLevel = new Map<string, number>();
  for (const item of items) {
    for (const f of item.files_in_scope) {
      const seg = f.split('/')[0] || f;
      topLevel.set(seg, (topLevel.get(seg) ?? 0) + 1);
    }
  }
  if (topLevel.size > 0) {
    lines.push('## Top-level scope (eyeball for off-target dirs)');
    for (const [seg, count] of [...topLevel.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- \`${seg}/\` — ${count} file ref(s)`);
    }
    lines.push('');
  }

  for (const item of items) {
    lines.push(`## ${item.work_item_id}`);
    for (const f of item.files_in_scope) lines.push(`- ${f}`);
    lines.push('');
  }
  try {
    writeFileSync(join(workItemsDir, '_decomposition.md'), lines.join('\n'));
  } catch {
    /* best-effort telemetry artifact — never fail the PM pass on a write error */
  }
}
