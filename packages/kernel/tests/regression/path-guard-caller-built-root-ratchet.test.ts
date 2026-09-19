/**
 * forge-8vfn.5.33 (P1) — the "caller-built root" class, ratcheted.
 *
 * THE DEFECT CLASS. `resolveGuardedPath(root, segments)` realpaths `root` and
 * trusts it with NO identity check (see `path-guard.ts`'s own CONTRACT
 * section). Every inner guard — the per-segment identity walk, the `nlink`
 * check — becomes a rubber stamp the moment a caller builds `root` itself
 * from request-influenced data instead of passing a fixed/config-derived
 * constant. The #289 incident: `cmdProjectReset` did `resolve(projectsDir, id)`
 * and handed THAT as `root`, with `projects/` planted as a symlink — every
 * inner guard reported `ok`. The fix for that ONE caller was to pass `id` as
 * a SEGMENT instead (`resolveGuardedPath(projectsDir, [id])`); the CLASS
 * remains open for every future caller, and with ~210 call sites in this
 * tree, auditing them by hand once does not stay true.
 *
 * WHAT THIS RATCHET DOES. Parses every production `.ts` file under
 * `packages/` and `apps/forge/` (directories literally named `tests` are
 * skipped, as are `*.test.ts`/`*.d.ts` files) and finds every call of an
 * exported `path-guard.ts` function whose FIRST parameter is named `root`
 * (discovered from `path-guard.ts` itself, not hardcoded, so a future guard
 * added there is covered with no edit here). A call is flagged when its root
 * argument is:
 *   (1) an inline expression built from a call (`resolve(...)`/`join(...)`/a
 *       helper), a template literal, or a `+` string concatenation, OR
 *   (2) a local `const`/`let` in the SAME function whose initializer is one
 *       of those same three shapes AND references one of that function's own
 *       PARAMETERS (single-hop only — see "cannot cover" below).
 * A bare identifier (a parameter passed straight through) or a plain
 * property access (`ctx.forgeRoot`) is NOT flagged — that is the canonical
 * safe shape this repo's own callers already use for a trusted root.
 *
 * WHY THIS IS DELIBERATELY COARSE, NOT A SEMANTIC CHECK. The live sweep
 * below (control D) flags 69 real call sites, and a manual read of every one
 * shows the SAME idiom throughout: a config-derived helper call
 * (`skillsDir(forgeRoot)`, `hooksDir(ctx.forgeRoot)`, `join(forgeRoot,
 * '_logs')`) rather than a request-derived id folded into the root. This
 * ratchet cannot, and does not try to, tell those apart — it flags the
 * STRUCTURAL shape (root built by an expression, not passed as a bare
 * verified value) and leaves the trust judgment to a human, same as the
 * `adversarial-containment-review` skill's own ratchet guidance: "enumerate
 * the sinks ... allowlist what an audit has classified, and fail when a new
 * unguarded sink appears." The baseline below IS that allowlist, and it can
 * only shrink (checked both ways — see "why a multiset, not a count").
 *
 * WHAT THIS PROVABLY CANNOT COVER (stated up front, per the skill's own
 * "explicitly NOT general static analysis" instruction):
 *   - Dataflow beyond one hop: `const projectsDir = resolveProjectsDir(forgeRoot,
 *     ...); resolveGuardedPath(projectsDir, [id])` is NOT flagged, because
 *     `projectsDir`'s initializer references the LOCAL `forgeRoot`, not a
 *     function parameter directly — even when `forgeRoot` is itself later
 *     shown to trace back to one. True multi-hop taint tracking is out of
 *     scope for a structural ratchet.
 *   - An aliased or namespace import (`import { resolveGuardedPath as guard }`,
 *     or `pathGuard.resolveGuardedPath(...)` under a name this scanner's
 *     callee-name match does not resolve back to the real export).
 *   - Promise-based / re-exported wrappers around a guard call.
 *   - A guard call gutted behind an unchanged call COUNT (this scanner reads
 *     the actual argument shape at each site, not a count, precisely to avoid
 *     that — see "why a multiset" below — but a wrapper that internally
 *     swaps `resolveGuardedPath` for an unguarded `fs` call is invisible to a
 *     scanner that only looks for calls BY THIS NAME).
 *
 * WHY A MULTISET OF (file, callee, argText) TRIPLES, NOT A COUNT
 * (`scripts/check-boundaries.mjs`'s own stated reason, restated here because
 * this ratchet follows the same convention): "a count lets one violation be
 * swapped for another without the gate noticing." Keying by the literal
 * source text of the flagged root expression means a genuine swap — one
 * expression replaced by a different one, even in the same file, even for
 * the same callee — changes the key and is caught, both as a NEW entry and
 * as a baseline entry that no longer reproduces (a stale entry fails until
 * the baseline is tightened, exactly like `check-boundaries.mjs`). Line
 * numbers are deliberately NOT part of the key: an unrelated edit earlier in
 * the same file must not fail this test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { resolveGuardedPath } from '../../path-guard.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PATH_GUARD_SOURCE = join(REPO_ROOT, 'packages/kernel/path-guard.ts');

// ---------------------------------------------------------------------------
// Guard-name discovery — read straight off path-guard.ts, never hardcoded.
// ---------------------------------------------------------------------------

function isExported(node: ts.Node): boolean {
  return (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function firstParamNamedRoot(params: readonly ts.ParameterDeclaration[]): boolean {
  const first = params[0];
  return !!(first && ts.isIdentifier(first.name) && first.name.text === 'root');
}

/** Every exported function (declared with `function`, or `const f = (root, ...) => ...`)
 *  in `path-guard.ts` whose first parameter is literally named `root`. */
