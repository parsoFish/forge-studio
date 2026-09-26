/**
 * Derive the demo model from facts the orchestrator already holds (spec §5 item 4).
 *
 * WHAT THIS REPLACES. The demo bundle used to be authored by an LLM: a spawn
 * wrote `demo.json`, the orchestrator validated it, and a failed validation
 * bought a retry with the errors pasted into the prompt. Everything that model
 * carried is something the orchestrator already knows — the acceptance criteria
 * come from the work items, the diffstat from git, the gate results from the
 * gate it just ran, and the checkpoints from the project's own declared
 * `demoProcess`. Deriving them is reproducible, costs nothing, and cannot be
 * retried into existence, so the retry loop, the coverage heuristic and the fix
 * proposals go with the author.
 *
 * WHAT IT DELIBERATELY DOES NOT DERIVE. `acEvaluations` — the per-criterion
 * verdict. An orchestrator that scored the criteria it also built the evidence
 * for is the self-grading loop `loop-design-check` vetoes; the verdict is the
 * read-only review agent's (spec §5 item 5), and until it lands the field is
 * absent rather than guessed.
 *
 * PURE. No filesystem, no git, no clock — every input is passed in, so the
 * whole contract is testable without a worktree and two runs of the same input
 * produce deep-equal models.
 */

import type { DemoStep } from '@forge/contracts';
import { extractDrivableCommand, extractDemoRoute } from '@forge/contracts';
import type { MergeGateEvidence } from '@forge/flows';

import type { DemoModel, DemoModelCheckpoint, TestResultRow } from '../demo-model.ts';
import type { GateProfile } from '../class-profile-port.ts';

/**
 * One gate the orchestrator ran at the merge boundary, and what it produced —
 * the merge gate's OWN type, imported rather than restated, so a row this
 * module renders cannot describe a shape the gate no longer emits.
 */
export type GateEvidenceRow = MergeGateEvidence;

/** One work item's typed acceptance criterion (ADR 051), carried through
 *  intact rather than pre-flattened — the derivation renders it, so the same
 *  line can never drift between the demo model and the PR body. */
export type AcceptanceCriterionInput = {
  workItemId: string;
  given: string;
  when: string;
  then: string;
};

export type DerivedDemoInput = {
  initiativeId: string;
  title: string;
  project: string;
  /** `git diff --shortstat main...HEAD`, verbatim. */
  diffStat: string;
  headSha: string;
  changedFiles: readonly string[];
  workItems: readonly { id: string; title: string; status: string }[];
  /** The typed acceptance criteria (ADR 051) — untouched by the reader; this
   *  module renders each to its one demo.json / PR-body line. */
  acceptanceCriteria: readonly AcceptanceCriterionInput[];
  gateEvidence: readonly GateEvidenceRow[];
  demoProcess: readonly DemoStep[];
  /** The class's `capture` column — what evidence this initiative's class captures. */
  capture: GateProfile['capture'];
};

/** The one place `(WI) GIVEN … WHEN … THEN …` is spelled — shared by the
 *  demo model's `acceptanceCriteria: string[]` and the PR body's "## Why". */
export function renderAcceptanceCriterion(ac: AcceptanceCriterionInput): string {
  return `(${ac.workItemId}) GIVEN ${ac.given.trim()} WHEN ${ac.when.trim()} THEN ${ac.then.trim()}`;
}

export type DeriveDemoResult =
  | { ok: true; model: DemoModel }
  | { ok: false; errors: string[] };

/**
 * The checkpoints a `capture: 'checkpoints'` class derives from the project's
 * declared demo process.
 *
 * The project contract's `demoProcess` steps are operator prose that names its
 * command in an inline-code span ("Run `npm run demo` to …") — that span is the
 * command, and the whole step is the caption. A `capture` step that names no
 * command, or names one no bare-argv spawn can run, is reported as a config
 * error: the class asked for captured evidence and the contract cannot produce
 * any, which is precisely the state that must fail loud rather than ship a demo
 * with nothing in it. `extractDrivableCommand` (`@forge/contracts`) is the same
 * rule the `DEMO-SKILL` preflight clause applies (bead forge-mfv5.2.2) — a
 * step judged drivable here is never judged undrivable there.
 */
