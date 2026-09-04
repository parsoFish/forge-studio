/**
 * Everything the drain writes or reads OUTSIDE its own engine loop: where a
 * run's status lives and how it is written and read back, how runs are
 * discovered and listed, the cancel flag, the structural-gate revert, and the
 * KB-cleanup draft session a finished drain hands to the operator.
 *
 * Split out of `bridge-studio-kb-drain.ts` in M4 PR 5. Grouped by EFFECT
 * rather than by feature: these are the drain's filesystem writes, so the
 * audited `scripts/check-raw-fs-guarded.mjs` residuals travel together and
 * were re-keyed from a real `--json` run. Every path is built from a
 * server-minted `runId` under the trusted `_logs` root.
 */
import { requireSessionStatusIo } from './kb-drain-model.ts';
import type { GuardedWriteSessionStatusFn } from './kb-drain-model.ts';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { resolveKbBrainDir } from './brain-paths.ts';
import { loadConfig, defaultConfigPath, resolveProjectsDir, guardedWriteFile } from '@forge/kernel';
import { loadKbDescriptor } from './studio/kb-descriptor.ts';
import { KB_SEEDING_ANCHOR_PREFIX } from './bridge-studio-kbs.ts';
import { buildUnifiedDiff, type KbEditChange } from './kb-drain-structural.ts';
import { auditKbEdit, buildKbEditSoundnessCtx } from './kb-drain-edit-soundness.ts';
import { parseKbRunEvents, terminalKbRunEvent, firstKbRunEventTs } from './kb-job-state.ts';
import {
  DEFAULT_KB_DRAIN_MAX_COST_USD,
  KB_DRAIN_MAX_ROUNDS,
  type KbDrainStatus,
} from './kb-drain-model.ts';

// ---------------------------------------------------------------------------
// Status-file persistence (_logs/_kb-drain-<runId>/status.json)
// ---------------------------------------------------------------------------

/** `_logs/_kb-drain-<runId>` — same construction class as
 *  `writeConsolidateTerminalEvent`'s `_logs/_brainfix-<runId>`
 *  (packages/knowledge/bridge-studio-kbs.ts): a bare `runId` parameter matches the
 *  raw-fs-guarded lint's curated taint-list name, but at every real call
 *  site the value is TRUSTED AT CONSTRUCTION — either freshly minted by
 *  `POST /api/studio/kbs/:id/drain` as `` `${kbId}-drain-${Date.now()
 *  .toString(36)}` `` (kbId already `KB_ID_RE`-gated at that same route
 *  strictly before this is ever called), or read back via `isSafeRunId` +
 *  an explicit `${kbId}-drain-` PREFIX check at the two GET routes below
 *  (never trusted on charset alone). Documented in
 *  docs/reference/request-path-sinks.md's "Extended in W6-B12" section;
 *  allowlisted in scripts/check-raw-fs-guarded.mjs. */
export function kbDrainLogDir(forgeRoot: string, runId: string): string {
  return join(forgeRoot, '_logs', `_kb-drain-${runId}`);
}

/** Atomic write (temp + rename) — mirrors this repo's own convention
 *  (packages/flows/bridge-studio-runs.ts's manifest-move: `writeFileSync(tmpPath, …)`
 *  then `renameSync(tmpPath, toPath)`). `status.json` is read by a SEPARATE
 *  process turn (the GET routes, polled every ~100-250ms by a caller) while
 *  this function is called repeatedly (once per round) by the in-flight
 *  drain — a plain `writeFileSync` on the final path would let a concurrent
 *  reader observe a PARTIALLY-written file (the write is not one syscall for
 *  a multi-KB JSON blob); `renameSync` on the same filesystem is atomic, so
 *  a reader only ever sees the FULLY-written prior version or the
 *  FULLY-written new one, never a truncated/interleaved one. */
export function writeKbDrainStatus(forgeRoot: string, runId: string, status: KbDrainStatus): void {
  const logDir = kbDrainLogDir(forgeRoot, runId);
  mkdirSync(logDir, { recursive: true });
  const finalPath = join(logDir, 'status.json');
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(status, null, 2), 'utf8');
  renameSync(tmpPath, finalPath);
}