function discoverRootTakingGuardNames(sourceText: string): ReadonlySet<string> {
  const sf = ts.createSourceFile(PATH_GUARD_SOURCE, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set<string>();
  sf.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name && isExported(node) && firstParamNamedRoot(node.parameters)) {
      names.add(node.name.text);
    } else if (ts.isVariableStatement(node) && isExported(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
          firstParamNamedRoot(decl.initializer.parameters)
        ) {
          names.add(decl.name.text);
        }
      }
    }
  });
  return names;
}

// ---------------------------------------------------------------------------
// The classifier.
// ---------------------------------------------------------------------------

export interface CallerBuiltRootHit {
  line: number;
  callee: string;
  argText: string;
  reason: string;
}

function findEnclosingFunction(
  node: ts.Node,
): ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) || ts.isFunctionExpression(cur) || ts.isArrowFunction(cur) || ts.isMethodDeclaration(cur)) {
      return cur;
    }
    cur = cur.parent;
  }
  return undefined;
}

function paramNamesOf(fn: ReturnType<typeof findEnclosingFunction>): ReadonlySet<string> {
  const names = new Set<string>();
  if (!fn) return names;
  for (const p of fn.parameters) if (ts.isIdentifier(p.name)) names.add(p.name.text);
  return names;
}

/** Does `node` contain, anywhere in its subtree, an Identifier reference to one of `names`? */
function referencesAnyParam(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (names.size === 0) return false;
  let found = false;
  function visit(n: ts.Node): void {
    if (found) return;
    if (ts.isIdentifier(n) && names.has(n.text)) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  }
  visit(node);
  return found;
}

/** The three "built inline" shapes this ratchet treats as caller-built. */
function callerBuiltShape(node: ts.Expression): string | undefined {
  if (ts.isCallExpression(node)) return 'call expression';
  if (ts.isTemplateExpression(node)) return 'template literal';
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return 'string concatenation';
  return undefined;
}

/** First `const`/`let` declaration of `name` found anywhere in `fn`'s body (single function scope only). */
function findLocalDecl(fn: ReturnType<typeof findEnclosingFunction>, name: string): ts.VariableDeclaration | undefined {
  let found: ts.VariableDeclaration | undefined;
  function visit(n: ts.Node): void {
    if (found) return;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      found = n;
      return;
    }
    n.forEachChild(visit);
  }
  if (fn?.body) visit(fn.body);
  return found;
}

/**
 * Scan one already-parsed source file for every call to a name in `guardNames`
 * whose first argument is a caller-built root, per the two-shape rule in this
 * file's header.
 */
