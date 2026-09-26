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
 * `createClaudeAgent` call). `demo-design` is the generated
 * `.forge/skills/demo-design/SKILL.md` the demo-builder SESSION writes (bead
 * forge-mfv5.2.8 tracks folding that session's output into the declaration
 * more directly) — presentation guidance for the Studio demo page, read by
 * nothing at cycle time. The integrate band derives checkpoints from
 * `demoProcess` and the initiative's typed acceptance criteria instead
 * (`extractDrivableCommand` / `extractDemoRoute` above).
 */
export const PRESENTATION_ONLY_SKILL_IDS = ['demo-design'] as const;
export type PresentationOnlySkillId = (typeof PRESENTATION_ONLY_SKILL_IDS)[number];
