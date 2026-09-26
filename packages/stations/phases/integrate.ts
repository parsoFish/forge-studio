/**
 * The `integrate` band (spec §5 item 4) — an orchestrator verb, no LLM.
 *
 * The band takes a branch the developer loop finished and turns it into the
 * artifacts a reviewer reads: a `demo.json` + `DEMO.md` bundle and the PR body.
 * Everything it writes is DERIVED — from the acceptance criteria the work items
 * carry, from the gate evidence the merge-boundary gate just produced, and from
 * the diff — so there is no author to validate, no retry to spend and no
 * coverage heuristic to fool. `derive-demo-model.ts` and `derive-pr-body.ts`
 * hold the derivations; this module does the filesystem, the capture and the
 * commit, and reports each failure with the reason a triager needs.
 *
 * WHAT THE CLASS DECIDES. `capture` (the class → gate-profile table, ADR 051)
 * selects the evidence: `checkpoints` runs the project's declared demo commands
 * under the orchestrated capture, `plan-output` records the gate's own output,
 * `none` records the diff alone. A class that asks for checkpoints against a
 * project contract that declares none FAILS LOUD — an empty demo is not the
 * same fact as a demo that was not asked for.
 *
 * WHAT IT DOES NOT DECIDE. Whether the criteria were met. That verdict is the
 * read-only review agent's (spec §5 item 5).
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import type { EventLogger } from '@forge/kernel';
import { parseManifest } from '@forge/flows';
import type { MergeGateEvidence } from '@forge/flows';
import { worktreeDemoDir, worktreeDemoRelDir, DEMO_JSON_BASENAME } from '@forge/flows';
import { readWorkItemsFromDir } from '@forge/flows';
import {
  buildDemoCaptureArgv,
  CAPTURE_NONCE_ENV,
  commitOrchestratedCaptureArtifacts,
  demoJsonWantsCapture,
  generateCaptureNonce,
  preflightDemoCaptureCommands,
  resolveDemoCaptureTimeoutMs,
  runOrchestratorCommand,
} from '@forge/flows';
import { loadProjectConfig } from '@forge/projects';

import { renderDemoBundle, stripScratchFromDiffStat, type DemoModel } from '../demo-model.ts';
import { requireClassProfiles, type ClassProfilePort } from '../class-profile-port.ts';
import { judgeCaptureNonce, readStampedNonce } from './capture-nonce.ts';
import { deriveDeltaSummary, deriveDemoModel, type DerivedDemoInput } from './derive-demo-model.ts';
import { derivePrBody, PR_BODY_SECTIONS } from './derive-pr-body.ts';

export const PR_DESCRIPTION_REL = '.forge/pr-description.md';

/** The band's slug in the event log — the node's display identity is unchanged. */
const INTEGRATE_SLUG = 'demo-agent';

export type IntegrateBandInput = {
  initiativeId: string;
  worktreePath: string;
  manifestPath: string;
  projectRepoPath: string;
  orchestratedCapture?: { argv?: string[]; timeoutMs?: number };
};

export type IntegrateResult =
  | { status: 'complete'; demoJsonPath: string }
  | {
      status: 'failed';
      reason: 'derive-failed' | 'config-error' | 'render-failed' | 'tooling-unavailable' | 'capture-failed' | 'capture-not-stamped' | 'nonce-mismatch';
      detail: string;
    };

function gitCapture(worktreePath: string, args: string[]): { ok: boolean; out: string; err: string } {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' }), err: '' };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const stderr = e.stderr ? (typeof e.stderr === 'string' ? e.stderr : e.stderr.toString('utf8')) : (e.message ?? '');
    return { ok: false, out: '', err: stderr.slice(-500) };
  }
}