export function scanSourceForCallerBuiltRoots(sf: ts.SourceFile, guardNames: ReadonlySet<string>): CallerBuiltRootHit[] {
  const hits: CallerBuiltRootHit[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      let calleeName: string | undefined;
      if (ts.isIdentifier(node.expression)) calleeName = node.expression.text;
      else if (ts.isPropertyAccessExpression(node.expression)) calleeName = node.expression.name.text;

      if (calleeName && guardNames.has(calleeName) && node.arguments.length > 0) {
        const arg = node.arguments[0]!;
        const fn = findEnclosingFunction(node);
        const params = paramNamesOf(fn);

        let reason: string | undefined;
        const shape = callerBuiltShape(arg);
        if (shape) {
          reason = `root arg is an inline ${shape}`;
        } else if (ts.isIdentifier(arg)) {
          const decl = findLocalDecl(fn, arg.text);
          if (decl?.initializer) {
            const declShape = callerBuiltShape(decl.initializer);
            if (declShape && referencesAnyParam(decl.initializer, params)) {
              reason = `root arg is local var "${arg.text}" initialized by an ${declShape} referencing a function parameter`;
            }
          }
        }

        if (reason) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          hits.push({ line: line + 1, callee: calleeName, argText: arg.getText(sf), reason });
        }
      }
    }
    node.forEachChild(visit);
  }

  visit(sf);
  return hits;
}

// ---------------------------------------------------------------------------
// Production-file discovery: packages/ and apps/forge/, tests+fixtures excluded.
// ---------------------------------------------------------------------------

function collectProductionTsFiles(startDir: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'tests') continue;
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) out.push(p);
    }
  }
  walk(startDir);
  return out;
}

function scanLiveTree(guardNames: ReadonlySet<string>): string[] {
  const files = [
    ...collectProductionTsFiles(join(REPO_ROOT, 'packages')),
    ...collectProductionTsFiles(join(REPO_ROOT, 'apps/forge')),
  ];
  const keys: string[] = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file).split('\\').join('/'); // stable on any OS
    const src = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const hit of scanSourceForCallerBuiltRoots(sf, guardNames)) {
      keys.push(`${rel}::${hit.callee}::${hit.argText}`);
    }
  }
  return keys.sort();
}

// ---------------------------------------------------------------------------
// Meta-controls (a)/(b)/(c) — planted fixture sources, proving the scanner
// is not vacuous (mirrors `scripts/stories/no-unbound-names.test.ts`'s own
// "the scanner FINDS a planted defect" meta-door).
// ---------------------------------------------------------------------------

const FIXTURE_GUARD_NAMES: ReadonlySet<string> = new Set(['resolveGuardedPath']);

function scanFixture(source: string): CallerBuiltRootHit[] {
  const sf = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return scanSourceForCallerBuiltRoots(sf, FIXTURE_GUARD_NAMES);
}

test('control (a) [meta]: an inline caller-built root — resolveGuardedPath(resolve(projectsDir, id), [...]) — is flagged', () => {
  const hits = scanFixture(`
    function readAgent(projectsDir: string, id: string) {
      return resolveGuardedPath(resolve(projectsDir, id), ['x']);
    }
  `);
  assert.equal(hits.length, 1, `expected exactly one hit, got: ${JSON.stringify(hits)}`);
  assert.equal(hits[0]!.argText, 'resolve(projectsDir, id)');
  assert.match(hits[0]!.reason, /inline call expression/);
});

test('control (b) [meta]: the local-variable form — const r = resolve(base, id); resolveGuardedPath(r, [...]) — is flagged', () => {
  const hits = scanFixture(`
    function readAgent(base: string, id: string) {
      const r = resolve(base, id);
      return resolveGuardedPath(r, ['x']);
    }
  `);
  assert.equal(hits.length, 1, `expected exactly one hit, got: ${JSON.stringify(hits)}`);
  assert.equal(hits[0]!.argText, 'r');
  assert.match(hits[0]!.reason, /local var "r" initialized by an call expression referencing a function parameter/);
});