/** Mirrors `readBrainFixState`'s (packages/knowledge/bridge-studio-kbs.ts) LOG-READ shape:
 *  a boolean-existence probe plus a single scoped read, never a directory
 *  walk keyed off caller input. Returns `null` on any missing/unparseable
 *  status file — a genuinely unknown or not-yet-started run, never a thrown
 *  500. */
export function readKbDrainStatus(forgeRoot: string, runId: string): KbDrainStatus | null {
  const statusPath = join(kbDrainLogDir(forgeRoot, runId), 'status.json');
  if (!existsSync(statusPath)) return null;
  try {
    return JSON.parse(readFileSync(statusPath, 'utf8')) as KbDrainStatus;
  } catch {
    return null;
  }
}

/** Every drain run recorded for `kbId`, discovered by enumerating `_logs/`
 *  (SERVER-enumerated directory names, never a caller-supplied path — same
 *  "server-enumerated names, holding no client string" class as
 *  `packages/flows/metrics.ts`'s `listCycles`) and filtering to this kb's own
 *  `_kb-drain-<kbId>-drain-*` prefix. Used by BOTH the 409-active check
 *  (`POST /drain`) and the active-or-latest reattach route
 *  (`GET /drain`). */
export function findKbDrainRuns(forgeRoot: string, kbId: string): Array<{ runId: string; status: KbDrainStatus }> {
  const logsRoot = join(forgeRoot, '_logs');
  if (!existsSync(logsRoot)) return [];
  let entries: string[];
  try {
    entries = readdirSync(logsRoot);
  } catch {
    return [];
  }
  const dirPrefix = '_kb-drain-';
  const runIdPrefix = `${kbId}-drain-`;
  const runs: Array<{ runId: string; status: KbDrainStatus }> = [];
  for (const name of entries) {
    if (!name.startsWith(dirPrefix)) continue;
    const runId = name.slice(dirPrefix.length);
    if (!runId.startsWith(runIdPrefix)) continue;
    const status = readKbDrainStatus(forgeRoot, runId);
    if (status) runs.push({ runId, status });
  }
  return runs;
}

export function findActiveKbDrainRun(forgeRoot: string, kbId: string): { runId: string; status: KbDrainStatus } | null {
  return findKbDrainRuns(forgeRoot, kbId).find((r) => r.status.state === 'running') ?? null;
}

export function latestKbDrainRun(forgeRoot: string, kbId: string): { runId: string; status: KbDrainStatus } | null {
  const runs = findKbDrainRuns(forgeRoot, kbId);
  if (runs.length === 0) return null;
  return runs.reduce((a, b) => (a.status.updatedAt >= b.status.updatedAt ? a : b));
}

// ---------------------------------------------------------------------------
// KB run history (W7-B2, knowledge-20) — every drain / consolidate /
// kb-cleanup run recorded for one KB, for the RecentRuns widget.
// ---------------------------------------------------------------------------

export type KbRunRow = {
  kind: 'drain' | 'consolidate' | 'cleanup';
  id: string;
  /** ISO start stamp, or '' when genuinely unknown (never fabricated). */
  when: string;
  /** drain: KbDrainState · consolidate: running|done|failed · cleanup: the
   *  session's own phase, verbatim. */
  status: string;
  /** null = the cost genuinely is not recorded (never a fabricated 0). */
  costUsd: number | null;
  detail: string | null;
  /** cleanup only — the session's anchor project, for the deep link. */
  project?: string;
};

/** One consolidate run's terminal facts, read from its own events.jsonl
 *  through the SHARED readers in packages/knowledge/kb-job-state.ts (W7-B2 code-review
 *  round) — the same 'end'=done / 'error'=failed definition the active-job
 *  gate uses, so the RecentRuns status and the gate can never disagree about
 *  whether a run has finished. */
