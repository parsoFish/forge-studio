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
 * added there is covered with no edit here). A call's root argument is first
 * classed as either (1) an inline expression built from a call
 * (`resolve(...)`/`join(...)`/a helper), a template literal, or a `+` string
 * concatenation, or (2) a local `const`/`let` in the SAME function whose
 * initializer is one of those same three shapes — anything else (a bare
 * identifier with no such local declaration, i.e. a parameter passed
 * straight through, or a plain property access like `ctx.forgeRoot`) is
 * NEVER flagged, full stop.
 *
 * REFINED RULE (v2 — forge-mlk follow-up): a call in class (1) or (2) is
 * flagged only when the BUILT expression itself — the inline argument, or
 * the local var's initializer — contains at least one "leaf" (a bare
 * Identifier, or the final `.name` of a PropertyAccessExpression) whose name
 * is NOT root-like. Root-like = the leaf's own name ends in `root`, `dir`,
 * `directory`, `home`, or `base` (case-insensitive) — `forgeRoot`,
 * `projectsDir`, `ctx.logsRoot`, `repoRoot` all qualify; `id`, `slug`,
 * `projectId` do not. String/number literals are never leaves and never
 * count. A call's own callee name (`resolve`, `join`, `skillsDir`, or a
 * PropertyAccessExpression used AS a callee, e.g. `pathGuard.someHelper`) is
 * excluded from leaf collection entirely — it names a transform, not data —
 * so `join(forgeRoot, '_logs')` collects only the leaf `forgeRoot`
 * (root-like → not flagged) while `join(forgeRoot, slug)` collects
 * `forgeRoot` AND `slug` (`slug` is not root-like → flagged).
 *
 * WHY THIS IS THE #289 SHAPE, STRUCTURALLY, WITHOUT DATAFLOW. The #289
 * incident's own call — `resolve(projectsDir, id)` as `root` — folds a
 * NON-ROOT value (`id`) into an otherwise root-shaped expression; every
 * benign call in this tree builds its root ONLY from root-named values and
 * literals (`skillsDir(forgeRoot)`, `hooksDir(ctx.forgeRoot)`,
 * `join(forgeRoot, '_logs')`). Naming convention, not true taint tracking, is
 * what makes these distinguishable here — see the disclosed blind spot below
 * before trusting that distinction further than it goes.
 *
 * DISCLOSED BLIND SPOT (the direct cost of a name-based rule, not an
 * oversight): a variable whose OWN name is root-like but whose VALUE was
 * built one hop further back from something that is not. Concretely —
 *   `const dir = someHelper(id);`        // flagged: leaf 'id' is not root-like
 *   `const rootDir = wrap(dir);`         // NOT flagged: the only leaf is 'dir',
 *   `resolveGuardedPath(rootDir, [...])` // and 'dir' ends in "dir" — root-like
 *                                        // by NAME even though ITS OWN value
 *                                        // traces back to the request-derived `id`.
 * This ratchet inspects only the DIRECT initializer's leaves, one hop, by
 * name — it does not recurse into a leaf's own declaration to ask whether
 * THAT was built from something untrusted. A renamed variable defeats it.
 *
 * WHY THE BASELINE IS SIX ROWS, NOT SIXTY-NINE. The unrefined v1 rule (any
 * parameter reference, regardless of name) flagged 69 real call sites — a
 * merge-conflict magnet every future config-root helper call would collide
 * with (bead forge-mlk's exact complaint about a line-keyed allowlist). The
 * name-based refinement collapses that to the sites that actually fold a
 * non-root-like value into a built root; T2's report has the per-site
 * judgement (config-derived vs. request-derived) for each of the six.
 *
 * WHAT THIS PROVABLY CANNOT COVER (stated up front, per the skill's own
 * "explicitly NOT general static analysis" instruction):
 *   - The disclosed blind spot above: a root-named variable that nonetheless
 *     carries request data one hop back.
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

/** A leaf's own name ends in one of these words (case-insensitive) → treated
 *  as a trusted, root-shaped reference, never itself the reason to flag a
 *  call. See the header's "REFINED RULE" + "DISCLOSED BLIND SPOT". */
const ROOT_LIKE_NAME_RE = /(root|dir|directory|home|base)$/i;

function isRootLikeName(name: string): boolean {
  return ROOT_LIKE_NAME_RE.test(name);
}

/**
 * Every "leaf" reference inside `node` whose name is NOT root-like — a bare
 * Identifier, or the final `.name` of a PropertyAccessExpression, that is
 * used as a VALUE (never a call's own callee, which names a transform, not
 * data — see header). Returns the list so a caller can report which leaf(s)
 * triggered the flag; an empty list means every leaf found was root-like (or
 * there were no leaves at all — a call built purely from literals).
 */
function nonRootLikeLeaves(node: ts.Node): string[] {
  const leaves: string[] = [];
  function visit(n: ts.Node): void {
    if (ts.isCallExpression(n)) {
      // The callee itself (n.expression) is a transform's NAME, not data —
      // deliberately never visited. Only the arguments carry values.
      for (const a of n.arguments) visit(a);
      return;
    }
    if (ts.isPropertyAccessExpression(n)) {
      // ONE leaf per property access, keyed by its FINAL name segment only —
      // per the header's rule ("root-like = the final name segment"). Does
      // NOT separately recurse into `n.expression` (the object part, e.g.
      // `ctx` in `ctx.forgeRoot`) — this is the documented single-hop scope.
      if (!isRootLikeName(n.name.text)) leaves.push(n.getText());
      return;
    }
    if (ts.isIdentifier(n)) {
      if (!isRootLikeName(n.text)) leaves.push(n.text);
      return;
    }
    // String/number/other literals and everything else (template spans,
    // binary operands, spread elements, parens, ...): recurse into children.
    n.forEachChild(visit);
  }
  visit(node);
  return leaves;
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

        let reason: string | undefined;
        const shape = callerBuiltShape(arg);
        if (shape) {
          const leaves = nonRootLikeLeaves(arg);
          if (leaves.length > 0) {
            reason = `root arg is an inline ${shape} with non-root-like leaf(s): ${leaves.join(', ')}`;
          }
        } else if (ts.isIdentifier(arg)) {
          const decl = findLocalDecl(fn, arg.text);
          if (decl?.initializer) {
            const declShape = callerBuiltShape(decl.initializer);
            if (declShape) {
              const leaves = nonRootLikeLeaves(decl.initializer);
              if (leaves.length > 0) {
                reason = `root arg is local var "${arg.text}" initialized by an ${declShape} with non-root-like leaf(s): ${leaves.join(', ')}`;
              }
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
  assert.match(hits[0]!.reason, /non-root-like leaf\(s\): id/, '"id" is not root-like — that is what must trigger the flag');
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
  assert.match(hits[0]!.reason, /local var "r" initialized by an call expression/);
  assert.match(hits[0]!.reason, /non-root-like leaf\(s\): id/, '"id" is not root-like even though "base" is — that is what must trigger the flag');
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

test('control (c3) [meta, non-regression]: config-derived helper chains built only from root-named values/literals are NOT flagged', () => {
  const hits = scanFixture(`
    function readAgent(ctx: { forgeRoot: string }) {
      const forgeRoot = resolve(ctx.forgeRoot);
      const projectsDir = resolveProjectsDir(forgeRoot);
      return resolveGuardedPath(projectsDir, ['id']);
    }
  `);
  assert.deepEqual(hits, [], `expected no hits — every leaf ("ctx.forgeRoot", "forgeRoot") is root-like — got: ${JSON.stringify(hits)}`);
});

test('control (blind-spot) [meta, DISCLOSED LIMITATION, not a passing safety claim]: a root-NAMED local var whose value traces to non-root-like data ONE HOP BACK is NOT flagged', () => {
  // Exactly the header's "DISCLOSED BLIND SPOT" example. `dir` is correctly
  // flagged on its OWN line (leaf 'id' is not root-like) — but nothing here
  // asserts that; this control exists to prove `rootDir` — the identifier
  // this ratchet actually inspects at the resolveGuardedPath call site — is
  // NOT flagged, because inspecting only rootDir's DIRECT initializer sees
  // just the leaf 'dir', and 'dir' ends in "dir": root-like by name alone.
  const hits = scanFixture(`
    function readAgent(id: string) {
      const dir = someHelper(id);
      const rootDir = wrap(dir);
      return resolveGuardedPath(rootDir, ['x']);
    }
  `);
  assert.deepEqual(
    hits,
    [],
    `this is the documented blind spot, not a bug: a root-named variable ("rootDir") built from another root-named variable ("dir") is never flagged, even when "dir" itself traces to non-root-like data — got: ${JSON.stringify(hits)}`,
  );
});

test('control (e) [meta, non-regression]: join(forgeRoot, "_logs") and skillsDir(ctx.forgeRoot) — root built only from root-like leaves/literals — are NOT flagged', () => {
  const hits = scanFixture(`
    function readLogs(forgeRoot: string) {
      return resolveGuardedPath(join(forgeRoot, '_logs'), ['events.jsonl']);
    }
    function readSkill(ctx: { forgeRoot: string }, slugArg: string) {
      return resolveGuardedPath(skillsDir(ctx.forgeRoot), [slugArg]);
    }
  `);
  assert.deepEqual(hits, [], `expected no hits for either config-derived-helper call — got: ${JSON.stringify(hits)}`);
});

test('control (f) [meta]: join(forgeRoot, slug) — a non-root-like leaf folded alongside a root-like one — IS flagged', () => {
  const hits = scanFixture(`
    function readAgent(forgeRoot: string, slug: string) {
      return resolveGuardedPath(join(forgeRoot, slug), ['SKILL.md']);
    }
  `);
  assert.equal(hits.length, 1, `expected exactly one hit, got: ${JSON.stringify(hits)}`);
  assert.match(hits[0]!.reason, /non-root-like leaf\(s\): slug/, '"slug" is not root-like — that is what must trigger the flag');
});

// ---------------------------------------------------------------------------
// Control (d): the live tree, baseline-parity ratchet.
// ---------------------------------------------------------------------------

/**
 * The FROZEN set of every caller-built-root hit in `packages/` + `apps/forge/`
 * at the time this refined rule was authored (forge-8vfn.5.33 + the
 * forge-mlk follow-up), one entry per occurrence (a file+callee+argText
 * combination repeated N times in the live tree appears N times here — see
 * the header's "why a multiset" note). This baseline may only SHRINK: fixing
 * one of these sites and not updating this array fails the test (a stale
 * entry), same as a genuinely new violation appearing fails it.
 *
 * Six rows survive the name-based refinement (down from 69 under the
 * unrefined v1 rule). Per-row judgement, T2 owns the final call on each:
 *   - `packages/flows/cycle.ts::guardedReadFile::dirname(logFilePath)` —
 *     CONFIG-DERIVED. `logFilePath` is `logger.logFilePath`, the cycle
 *     logger's own internally-computed path, never request data.
 *   - `packages/library/bridge-studio-authoring-template.ts` and
 *     `packages/library/bridge-studio-templates.ts` (×2) —
 *     `resolve(forgeRoot, ...dirSegments)` / `resolve(ctx.forgeRoot,
 *     ...dirSegments)` — CONFIG-DERIVED. `dirSegments = WRITABLE_CATEGORY_DIRS[category]`,
 *     a lookup into a fixed exported const map keyed by an already-validated
 *     category enum — a false positive of the naming heuristic (the local is
 *     a literal array, just not named `*Dir`/`*Root`).
 *   - `packages/projects/bridge-studio-project-onboard.ts::resolveGuardedPath::projectRoot` —
 *     REQUEST-DERIVED, reported not fixed. `projectRoot = resolve(ctx.forgeRoot,
 *     repoPathRel)` where `repoPathRel` reads straight from the request body
 *     (`b['repoPath']`, defaulting to `` `projects/${id}` ``) with no shape
 *     validation before the `resolve()` call. A separate, purpose-built
 *     check (`deps.isContainedProjectRepoPath`) runs before this
 *     `resolveGuardedPath` call and is documented as a genuine per-segment
 *     identity walk, not a lexical prefix test — so this may already be
 *     mitigated — but it is a DIFFERENT function than `resolveGuardedPath`
 *     itself, and this ratchet cannot verify its soundness. Flagging, not
 *     fixing, per this file's header.
 *   - `packages/projects/contract-stages.ts::guardedFile::projectDir` —
 *     REQUEST-DERIVED, reported not fixed. `projectDir =
 *     resolveContainedProjectDir(projectsRoot, projectId)`, and `projectId`
 *     is a route parameter. `resolveContainedProjectDir` (same file, line
 *     102) checks containment via `realpathSync` + a lexical
 *     `.startsWith()` comparison — the "somewhere under root" shape
 *     `path-guard.ts`'s own docstring names as insufficient (escape shape 3:
 *     a symlinked id directory pointing at a DIFFERENT real object under the
 *     SAME root passes a startsWith check while landing on the wrong
 *     object) — not `resolveGuardedPath`'s per-segment IDENTITY walk. Worth
 *     a closer look; not fixed here.
 */
const BASELINE_CALLER_BUILT_ROOT_KEYS: readonly string[] = [
  "packages/flows/cycle.ts::guardedReadFile::dirname(logFilePath)",
  "packages/library/bridge-studio-authoring-template.ts::resolveGuardedPath::resolve(forgeRoot, ...dirSegments)",
  "packages/library/bridge-studio-templates.ts::resolveGuardedPath::resolve(ctx.forgeRoot, ...dirSegments)",
  "packages/library/bridge-studio-templates.ts::resolveGuardedPath::resolve(ctx.forgeRoot, ...dirSegments)",
  "packages/projects/bridge-studio-project-onboard.ts::resolveGuardedPath::projectRoot",
  "packages/projects/contract-stages.ts::guardedFile::projectDir",
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