test('control (c) [meta]: a config-root call — resolveGuardedPath(ctx.forgeRoot, [id]) — is NOT flagged', () => {
  const hits = scanFixture(`
    function readAgent(ctx: { forgeRoot: string }, id: string) {
      return resolveGuardedPath(ctx.forgeRoot, [id]);
    }
  `);
  assert.deepEqual(hits, [], `expected no hits for the canonical safe shape, got: ${JSON.stringify(hits)}`);
});

test('control (c2) [meta, non-regression]: a bare parameter passed straight through — resolveGuardedPath(root, [id]) — is NOT flagged', () => {
  const hits = scanFixture(`
    function readAgent(root: string, id: string) {
      return resolveGuardedPath(root, [id]);
    }
  `);
  assert.deepEqual(hits, [], `expected no hits for a bare trusted parameter, got: ${JSON.stringify(hits)}`);
});

test('control (c3) [meta, non-regression]: a local var whose initializer references only ANOTHER LOCAL (not a parameter) is NOT flagged — single-hop only, by design', () => {
  const hits = scanFixture(`
    function readAgent(ctx: { forgeRoot: string }) {
      const forgeRoot = resolve(ctx.forgeRoot);
      const projectsDir = resolveProjectsDir(forgeRoot);
      return resolveGuardedPath(projectsDir, ['id']);
    }
  `);
  assert.deepEqual(
    hits,
    [],
    `single-hop dataflow is an explicitly disclosed limitation, not a bug — got: ${JSON.stringify(hits)}`,
  );
});

// ---------------------------------------------------------------------------
// Control (d): the live tree, baseline-parity ratchet.
// ---------------------------------------------------------------------------

/**
 * The FROZEN set of every caller-built-root hit in `packages/` + `apps/forge/`
 * at the time this ratchet was authored (forge-8vfn.5.33), one entry per
 * occurrence (a file+callee+argText combination repeated N times in the live
 * tree appears N times here — see the header's "why a multiset" note). This
 * baseline may only SHRINK: fixing one of these sites and not updating this
 * array fails the test (a stale entry), same as a genuinely new violation
 * appearing fails it. Every entry below was manually read at authoring time —
 * all 69 are the config-derived-helper idiom (`skillsDir(forgeRoot)`,
 * `hooksDir(ctx.forgeRoot)`, `join(forgeRoot, '_logs')`, or a local var built
 * from one), not a request-derived id folded into a root; T2 owns the final
 * call on any of these, per this file's header.
 */
