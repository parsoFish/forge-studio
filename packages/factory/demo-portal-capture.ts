/**
 * Portal capture (forge-8vfn.31, D-45 amended): the third-party site a project configures, shown as page frames
 * before and after. For each side, the tree under capture runs the project's own `apply` commands (so the live
 * site shows what THAT tree declares), then each declared page is recorded with the operator's auth state,
 * pinned to the declared origins (`recordPortal`). Sides run before → after, so the site is left in the AFTER
 * state; `portal-apply.md` in the bundle says so and records what each apply printed.
 *
 * The auth state is an env var NAME in the declaration; its value (a path to a Playwright storage-state file)
 * is read here, checked readable, and handed to Playwright by path — never logged, copied or written.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkpointArtifactStem } from '@forge/stations/demo-types.ts';
import { resolveCheckpointHead } from '@forge/kernel';
import { checkBrowserSteps, type BrowserStepDecl, type DemoPortal } from '@forge/projects';

export type PortalCheckpoint = { label: string; page: string; steps?: BrowserStepDecl[]; regions?: string[] };
export type PortalCapture = { means: DemoPortal; checkpoints: PortalCheckpoint[] };
export type AuthStateResolution = { ok: true; path?: string } | { ok: false; reason: string };

const APPLY_TIMEOUT_MS = 5 * 60_000;
const APPLY_OUTPUT_MAX_CHARS = 4000;
export const PORTAL_APPLY_RECORD = 'portal-apply.md';

/** The storage-state path the declared env var names; a declared one that cannot be read is refused by name. */
export function resolvePortalAuthState(name: string | undefined, env: Readonly<Record<string, string | undefined>>): AuthStateResolution {
  if (name === undefined) return { ok: true };
  const refuse = (why: string): AuthStateResolution => ({ ok: false, reason: `portal auth state not declared/readable: ${name} ${why}` });
  const path = env[name];
  if (path === undefined || path.trim() === '') return refuse('is unset or empty');
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    // The error names the env var and the failure class only — never the path or any of the file's bytes.
    return refuse(err instanceof SyntaxError ? 'names a file that is not JSON' : 'names a file that cannot be read');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return refuse('names a file that is not a storage-state object');
  return { ok: true, path };
}

/** The demo.json checkpoints to record as portal pages: only a page the project declares, re-checked at the point of use. */
export function portalCheckpointsOf(
  cps: ReadonlyArray<{ label?: string; form?: string; command?: string; page?: unknown; steps?: unknown; regions?: unknown }>,
  means: DemoPortal | undefined,
): { checkpoints: PortalCheckpoint[]; refused: string[] } {
  const checkpoints: PortalCheckpoint[] = [];
  const refused: string[] = [];
  for (const c of cps) {
    if (!c.label || (c.form !== 'portal-before-after' && c.page === undefined)) continue;
    if (!means) { refused.push(`${c.label}: the project declares no demoMeans.portal`); continue; }
    if (typeof c.page !== 'string' || !means.pages.includes(c.page)) { refused.push(`${c.label}: ${JSON.stringify(c.page)} is not a declared portal page`); continue; }
    const errors: string[] = [];
    checkBrowserSteps(c.steps, c.regions, 'checkpoint', errors);
    if (errors.length > 0) { refused.push(`${c.label}: ${errors.join('; ')}`); continue; }
    checkpoints.push({
      label: c.label, page: c.page,
      ...(c.steps !== undefined ? { steps: c.steps as BrowserStepDecl[] } : {}),
      ...(c.regions !== undefined ? { regions: c.regions as string[] } : {}),
    });
  }
  return { checkpoints, refused };
}

type ApplyResult = { ok: true; log: string } | { ok: false; reason: string; log: string };

/** Run the apply commands in order from the tree under capture; the first that cannot run or exits non-zero stops it. */
export function runPortalApply(worktreePath: string, commands: readonly string[], runPrefixes: Readonly<Record<string, string>>): ApplyResult {
  let log = '';
  for (const command of commands) {
    const head = resolveCheckpointHead(command.trim().split(/\s+/), worktreePath, { runPrefixes });
    if (!head.ok) return { ok: false, reason: `\`${command}\` did not run: ${head.reason}`, log };
    const r = spawnSync(head.file, head.args, { cwd: worktreePath, encoding: 'utf8', timeout: APPLY_TIMEOUT_MS });
    const out = `${r.stdout ?? ''}${r.stderr ? `[stderr] ${r.stderr}` : ''}`;
    log += `$ ${command}\n${out.length > APPLY_OUTPUT_MAX_CHARS ? `${out.slice(0, APPLY_OUTPUT_MAX_CHARS)}\n…[truncated]` : out}\n`;
    if (r.error) return { ok: false, reason: `\`${command}\` did not run: ${r.error.message}`, log };
    if (r.status !== 0) return { ok: false, reason: `\`${command}\` exited ${r.status ?? r.signal}`, log };
  }
  return { ok: true, log };
}

/**
 * One side of a portal capture: apply from this tree, then record every checkpoint. A refused auth state or a
 * failed apply records nothing for this side (the control reads `unknown`), each named on stderr and in the
 * bundle's apply record. Returns the labels captured.
 */
export async function capturePortalSide(opts: {
  portal: PortalCapture; side: 'before' | 'after'; worktreePath: string; bundleDir: string;
  runPrefixes: Readonly<Record<string, string>>; auth: AuthStateResolution;
}): Promise<string[]> {
  const { portal, side, worktreePath, bundleDir } = opts;
  const record = (text: string): void => appendFileSync(join(bundleDir, PORTAL_APPLY_RECORD), text);
  if (side === 'before') record(`# Portal apply\n\nEach capture tree ran the project's apply before its frames; the sides run before then after, so when both applies succeed the portal is left in the AFTER state.\n\n`);
  if (!opts.auth.ok) {
    process.stderr.write(`[demo] portal ${side}: ${opts.auth.reason} — no portal frames\n`);
    record(`## ${side}\n\nRefused: ${opts.auth.reason}. Nothing applied, no page opened.\n\n`);
    return [];
  }
  const applied = runPortalApply(worktreePath, portal.means.apply, opts.runPrefixes);
  record(`## ${side}\n\n\`\`\`\n${applied.log}\`\`\`\n\n${applied.ok ? '' : `Refused: ${applied.reason}. No page opened.\n\n`}`);
  if (!applied.ok) {
    process.stderr.write(`[demo] portal ${side}: apply failed (${applied.reason}) — no portal frames${side === 'after' ? '; the portal may be left in the BEFORE state' : ''}\n`);
    return [];
  }
  const { recordPortal } = await import('./demo-capture.ts');
  const captured: string[] = [];
  for (const cp of portal.checkpoints) {
    try {
      await recordPortal({
        side, label: checkpointArtifactStem(cp.label), origins: portal.means.origins, page: cp.page, bundleDir,
        ...(opts.auth.path ? { authStatePath: opts.auth.path } : {}),
        ...(cp.steps ? { steps: cp.steps } : {}), ...(cp.regions ? { regions: cp.regions } : {}),
      });
      captured.push(cp.label);
    } catch (err) {
      process.stderr.write(`[demo] recordPortal(${side}/${cp.label}) refused — no frame for this checkpoint: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
  return captured;
}
