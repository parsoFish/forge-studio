/**
 * The demo declaration's pure extraction rules (bead forge-mfv5.2.2).
 *
 * A project's `demoProcess` (`DemoStep[]`, `studio-types.ts`) is operator prose
 * that names a `capture` step's command — or an acceptance criterion's `WHEN`
 * clause names one — in an inline-code span. Three packages derive checkpoints
 * from that same prose and must agree on what counts as "drivable": the
 * merge-boundary station that derives `demo.json` (`@forge/stations`'s
 * `phases/derive-demo-model.ts`), the capture runtime's point-of-use route
 * guard (`@forge/factory`'s `demo.ts`, `resolveCheckpointUrl`), and the
 * preflight clause that tells the operator the declaration is actionable
 * before a cycle ever runs (`@forge/projects`'s `preflight-demo.ts`,
 * `checkDemoSkill`). A fourth copy of this rule is how the three would
 * silently disagree about which projects are demo-ready — so it lives once,
 * here, in the one package all three may import
 * (`docs/roadmaps/1.0.md` §0 rank order).
 *
 * PURE and IMPORTLESS — no filesystem, no node builtin, no other package — so
 * `apps/studio` may import it too (`check-boundaries`'s rule 2) if a client
 * surface ever needs to preview what a declaration will drive.
 */

/**
 * Shell metacharacters. A checkpoint command is spawned as a bare argv with no
 * shell (`captureCommandOutput`, `@forge/factory`'s `demo.ts`), so a declared
 * step containing any of these would not run as written — that is a
 * project-config error to say out loud, never something to quietly strip and
 * run anyway.
 */
