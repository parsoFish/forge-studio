/**
 * forge-nk1y.12 — the pure work-item authoring parse, shared by every surface
 * that lets the operator author a work item (the Kickoff gate's add today; the
 * verdict gate's send-back next). The server validates again; this only keeps
 * the obvious mistakes from making a round trip.
 */
import { scopeEntryErrors } from '@forge/contracts';
import type { AcceptanceCriterion } from './bridge-client-runs.ts';

/**
 * forge-mfv5.1.43 (D-20 amended): one criterion row as typed — GIVEN/WHEN/THEN
 * plus its falsifying check: a command line (argv, whitespace-split, no shell),
 * whether it must pass or fail, and env var names to unset / require.
 */
export type AcceptanceCriterionDraft = {
  given: string;
  when: string;
  then: string;
  check: string;
  expect: 'pass' | 'fail';
  unsetEnv: string;
  requiresEnv: string;
};

export function emptyCriterionDraft(): AcceptanceCriterionDraft {
  return { given: '', when: '', then: '', check: '', expect: 'pass', unsetEnv: '', requiresEnv: '' };
}

export type WorkItemDraft = {
  summary: string;
  acceptanceCriteria: AcceptanceCriterionDraft[];
  /** One command line; split on whitespace into argv — no shell, so no quoting. */
  gateCmd: string;
  /** One worktree-relative path per line; a line that is not one relative path is refused (forge-nk1y.32). */
  files: string;
};

export type WorkItemSource = {
  summary: string;
  acceptanceCriteria: AcceptanceCriterion[];
  qualityGateCmd: string[];
  filesInScope: string[];
};

export function emptyWorkItemDraft(): WorkItemDraft {
  return { summary: '', acceptanceCriteria: [emptyCriterionDraft()], gateCmd: '', files: '' };
}

export function parseGateCmd(text: string): { argv: string[] } | { error: string } {
  if (/["'`]/.test(text)) {
    return { error: 'the gate command cannot contain a quote — it runs as argv split on whitespace, never through a shell' };
  }
  return { argv: text.trim().split(/\s+/).filter(Boolean) };
}

/** One path per line, trimmed, blanks dropped; a line that is not ONE relative path is refused by name, never split (D-48). */
export function parseFilesInScope(text: string): { files: string[] } | { error: string } {
  const files = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const [error] = scopeEntryErrors('files_in_scope', files);
  return error === undefined ? { files } : { error };
}

const filesOf = (text: string): string[] => {
  const r = parseFilesInScope(text);
  return 'files' in r ? r.files : [];
};

/** forge-nk1y.32: a kickoff-added work item's current fields as an editable draft. */
export function workItemDraftFrom(f: WorkItemSource): WorkItemDraft {
  return {
    summary: f.summary,
    acceptanceCriteria: f.acceptanceCriteria.map((a) => ({
      given: a.given, when: a.when, then: a.then, check: (a.check?.argv ?? []).join(' '), expect: a.check?.expect ?? 'pass',
      unsetEnv: (a.check?.unsetEnv ?? []).join(' '), requiresEnv: (a.check?.requiresEnv ?? []).join(' '),
    })),
    gateCmd: f.qualityGateCmd.join(' '),
    files: f.filesInScope.join('\n'),
  };
}

const ENV_NAMES = /^[A-Z_][A-Z0-9_]*$/;
const names = (text: string): string[] => text.split(/[\s,]+/).filter(Boolean);
const isComplete = (a: AcceptanceCriterionDraft): boolean => Boolean(a.given.trim() && a.when.trim() && a.then.trim());

/** Why a complete criterion's check cannot be sent, or null — every typed criterion is a falsifying check (forge-mfv5.1.43). */
function checkMissing(acs: readonly AcceptanceCriterionDraft[]): string | null {
  for (const [i, a] of acs.filter(isComplete).entries()) {
    const gate = parseGateCmd(a.check);
    if ('error' in gate) return `AC${i + 1}'s check: ${gate.error}`;
    if (gate.argv.length === 0) return `AC${i + 1} needs a check command — a typed criterion is a falsifying check, never prose`;
    const bad = [...names(a.unsetEnv), ...names(a.requiresEnv)].find((n) => !ENV_NAMES.test(n));
    if (bad !== undefined) return `AC${i + 1}'s env name ${bad} is not an env var name (A-Z, 0-9, _)`;
  }
  return null;
}

const completeAcs = (acs: readonly AcceptanceCriterionDraft[]): AcceptanceCriterion[] =>
  acs.filter(isComplete).map((a) => {
    const unsetEnv = names(a.unsetEnv), requiresEnv = names(a.requiresEnv);
    return {
      given: a.given.trim(), when: a.when.trim(), then: a.then.trim(),
      check: {
        argv: (parseGateCmd(a.check) as { argv: string[] }).argv, expect: a.expect,
        ...(unsetEnv.length > 0 ? { unsetEnv } : {}), ...(requiresEnv.length > 0 ? { requiresEnv } : {}),
      },
    };
  });

/** Why the draft cannot be submitted yet, or null — drives `disabledAttrs`. */
export function workItemDraftMissing(d: WorkItemDraft): string | null {
  if (!d.summary.trim()) return 'a summary is required';
  if (!d.acceptanceCriteria.some(isComplete)) return 'at least one complete GIVEN/WHEN/THEN acceptance criterion is required';
  const checks = checkMissing(d.acceptanceCriteria);
  if (checks !== null) return checks;
  const gate = parseGateCmd(d.gateCmd);
  if ('error' in gate) return gate.error;
  if (gate.argv.length === 0) return 'a gate command is required';
  const files = parseFilesInScope(d.files);
  if ('error' in files) return files.error;
  if (files.files.length === 0) return 'at least one file in scope is required';
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
      filesInScope: filesOf(d.files),
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
  if (!d.acceptanceCriteria.some(isComplete)) {
    return 'a send-back needs a blocking comment or at least one complete GIVEN/WHEN/THEN acceptance criterion — there is neither';
  }
  const checks = checkMissing(d.acceptanceCriteria);
  if (checks !== null) return checks;
  const gate = parseGateCmd(d.gateCmd);
  if ('error' in gate) return gate.error;
  const files = parseFilesInScope(d.files);
  return 'error' in files ? files.error : null;
}

export function sendBackDraftToSource(d: WorkItemDraft): { source: SendBackSource } | { error: string } {
  const missing = sendBackDraftMissing(d);
  if (missing !== null) return { error: missing };
  const argv = (parseGateCmd(d.gateCmd) as { argv: string[] }).argv;
  const files = filesOf(d.files);
  return {
    source: {
      acceptanceCriteria: completeAcs(d.acceptanceCriteria),
      ...(argv.length > 0 ? { qualityGateCmd: argv } : {}),
      ...(files.length > 0 ? { filesInScope: files } : {}),
    },
  };
}
