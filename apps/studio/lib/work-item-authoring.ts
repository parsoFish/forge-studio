/**
 * forge-nk1y.12 — the pure work-item authoring parse, shared by every surface
 * that lets the operator author a work item (the Kickoff gate's add today; the
 * verdict gate's send-back next). The server validates again; this only keeps
 * the obvious mistakes from making a round trip.
 */
import type { AcceptanceCriterion } from './bridge-client-runs.ts';

export type WorkItemDraft = {
  summary: string;
  acceptanceCriteria: AcceptanceCriterion[];
  /** One command line; split on whitespace into argv — no shell, so no quoting. */
  gateCmd: string;
  /** One worktree-relative path per line. */
  files: string;
};

export type WorkItemSource = {
  summary: string;
  acceptanceCriteria: AcceptanceCriterion[];
  qualityGateCmd: string[];
  filesInScope: string[];
};

export function emptyWorkItemDraft(): WorkItemDraft {
  return { summary: '', acceptanceCriteria: [{ given: '', when: '', then: '' }], gateCmd: '', files: '' };
}

export function parseGateCmd(text: string): { argv: string[] } | { error: string } {
  if (/["'`]/.test(text)) {
    return { error: 'the gate command cannot contain a quote — it runs as argv split on whitespace, never through a shell' };
  }
  return { argv: text.trim().split(/\s+/).filter(Boolean) };
}

export function parseFilesInScope(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

const completeAcs = (acs: readonly AcceptanceCriterion[]): AcceptanceCriterion[] =>
  acs
    .filter((a) => a.given.trim() && a.when.trim() && a.then.trim())
    .map((a) => ({ given: a.given.trim(), when: a.when.trim(), then: a.then.trim() }));

/** Why the draft cannot be submitted yet, or null — drives `disabledAttrs`. */
export function workItemDraftMissing(d: WorkItemDraft): string | null {
  if (!d.summary.trim()) return 'a summary is required';
  if (completeAcs(d.acceptanceCriteria).length === 0) return 'at least one complete GIVEN/WHEN/THEN acceptance criterion is required';
  const gate = parseGateCmd(d.gateCmd);
  if ('error' in gate) return gate.error;
  if (gate.argv.length === 0) return 'a gate command is required';
  if (parseFilesInScope(d.files).length === 0) return 'at least one file in scope is required';
  return null;
}

export function workItemDraftToSource(d: WorkItemDraft): { source: WorkItemSource } | { error: string } {
  const missing = workItemDraftMissing(d);
  if (missing !== null) return { error: missing };
  const gate = parseGateCmd(d.gateCmd) as { argv: string[] };
  return {
    source: {
      summary: d.summary.trim(),
      acceptanceCriteria: completeAcs(d.acceptanceCriteria),
      qualityGateCmd: gate.argv,
      filesInScope: parseFilesInScope(d.files),
    },
  };
}

/**
 * forge-mfv5.1.28 — the verdict gate's typed send-back. The rationale is the fix
 * work item's summary (it lands under `## Rationale` in the compiled WI), so the
 * draft's summary is unused; gate and files are OPTIONAL — absent, the server
 * backs the fix WI with the project gate and the WI-scope union (D-20).
 */
export type SendBackSource = {
  acceptanceCriteria: AcceptanceCriterion[];
  qualityGateCmd?: string[];
  filesInScope?: string[];
};

/** Why the typed send-back cannot be submitted yet, or null — drives `disabledAttrs`. */
export function sendBackDraftMissing(d: WorkItemDraft): string | null {
  if (completeAcs(d.acceptanceCriteria).length === 0) {
    return 'a send-back needs a blocking comment or at least one complete GIVEN/WHEN/THEN acceptance criterion — there is neither';
  }
  const gate = parseGateCmd(d.gateCmd);
  return 'error' in gate ? gate.error : null;
}

export function sendBackDraftToSource(d: WorkItemDraft): { source: SendBackSource } | { error: string } {
  const missing = sendBackDraftMissing(d);
  if (missing !== null) return { error: missing };
  const argv = (parseGateCmd(d.gateCmd) as { argv: string[] }).argv;
  const files = parseFilesInScope(d.files);
  return {
    source: {
      acceptanceCriteria: completeAcs(d.acceptanceCriteria),
      ...(argv.length > 0 ? { qualityGateCmd: argv } : {}),
      ...(files.length > 0 ? { filesInScope: files } : {}),
    },
  };
}