export const SHELL_METACHARACTERS = /[|&;<>$`\\(){}[\]*?~\n]/;

/** The first inline-code span in a step/`WHEN`-clause's text, trimmed, or
 *  `null` when it names none. */
export function inlineCodeSpan(text: string): string | null {
  const match = /`([^`]+)`/.exec(text);
  return match ? match[1]!.trim() : null;
}

/** Why a text's inline-code span cannot drive a bare-argv capture command. */
export type DrivableCommandResult =
  | { ok: true; command: string }
  | { ok: false; reason: 'no-inline-code' }
  | { ok: false; reason: 'shell-metacharacters'; code: string };

/**
 * Whether a step/`WHEN`-clause's text names a command capture can actually
 * run: its first inline-code span, present and free of
 * `SHELL_METACHARACTERS`. The ONE rule shared by demo-model derivation
 * (`derive-demo-model.ts`'s `captureCheckpoints` / `acDerivedCheckpoints`) and
 * the `DEMO-SKILL` preflight clause (forge-mfv5.1.7 / forge-mfv5.2.2) — so a
 * capture step judged drivable by one is never judged undrivable by the other.
 */
export function extractDrivableCommand(text: string): DrivableCommandResult {
  const code = inlineCodeSpan(text);
  if (code === null || code.length === 0) return { ok: false, reason: 'no-inline-code' };
  if (SHELL_METACHARACTERS.test(code)) return { ok: false, reason: 'shell-metacharacters', code };
  return { ok: true, command: code };
}

/** A declared demo step, structurally — `DemoStep` (`studio-types.ts`) without
 *  the import, so this module stays importless. */
type DeclaredDemoStep = { readonly kind: string; readonly text: string };

/** Whether a whole declaration drives at least one checkpoint, and if not, why. */
export type DeclarationDriveResult =
  | { ok: true; drivable: number; captures: number }
  | { ok: false; reason: string };

/**
 * Whether a demo declaration drives at least one checkpoint: some `capture`
 * step's text yields a command under `extractDrivableCommand`. The ONE
 * whole-declaration rule (bead forge-mfv5.2.8), applied by the `DEMO-SKILL`
 * preflight clause and by the demo-builder session's lock, so a declaration
 * the lock accepts is never one preflight then reports as undrivable. The
 * refusal reason names every capture step and why it cannot run.
 */
export function declarationDrivesCheckpoint(steps: readonly DeclaredDemoStep[]): DeclarationDriveResult {
  const captures = steps
    .map((step, i) => ({ step, i, result: extractDrivableCommand(step.text) }))
    .filter(({ step }) => step.kind === 'capture');
  const drivable = captures.filter(({ result }) => result.ok).length;
  if (drivable > 0) return { ok: true, drivable, captures: captures.length };
  if (captures.length === 0) {
    return { ok: false, reason: "demoProcess declares no step of kind 'capture' — nothing can drive a checkpoint" };
  }
  const reasons = captures.map(({ step, i, result }) => {
    const why = !result.ok && result.reason === 'shell-metacharacters'
      ? `shell metacharacters in \`${result.code}\``
      : 'no inline-code span to run';
    return `capture step ${i} ("${step.text.slice(0, 60)}") yields no drivable command — ${why}`;
  });
  return { ok: false, reason: reasons.join('; ') };
}

/**
 * A safe demo checkpoint route: an absolute in-app path, no traversal. Shared
 * by the AC-derived checkpoint guard (`derive-demo-model.ts`'s
 * `acDerivedCheckpoints`), the capture runtime's point-of-use guard
 * (`resolveCheckpointUrl`, `@forge/factory`'s `demo.ts`), and
 * `validateDemoModel`'s `checkpoint.route` check — one rule spelled once, so a
 * browser checkpoint's route can never be accepted by one and rejected by
 * another (forge-mfv5.1.7).
 */
const SAFE_ROUTE_RE = /^\/[A-Za-z0-9/_\-.?=&%]*$/;

export function isSafeDemoRoute(route: string): boolean {
  return SAFE_ROUTE_RE.test(route) && !route.includes('..');
}

/**
 * The in-app route a text's inline-code span names, when the span is
 * route-shaped (starts with `/`). `{ routeShaped: false }` when the span (if
 * any) is not route-shaped at all — the caller then tries
 * `extractDrivableCommand` instead. `{ routeShaped: true, route: null }` when
 * the span IS route-shaped but fails `isSafeDemoRoute`: an unsafe route names
 * nothing drivable, and the caller must never fall through to reading it as a
 * command (forge-mfv5.1.7).
 */
export type RouteExtraction = { routeShaped: true; route: string | null } | { routeShaped: false };

export function extractDemoRoute(text: string): RouteExtraction {
  const code = inlineCodeSpan(text);
  if (code === null || code.length === 0 || !code.startsWith('/')) return { routeShaped: false };
  return { routeShaped: true, route: isSafeDemoRoute(code) ? code : null };
}

/**
 * Skill ids that shape the Studio PRESENTATION of a demo, never a cycle
 * input — an agent's prompt must not fold these in (`@forge/projects`'s
 * `loadDeclaredSkills`, the one loader both `runOneShotSpawn` and
 * `createClaudeAgent` call). `demo-design` is guidance for AUTHORING the
 * declaration; a project-local `.forge/skills/demo-design/SKILL.md` left by an
 * earlier demo-builder session is read by nothing at cycle time (since bead
 * forge-mfv5.2.8 that session writes the declaration itself, and no SKILL.md).
 * The integrate band derives checkpoints from
 * `demoProcess` and the initiative's typed acceptance criteria instead
 * (`extractDrivableCommand` / `extractDemoRoute` above).
 */
export const PRESENTATION_ONLY_SKILL_IDS = ['demo-design'] as const;
export type PresentationOnlySkillId = (typeof PRESENTATION_ONLY_SKILL_IDS)[number];

/** What a worktree's package.json `bin` says about a bare checkpoint command. */
export type DeclaredBinResult =
  | { kind: 'undeclared' }
  | { kind: 'contained'; target: string }
  | { kind: 'rejected'; target: string; reason: string };

/**
 * A bare checkpoint command whose head is not on PATH may still be a binary
 * the ground declares (`"bin": {"gitpulse": "./dist/cli.js"}`) — bead
 * forge-8vfn.30.9. This is the pure half of that lookup: given the parsed
 * package.json and the head, says whether the head is declared and whether
 * its target stays INSIDE the worktree (lexically; `@forge/kernel`'s
 * `resolveCheckpointHead` re-checks symlinks against the real tree). A string
 * `bin` counts under the package's `name` (scope stripped, as npm links it);
 * an object `bin` by own key. An absolute target, one that climbs out of the
 * worktree, or a malformed one is `rejected` with a reason — never skipped,
 * never followed.
 */
export function resolveDeclaredBin(pkg: unknown, name: string): DeclaredBinResult {
  if (typeof pkg !== 'object' || pkg === null) return { kind: 'undeclared' };
  const { bin, name: pkgName } = pkg as { bin?: unknown; name?: unknown };
  let target: unknown;
  if (typeof bin === 'string') {
    if (typeof pkgName !== 'string' || pkgName.replace(/^@[^/]+\//, '') !== name) return { kind: 'undeclared' };
    target = bin;
  } else if (typeof bin === 'object' && bin !== null && Object.hasOwn(bin, name)) {
    target = (bin as Record<string, unknown>)[name];
  } else {
    return { kind: 'undeclared' };
  }
  const shown = typeof target === 'string' ? target : String(target);
  if (typeof target !== 'string' || target.trim() === '') {
    return { kind: 'rejected', target: shown, reason: `bin "${name}" declares a non-string or empty target` };
  }
  if (/^([/\\]|[A-Za-z]:)/.test(target)) {
    return { kind: 'rejected', target, reason: `bin "${name}" target \`${target}\` is absolute — a declared bin must stay inside the worktree` };
  }
  const kept: string[] = [];
  for (const seg of target.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (kept.pop() === undefined) {
        return { kind: 'rejected', target, reason: `bin "${name}" target \`${target}\` resolves outside the worktree` };
      }
      continue;
    }
    kept.push(seg);
  }
  if (kept.length === 0) {
    return { kind: 'rejected', target, reason: `bin "${name}" target \`${target}\` names the worktree root, not a file` };
  }
  return { kind: 'contained', target: kept.join('/') };
}