/** Read the work items the developer loop delivered, with their typed criteria. */
function readDelivered(
  worktreePath: string,
  emit: (message: string, metadata?: Record<string, unknown>, extra?: { event_type?: 'log' | 'error' }) => void,
): Pick<DerivedDemoInput, 'workItems' | 'acceptanceCriteria'> {
  const wiDir = join(worktreePath, '.forge', 'work-items');
  const workItems: DerivedDemoInput['workItems'] = [];
  const acceptanceCriteria: DerivedDemoInput['acceptanceCriteria'] = [];
  if (!existsSync(wiDir)) return { workItems, acceptanceCriteria };
  const { items, parseErrors } = readWorkItemsFromDir(wiDir);
  if (Object.keys(parseErrors).length > 0) {
    // A malformed WI's criteria would silently vanish from the demo's AC table —
    // surface loudly (the bundle still derives from the parseable set).
    emit('demo.wi-parse-errors', { errors: parseErrors }, { event_type: 'error' });
  }
  const mutableItems = workItems as { id: string; title: string; status: string }[];
  const mutableAcs = acceptanceCriteria as { workItemId: string; given: string; when: string; then: string }[];
  for (const wi of items) {
    mutableItems.push({ id: wi.work_item_id, title: wi.body.split('\n')[0] ?? wi.work_item_id, status: wi.status });
    for (const ac of wi.acceptance_criteria) {
      // Carried TYPED — rendering to the `(WI) GIVEN … WHEN … THEN …` line
      // moved into derive-demo-model.ts (renderAcceptanceCriterion), so the demo
      // model and the PR body render the same line from the same function.
      mutableAcs.push({ workItemId: wi.work_item_id, given: ac.given, when: ac.when, then: ac.then });
    }
  }
  return { workItems, acceptanceCriteria };
}

/**
 * Delta honesty (forge-mfv5.1.7). `forge demo capture` tags every checkpoint
 * with its real `delta` (`computeCheckpointDeltas`, demo-model.ts) and writes
 * that back to demo.json BEFORE stamping the nonce this function is called
 * after — so by the time capture has verified, demo.json on disk already
 * carries the flags this re-reads. Rewriting the essence + PR body from them
 * HERE, before `commitOrchestratedCaptureArtifacts` commits+pushes, is what
 * keeps the pushed demo.json and the local PR body from both still reading as
 * if capture had never run. Best-effort: demo.json was just written and
 * validated by the capture run itself, so a read failure here is named and
 * skipped rather than failing an otherwise-successful capture.
 */
function reviseAfterCapture(
  demoJsonAbs: string,
  demoDirAbs: string,
  prDescriptionAbs: string,
  worktreePath: string,
  derivedInput: DerivedDemoInput,
  emit: (message: string, metadata?: Record<string, unknown>, extra?: { event_type?: 'log' | 'error' }) => void,
): void {
  let model: DemoModel;
  try {
    model = JSON.parse(readFileSync(demoJsonAbs, 'utf8')) as DemoModel;
  } catch (err) {
    emit('demo.delta-revise-skipped', { detail: err instanceof Error ? err.message : String(err) }, { event_type: 'error' });
    return;
  }
  const deltaSummary = deriveDeltaSummary(model.checkpoints);
  if (!deltaSummary) return; // no checkpoint carries a delta — nothing captured to revise from
  const revised: DemoModel = { ...model, essence: `${model.essence} ${deltaSummary}`.trim() };
  writeFileSync(demoJsonAbs, `${JSON.stringify(revised, null, 2)}\n`);
  renderDemoBundle(demoDirAbs, worktreePath); // re-render DEMO.md from the revised essence
  writeFileSync(prDescriptionAbs, derivePrBody(revised, derivedInput));
  emit('demo.delta-revised', { delta_summary: deltaSummary });
}

