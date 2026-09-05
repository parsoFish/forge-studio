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

import type { DemoStep } from '@forge/contracts/studio-types.ts';
import type { MergeGateEvidence } from '@forge/flows/cycle-helpers.ts';

import type { DemoModel, DemoModelCheckpoint, TestResultRow } from '../demo-model.ts';
import type { GateProfile } from '../class-profiles.ts';

/**
 * One gate the orchestrator ran at the merge boundary, and what it produced —
 * the merge gate's OWN type, imported rather than restated, so a row this
 * module renders cannot describe a shape the gate no longer emits.
 */
export type GateEvidenceRow = MergeGateEvidence;

export type DerivedDemoInput = {
  initiativeId: string;
  title: string;
  project: string;
  /** `git diff --shortstat main...HEAD`, verbatim. */
  diffStat: string;
  headSha: string;
  changedFiles: readonly string[];
  workItems: readonly { id: string; title: string; status: string }[];
  /** The typed acceptance criteria, already rendered one line per criterion. */
  acceptanceCriteria: readonly string[];
  gateEvidence: readonly GateEvidenceRow[];
  demoProcess: readonly DemoStep[];
  /** The class's `capture` column — what evidence this initiative's class captures. */
  capture: GateProfile['capture'];
};

export type DeriveDemoResult =
  | { ok: true; model: DemoModel }
  | { ok: false; errors: string[] };

/**
 * Shell metacharacters. A checkpoint command is spawned as a bare argv with no
 * shell (`orchestrated-capture.ts`), so a declared step containing any of these
 * would not run as written — that is a project-config error to say out loud,
 * never something to quietly strip and run anyway.
 */
const SHELL_METACHARACTERS = /[|&;<>$`\\(){}[\]*?~\n]/;

/** The first inline-code span in a step's text, or null. */
function inlineCodeSpan(text: string): string | null {
  const match = /`([^`]+)`/.exec(text);
  return match ? match[1]!.trim() : null;
}

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
 * with nothing in it.
 */
function captureCheckpoints(steps: readonly DemoStep[]): { checkpoints: DemoModelCheckpoint[]; errors: string[] } {
  const checkpoints: DemoModelCheckpoint[] = [];
  const errors: string[] = [];
  steps.forEach((step, i) => {
    if (step.kind !== 'capture') return;
    const command = inlineCodeSpan(step.text);
    if (command === null) {
      errors.push(
        `demoProcess[${i}] (kind: capture) names no command: this class captures checkpoint evidence, and the step's text carries no inline-code span to run — "${step.text}"`,
      );
      return;
    }
    if (SHELL_METACHARACTERS.test(command)) {
      errors.push(
        `demoProcess[${i}] (kind: capture) declares \`${command}\`, which contains shell metacharacters — capture spawns a bare argv with no shell, so this command cannot run as written`,
      );
      return;
    }
    checkpoints.push({ label: `Step ${i + 1}: capture`, caption: step.text, command });
  });
  if (checkpoints.length === 0 && errors.length === 0) {
    errors.push(
      "this class captures checkpoint evidence, and the project's demoProcess declares no step of kind 'capture' — nothing can be captured",
    );
  }
  return { checkpoints, errors };
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
 * The one-line essence. Derived from counts the orchestrator measured, so it
 * states what happened rather than characterising it — the previous author's
 * prose essence is exactly the kind of claim nothing could check.
 */
function essenceOf(input: DerivedDemoInput): string {
  const wis = input.workItems.length;
  const acs = input.acceptanceCriteria.length;
  const gates = input.gateEvidence.length;
  return (
    `${input.title} — ${wis} work item${wis === 1 ? '' : 's'} delivered against ` +
    `${acs} acceptance ${acs === 1 ? 'criterion' : 'criteria'}, ${gates} merge-boundary gate${gates === 1 ? '' : 's'} run.`
  );
}

/** Derive the demo model, or report every config error that stopped it. */
export function deriveDemoModel(input: DerivedDemoInput): DeriveDemoResult {
  let checkpoints: DemoModelCheckpoint[];
  if (input.capture === 'checkpoints') {
    const derived = captureCheckpoints(input.demoProcess);
    if (derived.errors.length > 0) return { ok: false, errors: derived.errors };
    checkpoints = derived.checkpoints;
  } else if (input.capture === 'plan-output') {
    checkpoints = [planOutputCheckpoint(input)];
  } else {
    checkpoints = [diffCheckpoint(input)];
  }

  const model: DemoModel = {
    title: input.title,
    essence: essenceOf(input),
    project: input.project,
    initiativeId: input.initiativeId,
    changedRef: input.headSha,
    checkpoints,
    diffStat: input.diffStat,
    acceptanceCriteria: [...input.acceptanceCriteria],
    summary: {
      bullets: input.workItems.map((wi) => `${wi.id} [${wi.status}] ${wi.title}`),
      commitSha: input.headSha,
    },
    testEvidence: testEvidenceRows(input.gateEvidence),
    filesChanged: input.changedFiles.map((path) => ({ path })),
  };
  return { ok: true, model };
}
