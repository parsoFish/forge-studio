/**
 * bridge-studio-demo.ts — the demo-builder session kind's `/api/demo-builder/*`
 * routes, carved out of `cli/ui-bridge.ts`.
 *
 * Eleven routes: six reads (sessions list, the demo and fragment servers, a
 * generation file server, and two history routes) and five writes (start,
 * brief, feedback, lock, abandon). Arms VERBATIM; the only edits are
 * `readJson(req)` → `ctx.readBody()` (ruling 30), shared helpers imported from
 * `bridge-studio-session-helpers.ts`, and the host's spawn/serve surface
 * injected.
 *
 * A PRE-EXISTING FINDING CARRIED ACROSS, NOT FIXED HERE. The `/demo/` and
 * `/fragment/` routes' containment is still LEXICAL only — they compare a built
 * path against a built base rather than resolving each untrusted segment
 * through a guard, which is the self-defeating idiom
 * `docs/reference/request-path-sinks.md` already records against bd `forge-28o`.
 * The `/generation/` route beside them IS fully guarded. A carve is the wrong
 * place to change a guard: fixing it here would hide a security change inside a
 * move. It is recorded on the way past, with its row unchanged.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

import { allowedOrigin, sanitizeError, sendJson, SAFE_ID_RE, MAX_SKILL_ID_LENGTH } from '@forge/kernel';
import { guardedFile, guardedReadDir, guardedReadFile, guardedWriteFile, resolveGuardedPath } from '@forge/kernel/path-guard.ts';

import { DEMO_HTML_REL_PATH, GENERATIONS_DIRNAME, type DemoBuilderStatus } from './demo-builder-runner.ts';
import { guardedReadSessionStatus, guardedWriteSessionStatus } from './interactive-session.ts';
import { LEGACY_SESSION_TERMINAL_PHASES } from './session-phases.ts';
import { listDemoSessions } from './bridge-studio-session-index.ts';
import { safeReadFileInSession } from './studio/session-transcript.ts';
import {
  deriveRowLifecycle,
  invalidGenerationProjectReason,
  findSessionKindDescriptorSafe,
  newArchitectSessionId,
  rejectStartProjectRepoPath,
  resolveKickoffModelTier,
  sessionStaleMs,
  unknownProjectReason,
  type SessionHostSurface,
  type SessionRootsContext,
} from './bridge-studio-session-helpers.ts';

/** What the demo arms read off the bridge. */
export type DemoRouteContext = SessionRootsContext & {
  readonly readBody: () => Promise<unknown>;
  readonly ensureSessionTail: (kind: string, sessionId: string) => void;
  readonly broadcastDemoChanged: () => void;
} & SessionHostSurface;

/** The host's `MAX_GENERATION_SESSION_ID_LENGTH`, preserved as an alias rather
 *  than substituted. It aliases `MAX_SKILL_ID_LENGTH` (100), NOT
 *  `MAX_EXACT_ID_LENGTH` (128) — I substituted the wrong one first, and the two
 *  differ, so the move would have loosened a validation limit by 28 characters
 *  with every test still green. A carve changes no guard. */
const MAX_GENERATION_SESSION_ID_LENGTH = MAX_SKILL_ID_LENGTH;