const BASELINE_CALLER_BUILT_ROOT_KEYS: readonly string[] = [
  "apps/forge/bridge-studio-writes.ts::guardedFile::skillsRoot",
  "apps/forge/bridge-studio-writes.ts::guardedWriteFile::skillsRoot",
  "apps/forge/bridge-studio-writes.ts::resolveGuardedPath::flowsBase",
  "apps/forge/bridge-studio-writes.ts::resolveGuardedPath::flowsBase",
  "apps/forge/bridge-studio-writes.ts::resolveGuardedPath::resolve(ctx.forgeRoot, 'studio', 'flows')",
  "apps/forge/bridge-studio-writes.ts::resolveGuardedPath::toSkillsDir(forgeRoot)",
  "apps/forge/bridge-studio.ts::resolveGuardedPath::flowsBase",
  "apps/forge/bridge-studio.ts::resolveGuardedPath::safeLogsBase",
  "apps/forge/bridge-studio.ts::resolveGuardedPath::safeLogsBase",
  "apps/forge/ui-bridge.ts::guardedWriteFile::join(forgeRoot, '_logs')",
  "apps/forge/ui-bridge.ts::guardedWriteFile::join(forgeRoot, '_logs')",
  "apps/forge/ui-bridge.ts::guardedWriteFile::join(forgeRoot, '_logs')",
  "packages/agents/agent-dispatch-cmd.ts::resolveGuardedPath::projectsRoot",
  "packages/agents/agent-run.ts::resolveGuardedPath::projectsRoot",
  "packages/agents/agent-run.ts::resolveGuardedPath::projectsRoot",
  "packages/agents/bridge-agents-studio.ts::resolveGuardedPath::resolve(ctx.forgeRoot, 'studio', 'flows')",
  "packages/agents/bridge-agents-studio.ts::resolveGuardedPath::toSkillsDir(ctx.forgeRoot)",
  "packages/flows/cycle.ts::guardedReadFile::dirname(logFilePath)",
  "packages/knowledge/bridge-studio-kb-routes-lifecycle.ts::resolveGuardedPath::brainBase",
  "packages/knowledge/bridge-studio-kb-routes-lifecycle.ts::resolveGuardedPath::dirname(kbDir)",
  "packages/knowledge/bridge-studio-kb-routes-lifecycle.ts::resolveGuardedPath::projectsRootForDelete",
  "packages/knowledge/bridge-studio-kb-routes-maintenance.ts::resolveGuardedPath::brainRoot",
  "packages/knowledge/bridge-studio-kb-routes-maintenance.ts::resolveGuardedPath::join(forgeRoot, '_logs')",
  "packages/knowledge/kb-drain-edit-soundness.ts::guardedWriteFile::brainRoot",
  "packages/knowledge/kb-drain-store.ts::guardedWriteFile::projectsRoot",
  "packages/knowledge/kb-graph.ts::resolveGuardedPath::dirname(kbDir)",
  "packages/library/bridge-studio-authoring-hook.ts::guardedFile::hooksDir(forgeRoot)",
  "packages/library/bridge-studio-authoring-hook.ts::resolveGuardedPath::hooksDir(forgeRoot)",
  "packages/library/bridge-studio-authoring-template.ts::resolveGuardedPath::resolve(forgeRoot, ...dirSegments)",
  "packages/library/bridge-studio-authoring.ts::resolveGuardedPath::projectsRoot",
  "packages/library/bridge-studio-hooks.ts::resolveGuardedPath::hooksDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-hooks.ts::resolveGuardedPath::hooksDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-hooks.ts::resolveGuardedPath::hooksDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-hooks.ts::resolveGuardedPath::hooksDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-hooks.ts::resolveGuardedPath::hooksDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-hooks.ts::resolveGuardedPath::hooksDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-hooks.ts::resolveGuardedPath::hooksDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-hooks.ts::resolveGuardedPath::hooksDir(forgeRoot)",
  "packages/library/bridge-studio-hooks.ts::resolveGuardedPath::hooksDir(forgeRoot)",
  "packages/library/bridge-studio-instructions.ts::resolveGuardedPath::skillsDir(forgeRoot)",
  "packages/library/bridge-studio-skills.ts::resolveGuardedPath::skillsDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-skills.ts::resolveGuardedPath::skillsDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-skills.ts::resolveGuardedPath::skillsDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-skills.ts::resolveGuardedPath::skillsDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-skills.ts::resolveGuardedPath::skillsDir(ctx.forgeRoot)",
  "packages/library/bridge-studio-templates.ts::resolveGuardedPath::resolve(ctx.forgeRoot, ...dirSegments)",
  "packages/library/bridge-studio-templates.ts::resolveGuardedPath::resolve(ctx.forgeRoot, ...dirSegments)",
  "packages/library/skill-path.ts::guardedFile::skillsDir(root)",
  "packages/library/studio/community-index.ts::guardedFile::vendoredBaseDir(forgeRoot, 'hook')",
  "packages/library/studio/community-index.ts::guardedReadFile::vendoredBaseDir(forgeRoot, 'skill')",
  "packages/library/studio/community-install.ts::guardedFile::hooksDir(forgeRoot)",
  "packages/library/studio/community-install.ts::guardedFile::hooksDir(forgeRoot)",
  "packages/library/studio/hook-package.ts::guardedFile::base",
  "packages/library/studio/hook-package.ts::guardedFile::base",
  "packages/library/studio/skill-install.ts::guardedFile::skillsDir(forgeRoot)",
  "packages/library/studio/skill-install.ts::guardedFile::skillsDir(forgeRoot)",
  "packages/library/studio/skill-package.ts::guardedFile::skillsDir(forgeRoot)",
  "packages/library/studio/skill-package.ts::guardedFile::skillsDir(forgeRoot)",
  "packages/projects/bridge-studio-project-onboard.ts::resolveGuardedPath::projectRoot",
  "packages/projects/project-preflight-read.ts::resolveGuardedPath::join(forgeRoot, '_logs')",
  "packages/projects/reset.ts::guardedReadFile::startersRoot",
  "packages/projects/reset.ts::guardedRename::dir",
  "packages/projects/reset.ts::resolveGuardedPath::dir",
  "packages/projects/reset.ts::resolveGuardedPath::dir",
  "packages/sessions/bridge-studio-agent-capability.ts::resolveGuardedPath::skillsDir(forgeRoot)",
  "packages/sessions/bridge-studio-kickoff.ts::guardedWriteFile::projectsRoot",
  "packages/sessions/bridge-studio-session-cancel.ts::resolveGuardedPath::projectsRoot",
  "packages/sessions/bridge-studio-sessions-affordances.ts::resolveGuardedPath::projectsRoot",
  "packages/sessions/session-model-tier.ts::resolveGuardedPath::skillsDir(forgeRoot)",
].slice().sort();