export function readConsolidateRunRow(forgeRoot: string, runId: string): { status: string; costUsd: number | null; when: string; detail: string | null } {
  const evPath = join(forgeRoot, '_logs', `_brainfix-${runId}`, 'events.jsonl');
  let raw: string | null = null;
  try {
    // Probe and read on separate lines — the raw-fs-guarded allowlist keys
    // one audited entry per (file, line, sink).
    if (existsSync(evPath)) {
      raw = readFileSync(evPath, 'utf8');
    }
  } catch {
    raw = null;
  }
  const events = parseKbRunEvents(raw ?? '');
  const terminal = terminalKbRunEvent(events);
  const when = firstKbRunEventTs(events) ?? '';
  let costUsd: number | null = null;
  let detail: string | null = null;
  if (terminal?.status === 'done') {
    if (typeof terminal.event.cost_usd === 'number') costUsd = terminal.event.cost_usd;
    const md = terminal.event.metadata ?? {};
    if (typeof md['clearedCount'] === 'number' && typeof md['total'] === 'number') {
      detail = `cleared ${md['clearedCount']}/${md['total']}`;
    }
  }
  return { status: terminal?.status ?? 'running', costUsd, when, detail };
}

/** Best-effort ISO stamp from a session id shaped `2026-08-18T12-54-32-…`
 *  (the bridge's own session-id convention). '' when it does not parse. */