/** Run the integrate band. Synchronous by construction: nothing here waits on a model. */
export function runIntegrateBand(
  input: IntegrateBandInput,
  logger: EventLogger,
  gateEvidence: readonly MergeGateEvidence[],
  // The one port (operator ruling, items 81/83): optional; refuses by name
  // below the moment the `capture` column is actually read.
  classProfiles?: ClassProfilePort,
): IntegrateResult {
  const emit = (
    message: string,
    metadata: Record<string, unknown> = {},
    extra: { event_type?: 'log' | 'error' } = {},
  ): void => {
    logger.emit({
      initiative_id: input.initiativeId,
      phase: 'orchestrator',
      skill: INTEGRATE_SLUG,
      event_type: extra.event_type ?? 'log',
      input_refs: [],
      output_refs: [],
      message,
      metadata: { agent_slug: INTEGRATE_SLUG, ...metadata },
    });
  };

  // ── the branch's own facts ────────────────────────────────────────────────
  const diffStatRes = gitCapture(input.worktreePath, ['diff', '--shortstat', 'main...HEAD']);
  const headShaRes = gitCapture(input.worktreePath, ['rev-parse', 'HEAD']);
  if (!diffStatRes.ok || !headShaRes.ok) {
    const detail = `git derivation failed: ${diffStatRes.ok ? '' : diffStatRes.err} ${headShaRes.ok ? '' : headShaRes.err}`.trim();
    emit('demo.derive-error', { detail }, { event_type: 'error' });
    return { status: 'failed', reason: 'derive-failed', detail };
  }
  const diffStat = stripScratchFromDiffStat(diffStatRes.out.trim());
  if (diffStat.length === 0) {
    // Not a second empty-branch guard — `assertNonEmptyDelivery` already ran and
    // is the one that decides. This is the derivation refusing to build a demo
    // out of nothing: a model with an empty diffStat is not renderable, and
    // substituting a sentence for the missing fact would put a demo in front of
    // a reviewer for a branch that changed no file.
    const detail = 'the branch has no diff against main — there is nothing to demonstrate or open a PR for';
    emit('demo.derive-error', { detail }, { event_type: 'error' });
    return { status: 'failed', reason: 'derive-failed', detail };
  }
  const changedFilesRes = gitCapture(input.worktreePath, ['diff', '--name-only', 'main...HEAD']);
  const changedFiles = changedFilesRes.ok ? changedFilesRes.out.trim().split('\n').filter(Boolean) : [];

  let manifest;
  try {
    manifest = parseManifest(readFileSync(input.manifestPath, 'utf8'));
  } catch (err) {
    const detail = `manifest unreadable at ${input.manifestPath}: ${err instanceof Error ? err.message : String(err)}`;
    emit('demo.derive-error', { detail }, { event_type: 'error' });
    return { status: 'failed', reason: 'derive-failed', detail };
  }
  const profile = requireClassProfiles(classProfiles, 'integrate').profileFor(manifest.class);

  const cfg = (() => {
    try {
      return loadProjectConfig(input.worktreePath);
    } catch {
      return null;
    }
  })();

  const delivered = readDelivered(input.worktreePath, emit);
  const derivedInput: DerivedDemoInput = {
    initiativeId: input.initiativeId,
    title: manifest.title ?? input.initiativeId,
    project: manifest.project,
    diffStat,
    headSha: headShaRes.out.trim(),
    changedFiles,
    workItems: delivered.workItems,
    acceptanceCriteria: delivered.acceptanceCriteria,
    gateEvidence,
    demoProcess: cfg?.demoProcess ?? [],
    capture: profile.capture,
  };

  emit('demo.input.derived', {
    change_class: manifest.class,
    capture: profile.capture,
    diff_stat: derivedInput.diffStat,
    head_sha: derivedInput.headSha,
    acceptance_criteria: derivedInput.acceptanceCriteria.length,
    work_items: derivedInput.workItems.length,
    gates: gateEvidence.length,
  });

  const derived = deriveDemoModel(derivedInput);
  if (!derived.ok) {
    // A class that asks for evidence the project contract cannot produce is a
    // CONFIG error, in the same sense the merge gate's is: no agent can fix it
    // by editing this branch, so it is named and the band stops.
    const detail = derived.errors.join('; ');
    emit('demo.config-error', { errors: derived.errors, change_class: manifest.class }, { event_type: 'error' });
    return { status: 'failed', reason: 'config-error', detail };
  }

  // ── write what was derived ───────────────────────────────────────────────
  const demoDirRel = worktreeDemoRelDir(input.worktreePath, input.initiativeId);
  const demoDirAbs = worktreeDemoDir(input.worktreePath, input.initiativeId);
  const demoJsonAbs = join(demoDirAbs, DEMO_JSON_BASENAME);
  const prDescriptionAbs = join(input.worktreePath, PR_DESCRIPTION_REL);
  mkdirSync(demoDirAbs, { recursive: true });
  writeFileSync(demoJsonAbs, `${JSON.stringify(derived.model, null, 2)}\n`);

  const prBody = derivePrBody(derived.model, derivedInput);
  const missingSections = PR_BODY_SECTIONS.filter((s) => !prBody.includes(s));
  if (missingSections.length > 0) {
    // Structural backstop, not a validation of someone else's authoring: the
    // body is derived HERE, so a missing section is this module's own defect
    // and must fail loud rather than open a PR the reviewer cannot read.
    const detail = `derived PR body is missing ${missingSections.join(', ')}`;
    emit('demo.pr-body-invalid', { missing: missingSections }, { event_type: 'error' });
    return { status: 'failed', reason: 'render-failed', detail };
  }
  mkdirSync(join(input.worktreePath, '.forge'), { recursive: true });
  if (existsSync(prDescriptionAbs)) unlinkSync(prDescriptionAbs);
  writeFileSync(prDescriptionAbs, prBody);

  const render = renderDemoBundle(demoDirAbs, input.worktreePath);
  if (!render.ok) {
    const detail = render.errors.join('; ');
    emit('demo.render-failed', { errors: render.errors }, { event_type: 'error' });
    return { status: 'failed', reason: 'render-failed', detail };
  }

  // ── capture, where the class says so ─────────────────────────────────────
  const wantsCapture = profile.capture === 'checkpoints' && demoJsonWantsCapture(demoJsonAbs);
  if (!wantsCapture) {
    const committed = commitOrchestratedCaptureArtifacts(
      input.worktreePath,
      demoDirRel,
      input.initiativeId,
      `chore(demo): demo artifacts (${input.initiativeId})`,
    );
    emit('demo.artifacts.committed', { committed, capture: profile.capture });
    emit('demo.complete', { acceptance_criteria: derivedInput.acceptanceCriteria.length, capture: profile.capture });
    return { status: 'complete', demoJsonPath: join(demoDirRel, DEMO_JSON_BASENAME) };
  }

  const preflight = preflightDemoCaptureCommands(demoJsonAbs, input.worktreePath);
  if (!preflight.ok) {
    emit('demo.capture.tooling-unavailable', { problems: preflight.problems, failure_kind: 'environment' }, { event_type: 'error' });
    return {
      status: 'failed',
      reason: 'tooling-unavailable',
      detail: `demo capture command(s) not producible: ${preflight.problems.join('; ')}`,
    };
  }
  const nonce = generateCaptureNonce();
  const cap = runOrchestratorCommand(input.orchestratedCapture?.argv ?? buildDemoCaptureArgv(input.initiativeId), {
    cwd: input.worktreePath,
    timeoutMs: input.orchestratedCapture?.timeoutMs ?? resolveDemoCaptureTimeoutMs(),
    env: { ...process.env, [CAPTURE_NONCE_ENV]: nonce },
  });
  if (!cap.ok) {
    emit(
      'demo.capture',
      {
        capture_ok: false,
        exit_code: cap.exitCode,
        timed_out: cap.timedOut,
        failure_kind: cap.timedOut || cap.errored ? 'environment' : 'command',
        stderr_tail: cap.stderrTail.slice(-500),
      },
      { event_type: 'error' },
    );
    return { status: 'failed', reason: 'capture-failed', detail: `orchestrated capture failed (exit ${cap.exitCode}): ${cap.stderrTail.slice(-500)}` };
  }
  const verdict = judgeCaptureNonce(nonce, readStampedNonce(demoJsonAbs));
  if (!verdict.ok) {
    emit('demo.capture', { capture_ok: true, nonce_match: false, nonce_verdict: verdict.reason, capture_nonce: nonce }, { event_type: 'error' });
    return { status: 'failed', reason: verdict.reason, detail: verdict.detail };
  }
  reviseAfterCapture(demoJsonAbs, demoDirAbs, prDescriptionAbs, input.worktreePath, derivedInput, emit);
  const committed = commitOrchestratedCaptureArtifacts(input.worktreePath, demoDirRel, input.initiativeId);
  emit('demo.capture', { capture_ok: true, nonce_match: true, capture_nonce: nonce, exit_code: 0, committed, duration_ms: cap.durationMs });
  emit('demo.complete', { acceptance_criteria: derivedInput.acceptanceCriteria.length, capture: profile.capture });
  return { status: 'complete', demoJsonPath: join(demoDirRel, DEMO_JSON_BASENAME) };
}
