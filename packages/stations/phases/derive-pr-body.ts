/**
 * Derive the pull-request body (spec §5 item 4).
 *
 * `openPrInline` opens the PR with `--body-file .forge/pr-description.md`, so
 * the file is load-bearing: no body, no PR. It used to be authored by the demo
 * agent, which meant a missing "## How" heading cost a re-spawn. Every sentence
 * it could honestly write is derived here from the same three sources the demo
 * model comes from — the acceptance criteria, the gate evidence and the diff —
 * so the sections are structurally present and the failure mode is gone.
 *
 * The body names ONLY files the diff contains, because it is BUILT from the
 * diff. That was previously a prompt instruction ("reference ONLY these"), which
 * is the kind of rule an author can break and a reader cannot check.
 */

import type { DemoModel } from '../demo-model.ts';
import type { DerivedDemoInput } from './derive-demo-model.ts';

/** The sections a PR body must carry. `openPrInline` needs a body; a reader needs these. */
export const PR_BODY_SECTIONS = ['## Why', '## What', '## How'] as const;

function bullets(lines: readonly string[], empty: string): string[] {
  return lines.length > 0 ? lines.map((l) => `- ${l}`) : [`_${empty}_`];
}

/** The PR body for a derived demo model. Pure: same input, same bytes. */
export function derivePrBody(model: DemoModel, input: DerivedDemoInput): string {
  const gateRows = input.gateEvidence.map(
    (row) => `- \`${row.cmd.join(' ')}\` (${row.gate}) — ${row.ok ? 'pass' : 'fail'}`,
  );
  const checkpointRows = model.checkpoints.map((c) =>
    c.command ? `- \`${c.command}\` — ${c.caption}` : `- ${c.label} — ${c.caption}`,
  );

  return [
    `# ${input.title}`,
    '',
    `Initiative \`${input.initiativeId}\` · project \`${input.project}\` · head \`${input.headSha}\``,
    '',
    '## Why',
    '',
    'The acceptance criteria this initiative was decomposed against:',
    '',
    ...bullets(input.acceptanceCriteria, 'this initiative declared no acceptance criteria'),
    '',
    '## What',
    '',
    ...bullets(
      input.workItems.map((wi) => `**${wi.id}** [${wi.status}] ${wi.title}`),
      'no work items were delivered on this branch',
    ),
    '',
    '```',
    input.diffStat,
    '```',
    '',
    ...bullets(input.changedFiles.map((f) => `\`${f}\``), 'no files changed'),
    '',
    '## How',
    '',
    'Merge-boundary gates the orchestrator ran:',
    '',
    ...bullets(gateRows.map((r) => r.replace(/^- /, '')), 'this class runs no merge-boundary gate'),
    '',
    'Evidence captured:',
    '',
    ...bullets(checkpointRows.map((r) => r.replace(/^- /, '')), 'no evidence was captured for this class'),
    '',
    `_Derived by forge from the acceptance criteria, the gate evidence and the diff — not authored by an agent._`,
    '',
  ].join('\n');
}