export function whenFromSessionId(sessionId: string): string {
  const m = sessionId.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z`;
}

export function listKbRuns(forgeRoot: string, kbId: string): KbRunRow[] {
  const rows: KbRunRow[] = [];

  // Drain runs — status.json is the record.
  for (const { runId, status } of findKbDrainRuns(forgeRoot, kbId)) {
    rows.push({
      kind: 'drain',
      id: runId,
      when: status.startedAt ?? status.updatedAt ?? '',
      status: status.state,
      costUsd: typeof status.costUsd === 'number' ? status.costUsd : null,
      detail: `round ${status.round}/${status.maxRounds ?? KB_DRAIN_MAX_ROUNDS} · auto ${status.counts?.auto ?? 0} · agent ${status.counts?.agent ?? 0} · you ${status.counts?.user ?? 0}`,
    });
  }

  // Consolidate runs — `_brainfix-<kbId>-consolidate-*` top-level dirs
  // (per-finding `__<i>` sub-runs excluded, mirroring the consolidate/active
  // route's own exclusion in packages/knowledge/bridge-studio-kbs.ts).
  const logsRoot = join(forgeRoot, '_logs');
  let entries: string[] = [];
  try {
    entries = existsSync(logsRoot) ? readdirSync(logsRoot) : [];
  } catch {
    entries = [];
  }
  const consolidatePrefix = `_brainfix-${kbId}-consolidate-`;
  for (const name of entries) {
    if (!name.startsWith(consolidatePrefix)) continue;
    const runId = name.slice('_brainfix-'.length);
    if (runId.includes('__')) continue;
    const r = readConsolidateRunRow(forgeRoot, runId);
    rows.push({ kind: 'consolidate', id: runId, when: r.when, status: r.status, costUsd: r.costUsd, detail: r.detail });
  }

  // kb-cleanup sessions — anchored under the KB's own session project
  // (binding.ref for a project KB, the `.kb-<id>` anchor otherwise).
  const brainDir = resolveKbBrainDir(forgeRoot, kbId);
  let anchor = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
  if (brainDir) {
    try {
      const kb = loadKbDescriptor(join(brainDir, 'kb.yaml'));
      if (kb.binding.kind === 'project') anchor = kb.binding.ref;
    } catch {
      // fall through to the dot anchor
    }
  }
  const projectsRoot = resolveProjectsDir(forgeRoot, loadConfig(defaultConfigPath(forgeRoot)));
  const cleanupDir = join(projectsRoot, anchor, '_kb-cleanup');
  let sids: string[] = [];
  try {
    sids = existsSync(cleanupDir) ? readdirSync(cleanupDir) : [];
  } catch {
    sids = [];
  }
  for (const sid of sids) {
    let phase = 'unknown';
    let sessionKbId: string | null = null;
    try {
      const parsed = JSON.parse(readFileSync(join(cleanupDir, sid, 'status.json'), 'utf8')) as { phase?: unknown; kb_id?: unknown };
      if (typeof parsed.phase === 'string') phase = parsed.phase;
      if (typeof parsed.kb_id === 'string') sessionKbId = parsed.kb_id;
    } catch {
      continue;
    }
    // A project anchor can host cleanup sessions for a DIFFERENT kb id
    // (project-bound KBs share the project dir) — filter on the session's
    // own kb_id when it carries one.
    if (sessionKbId !== null && sessionKbId !== kbId) continue;
    rows.push({ kind: 'cleanup', id: sid, when: whenFromSessionId(sid), status: phase, costUsd: null, detail: null, project: anchor });
  }

  return rows.sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
}

export function initialKbDrainStatus(
  kbId: string,
  maxRounds: number = KB_DRAIN_MAX_ROUNDS,
  maxCostUsd: number = DEFAULT_KB_DRAIN_MAX_COST_USD,
): KbDrainStatus {
  const now = new Date().toISOString();
  return {
    state: 'running', round: 0, counts: { auto: 0, agent: 0, user: 0 }, perFinding: [],
    costUsd: 0, kbId, updatedAt: now, startedAt: now, maxRounds, maxCostUsd,
  };
}

// ---------------------------------------------------------------------------
// Cancel flag (W7-B2, knowledge-14)
// ---------------------------------------------------------------------------

export function kbDrainCancelPath(forgeRoot: string, runId: string): string {
  return join(kbDrainLogDir(forgeRoot, runId), 'cancel.json');
}

/** Ask a live drain run to stop after its current turn. File-based (not
 *  in-memory) so it works across the enqueueConsolidate queue boundary and
 *  survives a bridge restart racing the loop. */
export function requestKbDrainCancel(forgeRoot: string, runId: string): void {
  mkdirSync(kbDrainLogDir(forgeRoot, runId), { recursive: true });
  writeFileSync(kbDrainCancelPath(forgeRoot, runId), JSON.stringify({ requestedAt: new Date().toISOString() }) + '\n', 'utf8');
}

export function isKbDrainCancelRequested(forgeRoot: string, runId: string): boolean {
  return existsSync(kbDrainCancelPath(forgeRoot, runId));
}

// ---------------------------------------------------------------------------
// Structural-only gate helpers (W7-B2, orch-01)
// ---------------------------------------------------------------------------

/** Restore every gated change to its pre-turn content — a created file is
 *  removed, an edited/deleted file is written back byte-for-byte. Paths are
 *  snapshot-derived (our OWN walk of the trusted `brainDir`), never
 *  request/agent text. */
export function revertProseChanges(brainDir: string, changes: readonly KbEditChange[]): void {
  for (const c of changes) {
    const abs = join(brainDir, c.relPath);
    if (c.before === null) {
      rmSync(abs, { force: true });
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, c.before, 'utf8');
  }
}

export function newDraftSessionId(): string {
  const iso = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  return `${iso}-${randomBytes(4).toString('hex')}`;
}

/**
 * Park a gated (prose-touching) agent fix as a kb-cleanup DRAFT session the
 * operator approves with a diff — the EXISTING kb-cleanup session kind
 * (studio/session-kinds.yaml), minted directly in `awaiting-approval` (no
 * agent turn needed; the drain already holds the proposal). `status.json`
 * carries `draft_apply` — `approveKbCleanup` (packages/knowledge/bridge-studio-kbs.ts)
 * applies exactly those drafts (contained to this KB's own brain dir)
 * instead of running a consolidate. Returns null (and the caller records an
 * honest not-cleared) when the session cannot be written — never a throw
 * that would fail the whole drain over a parking problem.
 */
export function mintKbCleanupDraftSession(
  forgeRoot: string,
  kbId: string,
  /** The KB's own dir — for its `kb.yaml` descriptor. */
  brainDir: string,
  /** `<forgeRoot>/brain` — what every `KbEditChange.relPath` is relative to. */
  brainRoot: string,
  finding: { check: string; kind: string; file: string; message: string },
  proseChanges: readonly KbEditChange[],
  runId: string,
  round: number,
  /** Ruling 99: the guarded status writer arrives as a PORT this package
   *  declares (`SessionStatusIoPort`), never as an import of `@forge/sessions`
   *  — rank 2 may not reach rank 4. Absent, the mint refuses by name. */
  guardedWriteSessionStatus?: GuardedWriteSessionStatusFn,
): { id: string; project: string } | null {
  const write = requireSessionStatusIo(guardedWriteSessionStatus, 'mintKbCleanupDraftSession');
  try {
    // W8-F1 — FAIL CLOSED, in the second layer. The caller already filters out
    // everything the gate refused; this re-derives the same verdict rather
    // than trusting that filter, because approving a draft writes `after` back
    // byte-for-byte and a single miss here is the whole forge-d8l class handed
    // back as a button. This block used to render the audit's reasons as a
    // WARNING on the plan page and mint the draft anyway — which the C4
    // refuter correctly called a one-click destruction button.
    const guardCtx = buildKbEditSoundnessCtx(forgeRoot, brainRoot);
    const unsound = proseChanges.flatMap((c) => auditKbEdit(c, guardCtx));
    if (unsound.length > 0) return null;
    let binding: unknown = { kind: 'unique' };
    let project = `${KB_SEEDING_ANCHOR_PREFIX}${kbId}`;
    try {
      const kb = loadKbDescriptor(join(brainDir, 'kb.yaml'));
      binding = kb.binding;
      if (kb.binding.kind === 'project') project = kb.binding.ref;
    } catch {
      // No/unparseable kb.yaml — the dot-anchor fallback above still works.
    }
    const projectsRoot = resolveProjectsDir(forgeRoot, loadConfig(defaultConfigPath(forgeRoot)));
    // The guarded write realpath-walks projectsRoot itself — which may not
    // exist yet on a fresh install (or an isolated test root).
    mkdirSync(projectsRoot, { recursive: true });
    const sessionId = newDraftSessionId();

    const draftApply: Array<{ file: string; draft: string }> = [];
    const diffs: string[] = [];
    const draftBodies: string[] = [];
    for (const c of proseChanges) {
      if (c.after === null) continue; // a deletion is refused outright, never drafted
      const relFromRoot = relative(forgeRoot, join(brainRoot, c.relPath));
      draftApply.push({ file: relFromRoot, draft: `drafts/${draftBodies.length}.md` });
      diffs.push(buildUnifiedDiff(relFromRoot, c.before ?? '', c.after));
      draftBodies.push(c.after);
    }
    if (draftApply.length === 0) return null;

    const written = write(projectsRoot, [project, '_kb-cleanup', sessionId], {
      session_id: sessionId,
      project,
      phase: 'awaiting-approval',
      kb_id: kbId,
      kb_binding: binding,
      findings: [{ kind: finding.kind, check: finding.check, file: finding.file, message: finding.message }],
      draft_apply: draftApply,
      origin: 'kb-drain',
      drain_run_id: runId,
      drain_round: round,
    });
    if (written === null) return null;

    // Session dir now exists (guardedWriteSessionStatus created it); drafts/
    // and plan/ are its own server-minted children. Every write goes through
    // guardedWriteFile — the LEAF included (raw-fs-guarded's leaf-append
    // rule), which also creates the parent dir.
    let draftsOk = true;
    draftBodies.forEach((body, i) => {
      const p = guardedWriteFile(projectsRoot, [project, '_kb-cleanup', sessionId, 'drafts', `${i}.md`], body);
      if (p === null) draftsOk = false;
    });
    if (!draftsOk) return null;

    const plan = [
      '# Drain-gated prose edit',
      '',
      'Drain-to-green applies STRUCTURAL fixes only (frontmatter, links, index',
      "pages). The brain-fix agent's proposed fix for the finding below rewrites",
      'theme PROSE, so it is parked here for your approval instead of landing',
      'silently (wave-7 orch-01).',
      '',
      `Finding: [${finding.kind}] ${relative(forgeRoot, finding.file)} — ${finding.message}`,
      `Drain run: ${runId} (round ${round})`,
      '',
      ...draftApply.map((d) => `- [${finding.kind}] ${d.file} — drain-gated prose edit awaiting approval (approve replaces the file with ${d.draft})`),
      '',
      'Every change below was audited for graph soundness before it was parked',
      '(W8-F1): a prose edit that also deletes a resolvable related_themes edge,',
      'drops a live link or repoints one at a target that does not exist is',
      'REFUSED outright and never reaches this page. The SAME audit runs again',
      'when you approve, against the file as it stands then — so if anything',
      'edits this theme while the session waits, the apply refuses rather than',
      'writing this draft over it. What is left for you to judge is the prose.',
      '',
      'Approving this session applies the draft content below verbatim.',
      '',
      '```diff',
      diffs.join('\n\n'),
      '```',
      '',
    ].join('\n');
    if (guardedWriteFile(projectsRoot, [project, '_kb-cleanup', sessionId, 'plan', 'cleanup-plan.md'], plan) === null) return null;

    return { id: sessionId, project };
  } catch {
    return null;
  }
}