export async function handleDemoRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: DemoRouteContext,
  url: string,
  method: string,
): Promise<boolean> {
  const origin = allowedOrigin(req);
  // GET /api/demo-builder/sessions — list every session with its current state.
  if (method === 'GET' && url === '/api/demo-builder/sessions') {
    const statuses = listDemoSessions(ctx.projectsRoot);
    // Live-tail each non-terminal session's log so the dedicated screen's hex
    // streams tool bursts (idempotent; no-ops if the log doesn't exist yet).
    for (const s of statuses) {
      if (!LEGACY_SESSION_TERMINAL_PHASES.demo.has(s.phase)) ctx.ensureSessionTail(ctx.spawnAgentSpecs['demo-builder'].logPrefix, s.session_id);
    }
    // W8-A2 (ON-7 defect 1) — see the architect route's identical comment.
    // The registry id for this kind is 'demo' (SPAWN_AGENT_SPECS's own key
    // is 'demo-builder', but its logPrefix — and the session-kinds.yaml id —
    // is 'demo'; see the top-of-file note at collectStudioSessionIndexRows).
    const demoDescriptor = findSessionKindDescriptorSafe(ctx.forgeRoot, 'demo');
    const sessions = statuses.map((s) => {
      // SEC-04 (bd forge-ebj) — `s.project_repo_path` is UNTRUSTED at read time
      // (it is status.json content, git-plantable, not a routing input). These
      // probes existsSync/readdirSync THROUGH it: an out-of-root value was an
      // existence oracle AND the fragments readdir ENUMERATED (disclosed) an
      // out-of-root directory's filenames. Contain the value first
      // (isContainedProjectRepoPath — the same guard the serve routes apply),
      // THEN route each leaf through the per-segment identity guard (leaf
      // included) with that now-contained value as the root. A forged
      // out-of-root path yields no demoUrl/fragments (safe default), never a
      // disclosure. DEMO.html lives in the PROJECT REPO under .forge/demo/.
      const repoContained =
        typeof s.project_repo_path === 'string' &&
        ctx.isContainedProjectRepoPath(s.project_repo_path, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot });
      const demoUrl = repoContained && guardedFile(s.project_repo_path, DEMO_HTML_REL_PATH.split('/'), 'read') !== null
        ? `/api/demo-builder/demo/${encodeURIComponent(s.project)}/${encodeURIComponent(s.session_id)}`
        : null;
      // Per-element rendered fragments present in the repo (element ids) — so the
      // operator can view each part's output independently.
      const fragmentNames = repoContained ? guardedReadDir(s.project_repo_path, ['.forge', 'demo', 'fragments']) : null;
      const fragments: string[] = (fragmentNames ?? [])
        .filter((f) => f.endsWith('.html'))
        .map((f) => f.slice(0, -'.html'.length));

      // W8-A2 (ON-7 defect 1) — see the architect route: the derived lifecycle,
      // and `staleMs` from the runner's own heartbeat/`updated_at`, never the
      // status file's mtime. NOTE the on-disk log dir for this kind is
      // `_demo-<sid>`, not `_demo-builder-<sid>`.
      const rowLifecycle = demoDescriptor
        ? deriveRowLifecycle(ctx, demoDescriptor, s.phase, s.project, s.session_id).lifecycle
        : null;
      const staleMs = sessionStaleMs(ctx, 'demo', s.session_id, s.updated_at, rowLifecycle);

      return {
        sessionId: s.session_id,
        project: s.project,
        projectRepoPath: s.project_repo_path,
        phase: s.phase,
        mode: s.mode ?? 'create',
        targetElement: s.targetElement ?? null,
        iteration: s.iteration,
        prompt: s.prompt,
        demoUrl,
        fragments,
        hasLockedDemo: repoContained && guardedFile(s.project_repo_path, ['.forge', 'demo', 'demo.lock.json'], 'read') !== null,
        staleMs,
        ...(rowLifecycle ? { lifecycle: rowLifecycle } : {}),
      };
    });
    sendJson(res, 200, { sessions }, origin);
    return true;
  }

  // GET /api/demo-builder/demo/<project>/<sid> — serve the session's DEMO.html
  // from the PROJECT REPO (.forge/demo/DEMO.html), with a path-escape guard.
  // Reads status.json to resolve project_repo_path. (Unlike the instructions
  // /file route, the served file lives in the repo, NOT the session dir.)
  if (method === 'GET' && url.startsWith('/api/demo-builder/demo/')) {
    const rest = url.slice('/api/demo-builder/demo/'.length).split('/').map(decodeURIComponent);
    const [project, sessionId] = rest;
    if (!project || !sessionId) {
      sendJson(res, 400, { error: 'expected /api/demo-builder/demo/<project>/<sid>' }, origin);
      return true;
    }
    // SEC-03 WI-6, Half A — route through the SHIPPED choke point
    // (`resolveDemoSessionDir`, ~1477) instead of calling `demoSessionDir`
    // raw. `split('/')` above runs on the RAW url BEFORE `decodeURIComponent`,
    // so a %2F-smuggled ".." survives the split and only becomes a "/"
    // afterwards — invisible to the truthiness check that used to be the
    // only gate here. `resolveDemoSessionDir` validates `project`/`sessionId`
    // by charset (never reaching `join`) AND proves real realpath
    // containment inside THIS project's own resolved dir.
    const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, project, sessionId);
    if (!dirOutcome.ok) {
      sendJson(res, 400, { error: dirOutcome.reason }, origin);
      return true;
    }
    // SEC-04 (bd forge-ebj) — the status.json READ goes through the guarded
    // leaf sibling (leaf included) so a symlinked status leaf inside the
    // resolved-contained session dir is refused, not followed.
    const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, [project, '_demo', sessionId]);
    if (!status) {
      sendJson(res, 404, { error: 'session not found', project, sessionId }, origin);
      return true;
    }
    // SEC-03 WI-6, Half B — `status.project_repo_path` is untrusted at READ
    // time (status.json content, not routing input; a forged file on disk
    // reaches here exactly the way a forged session dir did for Half A). The
    // OLD check here built BOTH `base` and `requested` from this SAME
    // untrusted value, so `requested.startsWith(base)` was true BY
    // CONSTRUCTION for every possible value — a guard that cannot fail is
    // not a guard, so it is deleted here rather than kept as decoration.
    // Validate the value itself instead, with the SHIPPED
    // `isContainedProjectRepoPath` (cli/manifest-path-guard.ts) — the same
    // guard `invalidProjectRepoPath` (~1610) applies to `project_repo_path`
    // on every `/start` route. (`invalidProjectRepoPath` itself is not
    // reused directly: its `candidate === ''` early-return means "absent,
    // use the caller's default" — correct for a request body at WRITE time,
    // wrong here, where the field is mandatory and already persisted; a
    // forged empty string must be REJECTED, not silently treated as fine.)
    if (typeof status.project_repo_path !== 'string' || !ctx.isContainedProjectRepoPath(status.project_repo_path, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot })) {
      sendJson(res, 400, { error: 'session data invalid: project_repo_path is not a valid project directory' }, origin);
      return true;
    }
    // SEC-04 (bd forge-ebj) — project_repo_path is proven contained above, but
    // the DEMO.html LEAF beneath it could still be a symlink/hardlink out of
    // root; route the whole leaf path (fixed DEMO_HTML_REL_PATH segments under
    // the now-contained repo root) through the per-segment identity + nlink
    // guard so a symlinked DEMO.html is refused, not followed.
    const demoBody = guardedReadFile(status.project_repo_path, DEMO_HTML_REL_PATH.split('/'));
    if (demoBody === null) {
      sendJson(res, 404, { error: 'DEMO.html not found', project, sessionId }, origin);
      return true;
    }
    try {
      res.writeHead(200, ctx.servedFileHeaders('DEMO.html', origin));
      res.end(demoBody);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // GET /api/demo-builder/fragment/<project>/<sid>/<element> — serve one element's
  // rendered HTML fragment (<repo>/.forge/demo/fragments/<element>.html), so the
  // operator can view a single part's output independently. Path-escape guarded.
  if (method === 'GET' && url.startsWith('/api/demo-builder/fragment/')) {
    const rest = url.slice('/api/demo-builder/fragment/'.length).split('/').map(decodeURIComponent);
    const [project, sessionId, element] = rest;
    if (!project || !sessionId || !element) {
      sendJson(res, 400, { error: 'expected /api/demo-builder/fragment/<project>/<sid>/<element>' }, origin);
      return true;
    }
    // SEC-03 WI-6, Half A — see the /demo/ route above for the full
    // rationale; identical fix, same choke point.
    const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, project, sessionId);
    if (!dirOutcome.ok) {
      sendJson(res, 400, { error: dirOutcome.reason }, origin);
      return true;
    }
    // SEC-04 (bd forge-ebj) — status.json READ through the guarded leaf
    // sibling (leaf-symlink close).
    const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, [project, '_demo', sessionId]);
    if (!status) {
      sendJson(res, 404, { error: 'session not found', project, sessionId }, origin);
      return true;
    }
    // SEC-03 WI-6, Half B (symmetry) — this route's base/requested check
    // below is ALSO built from `status.project_repo_path` on both sides, so
    // it is exactly as tautological in `project_repo_path` as the /demo/
    // route's deleted check was — the AT-13 non-regression test measures
    // only that the `element` component (folded into `requested` alone,
    // fully `join()`-normalised) is already safe; it says nothing about
    // `project_repo_path` itself. Close the same hole here rather than leave
    // the twin route exposed. `element`'s own handling below is UNCHANGED.
    if (typeof status.project_repo_path !== 'string' || !ctx.isContainedProjectRepoPath(status.project_repo_path, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot })) {
      sendJson(res, 400, { error: 'session data invalid: project_repo_path is not a valid project directory' }, origin);
      return true;
    }
    // The lexical `startsWith(base)` still guards the `element` component's own
    // `..`/escape shape (AT-13 non-regression, 400). SEC-04 (bd forge-ebj)
    // additionally routes the actual READ through the per-segment identity +
    // nlink guard (project_repo_path is proven contained above ⇒ a trusted
    // root here), so a symlinked/hardlinked fragment LEAF inside the real
    // fragments dir is refused (⇒ null ⇒ 404), never followed out of root.
    const base = join(status.project_repo_path, '.forge', 'demo', 'fragments') + sep;
    const requested = join(status.project_repo_path, '.forge', 'demo', 'fragments', `${element}.html`);
    if (!requested.startsWith(base)) {
      sendJson(res, 400, { error: 'path escape rejected' }, origin);
      return true;
    }
    // A fragment is just the element's `<section>` slice. Wrap it in the Forge
    // demo base stylesheet so the component view is a styled slice of the full
    // demo (the composer inlines the same CSS into DEMO.html). If the fragment
    // is already a full HTML doc, serve it untouched.
    const raw = guardedReadFile(status.project_repo_path, ['.forge', 'demo', 'fragments', ...`${element}.html`.split('/')]);
    if (raw === null) {
      sendJson(res, 404, { error: 'fragment not found', project, sessionId, element }, origin);
      return true;
    }
    try {
      const isFullDoc = /^\s*<!doctype|^\s*<html[\s>]/i.test(raw);
      const out = isFullDoc ? raw : wrapDemoFragment(ctx.forgeRoot, element, raw);
      res.writeHead(200, ctx.servedFileHeaders(`${element}.html`, origin));
      res.end(out);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename> — serve
  // one R4-16 generation-snapshot file out of <sessionDir>/generations/<n>/.
  // ALL FOUR path segments are validated before any fs call: `project`/
  // `sessionId` go through `resolveDemoSessionDir` above — the ONE choke
  // point every demo-builder route (this GET route AND the five POST routes
  // below) resolves a session dir through, closing both the ".."-shaped
  // escape (pin 2, Finding A) AND a symlinked session dir whose NAME
  // legitimately passes SAFE_ID_RE (pin 3, Finding B); `n`/`filename`
  // against GENERATION_NUMBER_RE/GENERATION_FILENAME_RE, structurally
  // forbidding `..`, `/`, an absolute path, or a bare `.`/`..`. The final
  // read then goes through `safeReadFileInSession` (session-transcript.ts's
  // realpath choke point, D11) as belt-and-braces against a symlink escape
  // from WITHIN the already-validated session dir (e.g. one generation-
  // snapshot FILE symlinked out, rather than the session dir itself).
  //
  // The sibling /demo/ and /fragment/ GET routes above remain OUT OF SCOPE
  // for this round: they still validate `project`/`sessionId` for
  // non-emptiness only and rely solely on a lexical `startsWith(base)` check
  // on the resolved file path — a real gap, filed as an evidenced follow-up
  // rather than fixed here (a containment change for those two wants its own
  // attack round). Every demo-builder POST route (start/brief/feedback/lock/
  // abandon), by contrast, IS now covered — see their call sites below.
  const generationMatch = url.match(/^\/api\/demo-builder\/generation\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (method === 'GET' && generationMatch) {
    let project: string;
    let sessionId: string;
    let n: string;
    let filename: string;
    try {
      project = decodeURIComponent(generationMatch[1]);
      sessionId = decodeURIComponent(generationMatch[2]);
      n = decodeURIComponent(generationMatch[3]);
      filename = decodeURIComponent(generationMatch[4]);
    } catch {
      sendJson(res, 400, { error: 'invalid generation route — malformed URL encoding' }, origin);
      return true;
    }
    if (!GENERATION_NUMBER_RE.test(n)) {
      sendJson(res, 400, { error: `invalid generation number "${n}"` }, origin);
      return true;
    }
    if (!GENERATION_FILENAME_RE.test(filename)) {
      sendJson(res, 400, { error: `invalid filename "${filename}"` }, origin);
      return true;
    }
    const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, project, sessionId);
    if (!dirOutcome.ok) {
      sendJson(res, 400, { error: dirOutcome.reason }, origin);
      return true;
    }
    const fileBody = safeReadFileInSession(dirOutcome.dir, join(GENERATIONS_DIRNAME, n, filename));
    if (fileBody === null) {
      sendJson(res, 404, { error: 'generation snapshot file not found', project, sessionId, generation: n, filename }, origin);
      return true;
    }
    res.writeHead(200, ctx.servedFileHeaders(filename, origin));
    res.end(fileBody);
    return true;
  }

  // GET /api/demo-builder/history/<project> — list previously-locked demos
  // (snapshots under <repo>/.forge/demo/history/<id>/), newest first.
  const histListMatch = url.match(/^\/api\/demo-builder\/history\/([^/]+)$/);
  if (method === 'GET' && histListMatch) {
    const project = decodeURIComponent(histListMatch[1]);
    // SEC-04 (bd forge-ebj) — `project` was folded raw into
    // `join(projectsRoot, project, '.forge','demo','history')` and enumerated
    // with NO guard: a `%2F`-smuggled `../..` project enumerated an
    // out-of-root history tree, and an in-root project whose `.forge/demo/
    // history` is a git-plantable SYMLINK was followed out of root by
    // readdirSync. Gate the request-derived `project` (its OWN segment under
    // the trusted projectsRoot) first — a traversed/symlinked project is a 400
    // — then route the history readdir + each per-id leaf through the guard so
    // a symlinked history dir (or a symlinked id/leaf beneath it) is refused,
    // never followed. A legit project with no history yet reads as empty.
    const projGuard = resolveGuardedPath(ctx.projectsRoot, [project]);
    if (!projGuard.ok) {
      sendJson(res, 400, { error: 'invalid project' }, origin);
      return true;
    }
    const histSegs = [project, '.forge', 'demo', 'history'];
    const entries: Array<Record<string, unknown>> = [];
    const ids = guardedReadDir(ctx.projectsRoot, histSegs) ?? [];
    for (const id of ids) {
      if (guardedFile(ctx.projectsRoot, [...histSegs, id, 'DEMO.html'], 'read') === null) continue;
      const metaRaw = guardedReadFile(ctx.projectsRoot, [...histSegs, id, 'meta.json']);
      const meta = (metaRaw !== null ? ctx.safeParseJson<Record<string, unknown>>(metaRaw) : null) ?? {};
      entries.push({
        id,
        demoUrl: `/api/demo-builder/history/${encodeURIComponent(project)}/${encodeURIComponent(id)}`,
        lockedAt: typeof meta.locked_at === 'string' ? meta.locked_at : null,
        prompt: typeof meta.prompt === 'string' ? meta.prompt : '',
        iterations: typeof meta.iterations === 'number' ? meta.iterations : null,
      });
    }
    entries.sort((a, b) => String(b.lockedAt ?? '').localeCompare(String(a.lockedAt ?? '')));
    sendJson(res, 200, { history: entries }, origin);
    return true;
  }

  // GET /api/demo-builder/history/<project>/<id> — serve a snapshotted DEMO.html.
  const histServeMatch = url.match(/^\/api\/demo-builder\/history\/([^/]+)\/([^/]+)$/);
  if (method === 'GET' && histServeMatch) {
    const project = decodeURIComponent(histServeMatch[1]);
    const id = decodeURIComponent(histServeMatch[2]);
    // SEC-04 (bd forge-ebj) — the old `requested.startsWith(base)` was
    // self-defeating: `base` and `requested` were BOTH built from the same
    // untrusted `project`, so a `../..` traversal sat in BOTH sides and the
    // check was tautological; and a symlinked `.forge/demo/history` dir is
    // lexically inside `base` yet readFileSync followed it out of root. Route
    // the WHOLE path (project AND id each as their OWN segment under the
    // trusted projectsRoot, DEMO.html leaf included) through the per-segment
    // identity guard, which the lexical prefix check structurally cannot do. A
    // rejected/absent path both collapse to 404 (no existence oracle).
    const demoHtml = guardedReadFile(ctx.projectsRoot, [project, '.forge', 'demo', 'history', id, 'DEMO.html']);
    if (demoHtml === null) {
      sendJson(res, 404, { error: 'demo not found', project, id }, origin);
      return true;
    }
    try {
      res.writeHead(200, ctx.servedFileHeaders('DEMO.html', origin));
      res.end(demoHtml);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
    return true;
  }


  // R4-16 round 2 (pin 3, Finding A) — every route below resolves its
  // session dir through `resolveDemoSessionDir`, the ONE choke point (see
  // its own header comment, above the GET generation route). Each rejects
  // with a 400 naming the offending value BEFORE any read, write,
  // `mkdirSync`, or spawn.
  if (method === 'POST' && url === '/api/demo-builder/start') {
    try {
      const body = (await ctx.readBody()) as { project?: string; mode?: 'create' | 'update'; projectRepoPath?: string; targetElement?: string; modelTier?: unknown };
      if (!body.project) {
        sendJson(res, 400, { error: 'project is required' }, origin);
        return true;
      }
      // W7-B6 (sessions-kinds-02): roster check — no phantom project dirs.
      const unknownDemoProject = unknownProjectReason(ctx, body.project);
      if (unknownDemoProject !== null) {
        sendJson(res, 404, { error: unknownDemoProject }, origin);
        return true;
      }
      // SEC-02 (forge-d1f) — reject BEFORE any mkdirSync/existsSync-through
      // read/status write. See invalidProjectRepoPath's header for the defect.
      const badRepoPath = rejectStartProjectRepoPath(body, { forgeRoot: ctx.forgeRoot, projectsRoot: ctx.projectsRoot }, ctx.isContainedProjectRepoPath);
      if (badRepoPath !== null) {
        sendJson(res, 400, { error: `projectRepoPath is not a valid project directory: ${badRepoPath}` }, origin);
        return true;
      }
      // ADR-043 §3 amendment (wave-6) — validated EARLY, against the real
      // demo-builder SKILL.md envelope.
      const modelTierResult = resolveKickoffModelTier('demo-builder', body.modelTier);
      if (!modelTierResult.ok) {
        sendJson(res, 400, { error: modelTierResult.error }, origin);
        return true;
      }
      // The CREATE case — `dirOutcome.dir` does not exist on disk yet;
      // `resolveDemoSessionDir` proves its closest EXISTING ancestor is
      // contained (see its header) rather than false-rejecting a brand new
      // session.
      const sessionId = newArchitectSessionId();
      const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, body.project, sessionId);
      if (!dirOutcome.ok) {
        sendJson(res, 400, { error: dirOutcome.reason }, origin);
        return true;
      }
      // dirOutcome.ok proved the DIR contained; the status.json WRITE below
      // goes through the guarded leaf sibling (leaf included).
      // forge-4vt — the `projectRepoPath || join(projectsRoot, project)`
      // fallback below reaches the demo.lock.json READ a few lines down with a
      // repoPath folded from the untrusted `body.project`. `resolveDemoSessionDir`
      // above DOES reject an out-of-root project today, but that containment is
      // an accident of SOURCE ORDER — it guards the session DIR, not this
      // independently re-derived repoPath, so a refactor that reorders or drops
      // it would silently reopen the read. Route `body.project` through the
      // SAME resolveGuardedPath choke point the sibling /start routes use,
      // BEFORE the read, so containment is structural (the guard's own output)
      // rather than order-dependent.
      let repoPath: string;
      if (body.projectRepoPath) {
        repoPath = body.projectRepoPath;
      } else {
        const guardedProject = resolveGuardedPath(ctx.projectsRoot, [body.project]);
        if (!guardedProject.ok) {
          sendJson(res, 400, { error: 'invalid project' }, origin);
          return true;
        }
        repoPath = guardedProject.realPath;
      }
      // Default the mode by whether a locked demo already exists.
      const mode: 'create' | 'update' =
        body.mode ?? (existsSync(join(repoPath, '.forge', 'demo', 'demo.lock.json')) ? 'update' : 'create');
      // SEC-04 (bd forge-ebj) — status.json WRITE through the guarded leaf
      // sibling (leaf included; mkdirs the parent, refuses a symlinked leaf).
      if (guardedWriteSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, [body.project, '_demo', sessionId], {
        session_id: sessionId,
        project: body.project,
        project_repo_path: repoPath,
        phase: 'briefing',
        mode,
        // Optional per-element iteration target (a demo-element kind id).
        ...(typeof body.targetElement === 'string' && body.targetElement ? { targetElement: body.targetElement } : {}),
        iteration: 1,
        prompt: '',
        updated_at: new Date().toISOString(),
        ...(modelTierResult.tier ? { modelTier: modelTierResult.tier } : {}),
      }) === null) {
        sendJson(res, 400, { error: 'invalid session path' }, origin);
        return true;
      }
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, sessionId, mode }, origin);
    } catch (err) {
      // sanitizeError, not String(err) — the same helper 13 sibling routes in
      // this file already use. A genuine fs error on the status write (EACCES,
      // ENOSPC) otherwise echoes an absolute filesystem path into the response.
      sendJson(res, 500, { error: sanitizeError(err) }, origin);
    }
    return true;
  }

  // POST /api/demo-builder/brief {project, sessionId, brief} — record the
  // operator's look-and-feel / change-notes and kick off the agent
  // (briefing → generating).
  if (method === 'POST' && url === '/api/demo-builder/brief') {
    try {
      const body = (await ctx.readBody()) as { project?: string; sessionId?: string; brief?: string; targetElement?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      if (!dirOutcome.ok) {
        sendJson(res, 400, { error: dirOutcome.reason }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — dirOutcome.ok above proved the DIR contained;
      // route each leaf (prompt.md, status.json) through the guarded leaf
      // siblings so the leaf itself is contained too (leaf-symlink close).
      const dirSegs = [body.project, '_demo', body.sessionId];
      const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      const brief = body.brief ?? '';
      // `targetElement` narrows the turn to one demo element (per-element iteration);
      // omit/empty to compose the full demo.
      const targetElement = typeof body.targetElement === 'string' && body.targetElement ? body.targetElement : status.targetElement;
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'prompt.md'], brief) === null ||
        guardedWriteSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs, {
          ...status, phase: 'generating', iteration: 1, prompt: brief,
          ...(targetElement ? { targetElement } : {}),
        }) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'demo-builder', body.project, body.sessionId);
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/demo-builder/brief', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/demo-builder/feedback {project, sessionId, feedback} — record the
  // operator's feedback + re-generate (iteration + 1).
  if (method === 'POST' && url === '/api/demo-builder/feedback') {
    try {
      const body = (await ctx.readBody()) as { project?: string; sessionId?: string; feedback?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      if (!dirOutcome.ok) {
        sendJson(res, 400, { error: dirOutcome.reason }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — route each leaf (feedback.md, status.json)
      // through the guarded leaf siblings (leaf-symlink close).
      const dirSegs = [body.project, '_demo', body.sessionId];
      const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      if (
        guardedWriteFile(ctx.projectsRoot, [...dirSegs, 'feedback.md'], body.feedback ?? '') === null ||
        guardedWriteSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'generating', iteration: status.iteration + 1 }) === null
      ) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'demo-builder', body.project, body.sessionId);
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/demo-builder/feedback', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/demo-builder/lock {project, sessionId, generation?} — lock the
  // current demo in. R4-16: an optional `generation` names which snapshot to
  // lock — structurally validated (integer ≥ 1) BEFORE any write, so a
  // rejected request never mutates status.json.
  if (method === 'POST' && url === '/api/demo-builder/lock') {
    try {
      const body = (await ctx.readBody()) as { project?: string; sessionId?: string; generation?: unknown };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      if (!dirOutcome.ok) {
        sendJson(res, 400, { error: dirOutcome.reason }, origin);
        return true;
      }
      const hasGeneration = Object.prototype.hasOwnProperty.call(body, 'generation') && body.generation !== undefined;
      if (hasGeneration && !(typeof body.generation === 'number' && Number.isInteger(body.generation) && body.generation >= 1)) {
        sendJson(res, 400, { error: `generation must be an integer >= 1, got ${JSON.stringify(body.generation)}` }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — status.json read+write through the guarded leaf
      // siblings (leaf-symlink close).
      const dirSegs = [body.project, '_demo', body.sessionId];
      const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      if (guardedWriteSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs, {
        ...status,
        phase: 'locking',
        ...(hasGeneration ? { selectedGeneration: body.generation as number } : {}),
      }) === null) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'demo-builder', body.project, body.sessionId);
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/demo-builder/lock', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }

  // POST /api/demo-builder/abandon {project, sessionId} — abandon the session.
  if (method === 'POST' && url === '/api/demo-builder/abandon') {
    try {
      const body = (await ctx.readBody()) as { project?: string; sessionId?: string };
      if (!body.project || !body.sessionId) {
        sendJson(res, 400, { error: 'project and sessionId are required' }, origin);
        return true;
      }
      const dirOutcome = resolveDemoSessionDir(ctx.projectsRoot, body.project, body.sessionId);
      if (!dirOutcome.ok) {
        sendJson(res, 400, { error: dirOutcome.reason }, origin);
        return true;
      }
      // SEC-04 (bd forge-ebj) — status.json read+write through the guarded leaf
      // siblings (leaf-symlink close).
      const dirSegs = [body.project, '_demo', body.sessionId];
      const status = guardedReadSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs);
      if (!status) {
        sendJson(res, 404, { error: 'session not found', sessionId: body.sessionId }, origin);
        return true;
      }
      if (guardedWriteSessionStatus<DemoBuilderStatus>(ctx.projectsRoot, dirSegs, { ...status, phase: 'abandoned' }) === null) {
        sendJson(res, 400, { error: 'invalid session path', sessionId: body.sessionId }, origin);
        return true;
      }
      ctx.spawnAgentTurn(ctx.forgeRoot, 'demo-builder', body.project, body.sessionId);
      ctx.broadcastDemoChanged();
      sendJson(res, 200, { ok: true, ...ctx.dryBridgeAgentTurnMarker(ctx.logsRoot, '/api/demo-builder/abandon', body.sessionId) }, origin);
    } catch (err) {
      sendJson(res, 500, { error: String(err) }, origin);
    }
    return true;
  }  return false;
}

/** R4-16 — GET /api/demo-builder/generation/<project>/<sid>/<n>/<filename>
 *  path segments. `n` is a bounded digit string (mirrors a generation number,
 *  never negative/decimal). `filename` structurally forbids `..`, `/`, and an
 *  absolute path — a malicious segment can never even reach the realpath
 *  choke point (`safeReadFileInSession`), which is this route's actual
 *  containment guard (D11). The negative lookahead rejects a filename that is
 *  EXACTLY "." or ".." — without it, correctness for those two values would
 *  depend on `n` happening to be a digit string (so the joined
 *  `generations/<n>/.` or `generations/<n>/..` merely resolves to a
 *  directory and 404s for an unrelated reason) rather than the filename
 *  actually being rejected as a structural violation (pin 2, Finding E). */
const GENERATION_NUMBER_RE = /^[0-9]{1,6}$/;

const GENERATION_FILENAME_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

function resolveDemoSessionDir(projectsRoot: string, project: string, sessionId: string): DemoSessionDirOutcome {
  const projectReason = invalidGenerationProjectReason(project);
  if (projectReason) return { ok: false, reason: projectReason };
  const sessionIdReason = invalidGenerationSessionIdReason(sessionId);
  if (sessionIdReason) return { ok: false, reason: sessionIdReason };

  // SEC-04 (bd forge-ebj) — MIGRATED off the bespoke realpath baseline onto the
  // shared per-segment IDENTITY guard. `project` now arrives as its OWN element
  // of `segments[]`, NEVER folded into a realpath baseline: the previous check
  // realpath'd `join(projectsRoot, project)` FIRST and compared against THAT,
  // so when `project` itself was a SYMLINK the baseline WAS the escaped
  // location and the `startsWith` was tautological (root-folding — verbatim
  // from the adversarial-containment-review catalogue; the charset shape was
  // already guarded by the two reason-checks above, but the symlinked-first-
  // segment shape was not). `resolveGuardedPath` walks project → `_demo` →
  // sessionId, identity-checking each; the session dir may not exist yet (the
  // `/start` create case), which it handles by walking to the deepest existing
  // ancestor and reassembling the literal tail. A missing dir and an escaping
  // symlink both collapse to a single generic reason (no oracle).
  const guarded = resolveGuardedPath(projectsRoot, [project, '_demo', sessionId]);
  if (!guarded.ok) {
    return { ok: false, reason: `sessionId "${sessionId}" for project "${project}" resolves outside the project directory` };
  }
  return { ok: true, dir: guarded.realPath };
}

/** Wrap one element fragment in a self-contained, Forge-styled HTML doc so a single
 *  component renders as a styled slice of the full demo. */
function wrapDemoFragment(forgeRoot: string, element: string, fragment: string): string {
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>demo · ${element}</title>`,
    `<style>${readForgeDemoCss(forgeRoot)}</style>`,
    '</head><body>',
    fragment,
    '</body></html>',
  ].join('\n');
}




function invalidGenerationSessionIdReason(id: string): string | null {
  if (id.length > MAX_GENERATION_SESSION_ID_LENGTH) {
    return `invalid sessionId "${id.slice(0, 40)}…" — ${id.length} characters exceeds the ${MAX_GENERATION_SESSION_ID_LENGTH}-character length limit`;
  }
  if (!SAFE_ID_RE.test(id)) {
    return `invalid sessionId "${id}" — must match ${SAFE_ID_RE} (alphanumeric, "_", "-"; no "/", ".", "..", whitespace, or null bytes)`;
  }
  return null;
}

/**
 * R4-16 round 2 (pin 3, Findings A + B, both BLOCKER) — the ONE choke point
 * every demo-builder route uses to turn a CALLER-SUPPLIED `project` +
 * `sessionId` into a session dir. This is the ONLY place a caller-supplied
 * `project`/`sessionId` is turned into a session dir via `demoSessionDir(
 * join(ctx.projectsRoot, project), sessionId)` in the demo-builder handler
 * (SEC-03 WI-6 correction: `listDemoSessions` also calls `demoSessionDir`
 * directly, but on names it obtained itself from `readdirSync` — server-
 * enumerated, never caller-supplied — so it is deliberately outside this
 * function's coverage, not an oversight; the original wording overstated
 * this as the ONLY caller of `demoSessionDir` full stop, which is what let
 * the `/demo/` and `/fragment/` GET routes below be written straight past
 * this choke point undetected) — round 1 validated `project`/`sessionId` on
 * the GET generation route alone, which closed that one ROUTE, not the class: the
 * five sibling routes (start/brief/feedback/lock/abandon) built the exact
 * same unguarded call themselves and reached `readSessionStatus`/
 * `writeSessionStatus` (no containment of their own) with only a
 * non-emptiness check on the inputs (AT-43/44, reproduced live).
 *
 * Two escapes closed in one pass:
 *   - Finding A: `project`/`sessionId` are validated (length cap THEN
 *     charset, BEFORE any fs call) with the exact PROJECT_ID_RE/SAFE_ID_RE
 *     contract `cli/bridge-studio-sessions.ts` applies to its own session
 *     routes — reused via `invalidGenerationProjectReason`/
 *     `invalidGenerationSessionIdReason` above (round 1 already imported the
 *     regexes for the GET route; not re-declared here). A `".."`-shaped
 *     value is rejected structurally and never reaches a `path.join`.
 *   - Finding B: a NAME that legitimately PASSES SAFE_ID_RE can still be a
 *     symlink on disk pointing outside this project — validating the STRING
 *     says nothing about what the PATH resolves to. This function proves
 *     containment the same way `resolveSafeSessionDir`
 *     (cli/bridge-studio-sessions.ts) does: `realpathSync` the resolved
 *     directory and require it to land inside THIS project's own resolved
 *     dir (`realpathSync(<projectsRoot>/<project>)`) — scoped to the
 *     specific project, never a `projectsRoot`-wide check, which would still
 *     admit a symlink pointing into ANOTHER project's session dir (exactly
 *     R2-10's own AT-47 escape shape).
 *
 * CREATE case (`POST /start`'s session dir does not exist yet):
 * `realpathSync` on a path that doesn't exist throws ENOENT, which must be
 * treated as neither an escape NOR a false pass. This walks up from the
 * candidate session dir to the closest EXISTING ancestor (same idea as
 * `closestExistingAncestorContained`, orchestrator/demo-builder-runner.ts —
 * a different module boundary, so not imported across it: that helper is
 * private to the runner's lock-step restore, this one is private to the
 * bridge's route dispatch, and each needs a different reference boundary —
 * a project repo root there, this project's OWN dir here) and proves THAT
 * ancestor is contained instead. Any remaining not-yet-existing tail
 * segments are plain literal directory names — `sessionId` already passed
 * SAFE_ID_RE, which forbids "/" — so they cannot themselves introduce an
 * escape between the check and the caller's later `mkdirSync`.
 */
type DemoSessionDirOutcome =
  | { readonly ok: true; readonly dir: string }
  | { readonly ok: false; readonly reason: string };
/** Read the Forge demo base stylesheet (best-effort; a minimal dark fallback). */
function readForgeDemoCss(forgeRoot: string): string {
  try {
    return readFileSync(join(forgeRoot, 'studio', 'demo', 'forge-demo.css'), 'utf8');
  } catch {
    return 'body{background:#0a0e14;color:#e6edf3;font-family:system-ui,sans-serif;padding:2rem}';
  }
}