function captureCheckpoints(steps: readonly DemoStep[]): { checkpoints: DemoModelCheckpoint[]; errors: string[] } {
  const checkpoints: DemoModelCheckpoint[] = [];
  const errors: string[] = [];
  steps.forEach((step, i) => {
    if (step.kind !== 'capture') return;
    const result = extractDrivableCommand(step.text);
    if (!result.ok) {
      errors.push(
        result.reason === 'no-inline-code'
          ? `demoProcess[${i}] (kind: capture) names no command: this class captures checkpoint evidence, and the step's text carries no inline-code span to run — "${step.text}"`
          : `demoProcess[${i}] (kind: capture) declares \`${result.code}\`, which contains shell metacharacters — capture spawns a bare argv with no shell, so this command cannot run as written`,
      );
      return;
    }
    checkpoints.push({ label: `Step ${i + 1}: capture`, caption: step.text, command: result.command });
  });
  if (checkpoints.length === 0 && errors.length === 0) {
    errors.push(
      "this class captures checkpoint evidence, and the project's demoProcess declares no step of kind 'capture' — nothing can be captured",
    );
  }
  return { checkpoints, errors };
}

/**
 * Checkpoints derived DIRECTLY from the initiative's own acceptance criteria
 * (forge-mfv5.1.7), ahead of the project's general `demoProcess` checkpoints:
 * the strongest evidence link a demo can carry is one that ties a checkpoint
 * to the exact criterion it proves, rather than to the project's generic demo
 * declaration. An AC whose WHEN clause names, in an inline-code span, a bare
 * command becomes a CLI checkpoint; one that names an in-app route (starting
 * `/`, no traversal — `isSafeDemoRoute`) becomes a browser checkpoint. An AC
 * that names neither contributes nothing here — that is not an error, it just
 * means the project's demoProcess is this AC's only evidence source. Order
 * follows the AC list's own order (WI order).
 */
function acDerivedCheckpoints(criteria: readonly AcceptanceCriterionInput[]): DemoModelCheckpoint[] {
  const checkpoints: DemoModelCheckpoint[] = [];
  criteria.forEach((ac, i) => {
    const label = `AC ${i + 1}: ${ac.workItemId}`;
    const caption = ac.then.trim();
    const routeExtraction = extractDemoRoute(ac.when);
    if (routeExtraction.routeShaped) {
      if (routeExtraction.route !== null) checkpoints.push({ label, caption, route: routeExtraction.route });
      return;
    }
    const result = extractDrivableCommand(ac.when);
    if (result.ok) checkpoints.push({ label, caption, command: result.command });
  });
  return checkpoints;
}

/** The one checkpoint a class that captures no commands still needs to be a valid demo. */
function diffCheckpoint(input: DerivedDemoInput): DemoModelCheckpoint {
  const files = input.changedFiles.length;
  return {
    label: 'Changed files',
    caption:
      files > 0
        ? `${files} file${files === 1 ? '' : 's'} changed on this branch: ${[...input.changedFiles].join(', ')}`
        : 'No files changed on this branch.',
  };
}

/**
 * The plan-output checkpoint: the merge-boundary gate's own output IS the
 * evidence for a class whose change is proven by a plan rather than by a
 * before/after run. Nothing extra is spawned — the text is what the gate
 * already printed.
 */
function planOutputCheckpoint(input: DerivedDemoInput): DemoModelCheckpoint {
  const outputs = input.gateEvidence
    .map((row) => (row.outputTail ? `$ ${row.cmd.join(' ')}\n${row.outputTail}` : `$ ${row.cmd.join(' ')}`))
    .join('\n\n');
  return {
    label: 'Gate output',
    caption: 'The merge-boundary gate output this change was judged on.',
    afterOutput: outputs.length > 0 ? outputs : 'no gate produced output for this class',
  };
}

function testEvidenceRows(gateEvidence: readonly GateEvidenceRow[]): TestResultRow[] {
  return gateEvidence.map((row) => ({
    name: `${row.gate}: ${row.cmd.join(' ')}`,
    result: row.ok ? 'pass' : 'fail',
  }));
}

