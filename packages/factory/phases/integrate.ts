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
import { parseManifest } from '@forge/flows/manifest.ts';
import type { MergeGateEvidence } from '@forge/flows/cycle-helpers.ts';
import { worktreeDemoDir, worktreeDemoRelDir, DEMO_JSON_BASENAME } from '@forge/flows/demo-paths.ts';
import { readWorkItemsFromDir } from '@forge/flows/work-item.ts';
import {
  buildDemoCaptureArgv,
  CAPTURE_NONCE_ENV,
  commitOrchestratedCaptureArtifacts,
  demoJsonWantsCapture,
  generateCaptureNonce,
  preflightDemoCaptureCommands,
  resolveDemoCaptureTimeoutMs,
  runOrchestratorCommand,
} from '@forge/flows/phases/orchestrated-capture.ts';
import { loadProjectConfig } from '@forge/projects/project-config.ts';

import { renderDemoBundle, stripScratchFromDiffStat } from '../demo-model.ts';
import { profileFor } from '../class-profiles.ts';
import { judgeCaptureNonce, readStampedNonce } from './capture-nonce.ts';
import { deriveDemoModel, type DerivedDemoInput } from './derive-demo-model.ts';
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
  const acceptanceCriteria: string[] = [];
  if (!existsSync(wiDir)) return { workItems, acceptanceCriteria };
  const { items, parseErrors } = readWorkItemsFromDir(wiDir);
  if (Object.keys(parseErrors).length > 0) {
    // A malformed WI's criteria would silently vanish from the demo's AC table —
    // surface loudly (the bundle still derives from the parseable set).
    emit('demo.wi-parse-errors', { errors: parseErrors }, { event_type: 'error' });
  }
  const mutableItems = workItems as { id: string; title: string; status: string }[];
  for (const wi of items) {
    mutableItems.push({ id: wi.work_item_id, title: wi.body.split('\n')[0] ?? wi.work_item_id, status: wi.status });
    for (const ac of wi.acceptance_criteria) {
      acceptanceCriteria.push(`(${wi.work_item_id}) GIVEN ${ac.given.trim()} WHEN ${ac.when.trim()} THEN ${ac.then.trim()}`);
    }
  }
  return { workItems, acceptanceCriteria };
}

/** Run the integrate band. Synchronous by construction: nothing here waits on a model. */
export function runIntegrateBand(
  input: IntegrateBandInput,
  logger: EventLogger,
  gateEvidence: readonly MergeGateEvidence[],
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
  const profile = profileFor(manifest.class);

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
  const committed = commitOrchestratedCaptureArtifacts(input.worktreePath, demoDirRel, input.initiativeId);
  emit('demo.capture', { capture_ok: true, nonce_match: true, capture_nonce: nonce, exit_code: 0, committed, duration_ms: cap.durationMs });
  emit('demo.complete', { acceptance_criteria: derivedInput.acceptanceCriteria.length, capture: profile.capture });
  return { status: 'complete', demoJsonPath: join(demoDirRel, DEMO_JSON_BASENAME) };
}