test('control (d): the live tree matches the frozen baseline EXACTLY — a new caller-built root fails this, and so does silently fixing one without shrinking the baseline', () => {
  const pathGuardSource = readFileSync(PATH_GUARD_SOURCE, 'utf8');
  const guardNames = discoverRootTakingGuardNames(pathGuardSource);
  assert.ok(guardNames.size > 0, 'guard-name discovery found nothing in path-guard.ts — the discovery itself is broken, not the live tree');

  const actual = scanLiveTree(guardNames);
  assert.deepEqual(
    actual,
    BASELINE_CALLER_BUILT_ROOT_KEYS,
    `the live tree's caller-built-root call sites no longer match the frozen baseline.\n` +
      `If this is a NEW hit: a caller now builds a resolveGuardedPath/guardedRename/... root ` +
      `inline or from a local var referencing a parameter — read path-guard.ts's CONTRACT ` +
      `section and the #289 incident before deciding whether it is real.\n` +
      `If this is a MISSING hit: a listed site was fixed (or removed) — shrink ` +
      `BASELINE_CALLER_BUILT_ROOT_KEYS to match, don't leave a stale entry.\n` +
      `actual (${actual.length}):\n${JSON.stringify(actual, null, 2)}`,
  );
});

// ---------------------------------------------------------------------------
// Executable control: pins WHY the ratchet exists — the documented trust is
// real and reproducible, not a hypothetical.
// ---------------------------------------------------------------------------

test('executable control: folding an untrusted id into ROOT trusts a planted symlink; passing it as a SEGMENT under a fixed root does not', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'caller-built-root-control-'));
  const outsideVictim = mkdtempSync(join(tmpdir(), 'caller-built-root-control-VICTIM-'));
  try {
    const projectsDir = join(tmp, 'projects');
    mkdirSync(projectsDir);
    // 'projects/victim' is a symlink pointing OUTSIDE tmp entirely — exactly
    // the #289 shape (`projects/` planted as a symlink).
    symlinkSync(outsideVictim, join(projectsDir, 'victim'));

    // WRONG (root-folding): the untrusted 'victim' id is folded into `root`
    // via `join()` BEFORE resolveGuardedPath ever sees it. realpathSync(root)
    // resolves the symlink with NO identity check — the documented trust —
    // so this reports ok:true for a path that is entirely outside `tmp`.
    const foldedResult = resolveGuardedPath(join(tmp, 'projects', 'victim'), ['f']);
    assert.equal(
      foldedResult.ok,
      true,
      `arrange: folding the id into root must reproduce the documented trust (ok:true) — got ${JSON.stringify(foldedResult)}. If this ever reports false, the ratchet's whole premise needs re-verifying.`,
    );

    // RIGHT: 'projects' is the fixed root; 'victim' arrives as its own
    // segment, so the per-segment identity walk actually runs on it and
    // catches the symlink.
    const segmentResult = resolveGuardedPath(tmp, ['projects', 'victim', 'f']);
    assert.equal(
      segmentResult.ok,
      false,
      `expected passing the id as a SEGMENT under a fixed root to be refused — got ${JSON.stringify(segmentResult)}`,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(outsideVictim, { recursive: true, force: true });
  }
});