/**
 * Delta honesty (forge-mfv5.1.7): the one-or-two-sentence summary of what the
 * per-checkpoint `delta` flags actually found, shared by the re-derived essence
 * and `derivePrBody`'s evidence section so the two can never disagree. `null`
 * when no checkpoint carries a `delta` yet (capture has not run).
 *
 * FAILS CLOSED: an 'unknown' checkpoint is NAMED but never rolled into a "no
 * change" claim — a claim of "no observable change" is only made when EVERY
 * captured checkpoint that was actually compared came back unchanged AND none
 * were unknown. A 'changed' checkpoint always produces the "<k> of <n>" count,
 * whether or not other checkpoints are unknown.
 */
export function deriveDeltaSummary(checkpoints: readonly DemoModelCheckpoint[]): string | null {
  const withDelta = checkpoints.filter((c) => c.delta !== undefined);
  if (withDelta.length === 0) return null;
  const n = withDelta.length;
  const changed = withDelta.filter((c) => c.delta === 'changed');
  const unknown = withDelta.filter((c) => c.delta === 'unknown');
  const sentences: string[] = [];
  if (changed.length > 0) {
    sentences.push(`${changed.length} of ${n} captured checkpoints changed behaviour.`);
  } else if (unknown.length === 0) {
    sentences.push('No observable behaviour change was captured.');
  }
  if (unknown.length > 0) {
    sentences.push(`${unknown.length} checkpoint(s) could not be compared: ${unknown.map((c) => c.label).join(', ')}`);
  }
  return sentences.join(' ');
}

/**
 * The one-line essence. Derived from counts the orchestrator measured, so it
 * states what happened rather than characterising it — the previous author's
 * prose essence is exactly the kind of claim nothing could check.
 *
 * `acDrivenCheckpoints` (only meaningful for `capture: 'checkpoints'`) names
 * the fallback out loud when zero ACs named anything drivable — silently
 * falling back to the project's declaration is exactly the kind of gap a
 * reviewer needs told, not left to infer from an AC table with no evidence
 * link.
 */
function essenceOf(input: DerivedDemoInput, acDrivenCheckpoints = 0): string {
  const wis = input.workItems.length;
  const acs = input.acceptanceCriteria.length;
  const gates = input.gateEvidence.length;
  const base =
    `${input.title} — ${wis} work item${wis === 1 ? '' : 's'} delivered against ` +
    `${acs} acceptance ${acs === 1 ? 'criterion' : 'criteria'}, ${gates} merge-boundary gate${gates === 1 ? '' : 's'} run.`;
  if (input.capture === 'checkpoints' && acDrivenCheckpoints === 0) {
    return (
      `${base} no acceptance criterion names a drivable command or route — ` +
      `checkpoints come from the project's demo declaration.`
    );
  }
  return base;
}

/** Derive the demo model, or report every config error that stopped it. */
export function deriveDemoModel(input: DerivedDemoInput): DeriveDemoResult {
  let checkpoints: DemoModelCheckpoint[];
  let acDrivenCheckpoints = 0;
  if (input.capture === 'checkpoints') {
    const acCheckpoints = acDerivedCheckpoints(input.acceptanceCriteria);
    const derived = captureCheckpoints(input.demoProcess);
    if (derived.errors.length > 0) return { ok: false, errors: derived.errors };
    const acCommands = new Set(
      acCheckpoints.map((c) => c.command).filter((c): c is string => c !== undefined),
    );
    const dedupedProcessCheckpoints = derived.checkpoints.filter(
      (c) => c.command === undefined || !acCommands.has(c.command),
    );
    checkpoints = [...acCheckpoints, ...dedupedProcessCheckpoints];
    acDrivenCheckpoints = acCheckpoints.length;
  } else if (input.capture === 'plan-output') {
    checkpoints = [planOutputCheckpoint(input)];
  } else {
    checkpoints = [diffCheckpoint(input)];
  }

  const model: DemoModel = {
    title: input.title,
    essence: essenceOf(input, acDrivenCheckpoints),
    project: input.project,
    initiativeId: input.initiativeId,
    changedRef: input.headSha,
    checkpoints,
    diffStat: input.diffStat,
    acceptanceCriteria: input.acceptanceCriteria.map(renderAcceptanceCriterion),
    summary: {
      bullets: input.workItems.map((wi) => `${wi.id} [${wi.status}] ${wi.title}`),
      commitSha: input.headSha,
    },
    testEvidence: testEvidenceRows(input.gateEvidence),
    filesChanged: input.changedFiles.map((path) => ({ path })),
  };
  return { ok: true, model };
}
