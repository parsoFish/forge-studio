/**
 * W8-B6 — the ENUMERATION ratchet, plus the end-to-end plumbing pin through
 * the real `runAgent` dispatch.
 *
 * ## Why a structural test exists at all
 *
 * `forge-vvp` asserted, twice, that `orchestrator/run-agent.ts` was "the sole
 * dispatch entrypoint", and prescribed a fix confined to it. Derived by
 * execution it is one of SEVEN production sites that hand-build a claude SDK
 * options bag; there is no shared options builder. Wiring one of seven would
 * have left the architect, the developer loop, brain-fix, preflight-fix,
 * release-finalize, demo-builder, project-brain-builder, instructions-creator,
 * completeness-critic and every interactive session kind hook-blind — while
 * `/hooks` kept reporting them "carried by".
 *
 * A fix is only complete if an EIGHTH site cannot be added hook-blind. That is
 * what the first suite below enforces, in the style of
 * `orchestrator/pinned-sdk-query.enforce.test.ts`: because that test already
 * forbids importing the SDK's `query` anywhere except `pinned-sdk-query.ts`,
 * every real spawn site either imports `pinnedSdkQuery`/`pinnedStreamQuery` as
 * a VALUE, or reaches the SDK indirectly through the adapter registry
 * (`getAdapter(id).query(...)` / `getAdapter(id).createAgent(...)` —
 * `loops/_adapters/registry.ts`, ADR 029's seam), or imports one of the adapter
 * OBJECTS directly (`claudeAdapter.query` IS `pinnedSdkQuery` re-exported —
 * `loops/_adapters/claude/index.ts:20,28`). So "imports the pinned query as a
 * value, OR calls getAdapter(, OR value-imports a `<runtime>Adapter` object" is
 * a sound over-approximation of "can spawn" (W8-C4 widened this from the
 * pinned-import-only shape, which was blind to adapter-registry spawn sites;
 * W8-F5's adversarial review added the third route, which slips past the
 * sibling `pinned-sdk-query.enforce.test.ts` too because it never names the SDK
 * module specifier), and every such file must either
 * wire hook dispatch — in REAL code, evaluated with comments and string
 * literals stripped, not merely a comment naming the same symbols (this
 * codebase's convention is dense cross-referencing prose that does exactly
 * that) — or carry a named, reasoned exemption.
 *
 * ## What this file does NOT prove
 *
 * That a hook process really runs is pinned in
 * `orchestrator/studio/hook-dispatch.test.ts`, by a real `bash` spawn writing a
 * side-effect file. Stated explicitly so plumbing coverage is never mistaken
 * for execution coverage.
 *
 * Also: `stripComments` (below), which the ratchet uses to evaluate `WIRED`,
 * `ADAPTER_CALL` and `ADAPTER_VALUE_IMPORT` against real code, is a lexer for
 * `//`/`/* … *\/` comments, quoted strings and template literals (including
 * comments inside a `${…}` substitution, which IS a code context — W8-F5
 * review) — not a full TS tokenizer. It does not special-case regex literals;
 * a `/pattern/` containing a comment-shaped run of characters could be
 * mis-split, which can only ERASE real code on that line (a false OFFENDER —
 * fail-closed noise), never fabricate wiring. No spawn-capable file in this
 * codebase currently has that shape on a line naming `sdkHooksForAgent`,
 * `SdkHooksOption`, or `getAdapter`.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { runAgent } from './run-agent.ts';
import { FORGE_ROOT } from './studio/derive.ts';
import { loadAgentDefinition } from '../../orchestrator/studio/registry.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';

// ---------------------------------------------------------------------------
// 1 — the ratchet
// ---------------------------------------------------------------------------

/** Roots scanned for spawn sites. `cli/` imports `isSafeRunId` from run-agent
 *  but never the pinned query as a value, so it holds no spawn site. */
const SCAN_ROOTS = ['orchestrator', 'loops', 'packages', 'apps/forge'];

/**
 * Files that import the pinned SDK query as a VALUE yet legitimately do not
 * wire hook dispatch. Every row states WHY, and the reason must be a
 * structural fact — never "it seemed fine".
 */
const HOOK_DISPATCH_EXEMPT: Record<string, string> = {
  'packages/factory/phases/project-manager.ts':
    'imports pinnedStreamQuery only to DEFAULT options.queryFn; its actual spawn goes through runAgent(def, …) (:248), which builds the bag from the same derived spec.',
  'packages/agents/_adapters/claude/index.ts':
    'the adapter registry shim. `query` is the raw stream boundary a direct-stream phase injects (that phase wires its own bag), and `createAgent` delegates to createClaudeAgent, which forwards opts.hooks.',
  'packages/agents/_adapters/registry.ts':
    'the registry TABLE itself: it value-imports the four adapter objects only to key them by sdk id (`getAdapter`/`resolveSdkId`) and never builds, holds or passes an options bag — every caller that obtains an adapter here is itself enumerated by ADAPTER_CALL and must wire its own. Newly enumerated by W8-F5\'s ADAPTER_VALUE_IMPORT rule, which exists to catch a CONSUMER importing an adapter object directly.',
};

/** Any of these means the file participates in hook dispatch. */
const WIRED = /sdkHooksForAgent|SdkHooksOption/;

/** A VALUE import of the pinned query (a `type`-only import cannot spawn). */
const VALUE_IMPORT = /import\s*\{[^}]*\bpinned(?:SdkQuery|StreamQuery)\b[^}]*\}\s*from/;

/**
 * A value CALL of the adapter registry's `getAdapter(` — not its `function
 * getAdapter(` definition in `loops/_adapters/registry.ts`. Deliberately
 * evaluated against COMMENT-STRIPPED source (see `stripComments`) so a
 * docstring mention — e.g. registry.ts's own "reaching `getAdapter()`" prose,
 * or a call site merely described in a comment — is never mistaken for a real
 * spawn site (W8-C4, the same failure mode `WIRED` had). This deliberately
 * does NOT require `getAdapter(id)` and `.query`/`.createAgent` to be chained
 * in one expression — real call sites commonly split them across two
 * statements (`const a = getAdapter(id); a.query(...)` /
 * `getAdapter(id).createAgent(...)`) — since every registered adapter's only
 * public exit to the SDK is through `.query`/`.createAgent`, so any real
 * invocation of `getAdapter(` is a sound enough signal on its own.
 */
const ADAPTER_CALL = /(?<!function\s)\bgetAdapter\s*\(/;

/**
 * A VALUE import of a runtime ADAPTER OBJECT (`claudeAdapter`, `geminiAdapter`,
 * `aiderAdapter`, `exampleAdapter`). W8-F5 adversarial review: this is a THIRD
 * spawn route that matches neither of the two above — `claudeAdapter.query` IS
 * `pinnedSdkQuery` re-exported under another name
 * (`loops/_adapters/claude/index.ts:20,28`), so
 * `import { claudeAdapter } … ; claudeAdapter.query(…)` spawns with no
 * `pinned…` import and no literal `getAdapter(` anywhere. It also slips past
 * `pinned-sdk-query.enforce.test.ts`, which keys on the SDK module specifier.
 *
 * Keys on this repo's naming convention: adapter VALUES are camelCase
 * `<runtime>Adapter`; the TYPE is PascalCase `RuntimeAdapter` (so a
 * `import type { RuntimeAdapter }` does not make a file spawn-capable). If that
 * convention ever changes, this rule must change with it.
 */
const ADAPTER_VALUE_IMPORT = /import\s*(?!type\b)\{[^}]*\b[a-z][A-Za-z0-9_$]*Adapter\b[^}]*\}\s*from/;

/**
 * Strips `//` line comments and `/* … *\/` block comments from TS source,
 * respecting single/double/template string boundaries (including escaped
 * quotes) so a comment-shaped sequence inside a string literal is never
 * treated as a comment start. See the file header for what this deliberately
 * does not cover (regex literals).
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  // Mode stack. A backtick pushes `tpl`; a `${` INSIDE a template pushes `code`
  // back on (with its own brace depth) because a substitution is a real code
  // context — W8-F5 adversarial review found that treating a template literal
  // as opaque let `\`x: ${/* sdkHooksForAgent TODO */ p}\`` survive stripping
  // and read as WIRING: the exact fail-open this ratchet exists to close,
  // relocated one syntax level down.
  const stack: Array<'code' | 'tpl'> = ['code'];
  const braceDepth: number[] = [0];
  while (i < n) {
    if (stack[stack.length - 1] === 'code') {
      if (src.slice(i, i + 2) === '//') {
        while (i < n && src.charAt(i) !== '\n') i++;
        continue;
      }
      if (src.slice(i, i + 2) === '/*') {
        const end = src.indexOf('*/', i + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }
      const ch = src.charAt(i);
      if (ch === '`') {
        out += ch;
        i++;
        stack.push('tpl');
        continue;
      }
      if (ch === '"' || ch === "'") {
        out += ch;
        i++;
        while (i < n && src.charAt(i) !== ch) {
          if (src.charAt(i) === '\\' && i + 1 < n) {
            out += src.slice(i, i + 2);
            i += 2;
            continue;
          }
          out += src.charAt(i);
          i++;
        }
        if (i < n) {
          out += src.charAt(i);
          i++;
        }
        continue;
      }
      if (ch === '{') braceDepth[braceDepth.length - 1]! += 1;
      if (ch === '}') {
        if (braceDepth[braceDepth.length - 1] === 0 && stack.length > 1 && stack[stack.length - 2] === 'tpl') {
          // closing a `${…}` hole — hand control back to the template literal
          out += ch;
          i++;
          stack.pop();
          braceDepth.pop();
          continue;
        }
        if (braceDepth[braceDepth.length - 1]! > 0) braceDepth[braceDepth.length - 1]! -= 1;
      }
      out += ch;
      i++;
      continue;
    }
    // template-literal mode: copy through, but a `${` opens a code context
    const ch = src.charAt(i);
    if (ch === '\\' && i + 1 < n) {
      out += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '`') {
      out += ch;
      i++;
      stack.pop();
      continue;
    }
    if (src.slice(i, i + 2) === '${') {
      out += '${';
      i += 2;
      stack.push('code');
      braceDepth.push(0);
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listTsFiles(full, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/**
 * Enumerates spawn-capable files under `root` (default the real forge
 * install). Parameterised by root so the W8-C4 pins below can drive it over a
 * scratch tree (a mkdtemp fixture) instead of ever writing inside the repo.
 * A scratch fixture may populate only one of `SCAN_ROOTS` — missing roots are
 * skipped rather than treated as an error.
 */
function spawnCapableFiles(root: string = FORGE_ROOT): string[] {
  const found: string[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(root, scanRoot);
    if (!existsSync(dir)) continue;
    for (const file of listTsFiles(dir)) {
      const rel = relative(root, file);
      const src = readFileSync(file, 'utf8');
      // Strip the `type`-only variant so `import type { StreamQueryFn }` and
      // `import { pinnedSdkQuery … }` are not conflated.
      const typeOnlyPinnedImport = /import\s+type\s*\{[^}]*\bpinned/.test(src) && !VALUE_IMPORT.test(src);
      if (VALUE_IMPORT.test(src) && !typeOnlyPinnedImport) {
        found.push(rel);
        continue;
      }
      const code = stripComments(src);
      if (ADAPTER_CALL.test(code) || ADAPTER_VALUE_IMPORT.test(code)) found.push(rel);
    }
  }
  return found.sort();
}

/**
 * The hook-blind offenders in `root`: spawn-capable files that carry no
 * named exemption and whose comment-stripped source never mentions the
 * wiring symbols in real code.
 */
function offendersIn(root: string): string[] {
  const offenders: string[] = [];
  for (const rel of spawnCapableFiles(root)) {
    if (rel in HOOK_DISPATCH_EXEMPT) continue;
    if (WIRED.test(stripComments(readFileSync(join(root, rel), 'utf8')))) continue;
    offenders.push(rel);
  }
  return offenders;
}

describe('hook dispatch covers every spawn site (the enumeration ratchet)', () => {
  it('every file that can spawn either wires hook dispatch or carries a named exemption (kills: adding an eighth spawn site hook-blind — the exact shape forge-vvp prescribed)', () => {
    const offenders = offendersIn(FORGE_ROOT);
    assert.deepEqual(
      offenders,
      [],
      `these files import the pinned SDK query as a value, call the adapter registry's getAdapter(, or ` +
        `import a runtime adapter OBJECT directly (so they can spawn) but never reach ` +
        `orchestrator/studio/hook-dispatch.ts in real code (a comment ` +
        `naming the wiring symbols does not count). Wire sdkHooksForAgent into the options bag, or add a ` +
        `reasoned row to HOOK_DISPATCH_EXEMPT:\n  ${offenders.join('\n  ')}`,
    );
  });

  it('the ratchet actually sees the spawn sites — it is not vacuously green on an empty scan', () => {
    const files = spawnCapableFiles();
    assert.ok(
      files.length >= 12,
      `expected the scan to find the known spawn-capable files; found ${files.length}: ${files.join(', ')}`,
    );
    for (const known of [
      'packages/agents/run-agent.ts',
      'packages/sessions/architect-runner.ts',
      'packages/sessions/brain-fix-runner.ts',
      'packages/sessions/preflight-fix-runner.ts',
      'packages/factory/phases/release-finalize.ts',
      'packages/factory/phases/developer-loop.ts',
      'packages/agents/ralph/claude-agent.ts',
    ]) {
      assert.ok(files.includes(known), `the scan must see ${known}`);
    }
  });

  it('every exemption still names a file that exists and still imports the pinned query — a stale exemption is a hole', () => {
    const files = new Set(spawnCapableFiles());
    for (const rel of Object.keys(HOOK_DISPATCH_EXEMPT)) {
      assert.ok(files.has(rel), `stale exemption: ${rel} no longer imports the pinned SDK query as a value — delete the row`);
      assert.ok(HOOK_DISPATCH_EXEMPT[rel]!.length > 40, `exemption for ${rel} must state a real structural reason`);
    }
  });

  it('the ratchet\'s own premise holds: exactly one file may import the SDK query directly, and it is the pinned seam', () => {
    // This suite over-approximates "can spawn" as "imports pinnedSdkQuery/
    // pinnedStreamQuery as a value". That is only sound while
    // pinned-sdk-query.enforce.test.ts still forbids every OTHER file from
    // importing the SDK's `query` as a value — otherwise a new site could
    // spawn without ever touching the seam this scan keys on. Assert the
    // premise rather than assume it.
    assert.ok(
      readFileSync(join(FORGE_ROOT, 'packages/agents/pinned-sdk-query.enforce.test.ts'), 'utf8').includes('WRAPPER_RELATIVE_PATH'),
      'the structural lock this ratchet depends on must still exist',
    );
    const direct: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of listTsFiles(join(FORGE_ROOT, root))) {
        const rel = relative(FORGE_ROOT, file);
        if (rel === 'packages/agents/pinned-sdk-query.ts') continue;
        if (/import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s*'@anthropic-ai\/claude-agent-sdk'/.test(readFileSync(file, 'utf8'))) {
          direct.push(rel);
        }
      }
    }
    assert.deepEqual(direct, [], 'a file bypassing the pinned seam would also bypass this hook-dispatch ratchet');
  });

  it('the two interactive-session spawn shapes both forward the bag (they are the sites nine agents reach the SDK through)', () => {
    const src = readFileSync(join(FORGE_ROOT, 'packages/sessions/interactive-session.ts'), 'utf8');
    const forwards = src.match(/\.\.\.\(args\.hooks !== undefined \? \{ hooks: args\.hooks \} : \{\}\)/g) ?? [];
    assert.equal(forwards.length, 2, 'runStructuredTurn AND runAgentTurn must each spread the hooks bag into their options');
  });
});

// ---------------------------------------------------------------------------
// 1b — W8-C4: the ratchet must also see adapter-registry spawn sites, and
// must not be fooled by comment-only wiring. Driven over scratch roots
// (mkdtemp fixtures, cleaned up by the `after()` hook in section 2 below) so
// no fixture is ever written inside the repo.
// ---------------------------------------------------------------------------

describe('the ratchet widens to adapter-registry spawn sites and ignores comment-only wiring (W8-C4)', () => {
  it('a file that spawns only through getAdapter(id).query(...), with no hook wiring, IS an offender (kills: spawnCapableFiles blind to the adapter-registry seam — an eighth site could add itself hook-blind through getAdapter)', () => {
    const root = tmp('w8c4-adapter-');
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(
      join(root, 'orchestrator', 'adapter-spawn-site.ts'),
      [
        "import { getAdapter } from '../loops/_adapters/registry.ts';",
        '',
        'export async function spawnViaAdapter(p: string) {',
        "  const a = getAdapter('claude');",
        '  return a.query({ prompt: p, options: {} } as never);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(
      offendersIn(root),
      ['orchestrator/adapter-spawn-site.ts'],
      'a getAdapter(...).query(...) spawn site with no sdkHooksForAgent/SdkHooksOption anywhere must be flagged',
    );
  });

  it('the same adapter-registry spawn site, WITH sdkHooksForAgent actually placed in the options bag, is NOT an offender (the swap-the-fix twin of the previous pin)', () => {
    const root = tmp('w8c4-adapter-wired-');
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(
      join(root, 'orchestrator', 'adapter-spawn-site.ts'),
      [
        "import { getAdapter } from '../loops/_adapters/registry.ts';",
        "import { sdkHooksForAgent } from '../orchestrator/studio/hook-dispatch.ts';",
        '',
        'export async function spawnViaAdapter(p: string) {',
        "  const a = getAdapter('claude');",
        "  const hooks = sdkHooksForAgent({ skill: 'x' } as never);",
        '  return a.query({ prompt: p, options: { hooks } } as never);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(offendersIn(root), [], 'wiring sdkHooksForAgent into the bag must clear the offender flag');
  });

  it('a pinned-query spawn site whose ONLY mention of sdkHooksForAgent/SdkHooksOption is inside comments IS an offender (kills: WIRED matching raw comment text instead of wired code)', () => {
    const root = tmp('w8c4-comment-');
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(
      join(root, 'orchestrator', 'comment-only-wiring.ts'),
      [
        "import { pinnedSdkQuery } from '../pinned-sdk-query.ts';",
        '',
        '// TODO: wire sdkHooksForAgent into the options bag below.',
        '/* SdkHooksOption belongs here once this lands. */',
        'export function spawnDirect(p: string) {',
        '  return pinnedSdkQuery({ prompt: p, options: {} } as never);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(
      offendersIn(root),
      ['orchestrator/comment-only-wiring.ts'],
      'a comment-only mention of the wiring symbols must not count as wired',
    );
  });

  it('the same file with the wiring symbol actually in code (not a comment) is NOT an offender', () => {
    const root = tmp('w8c4-real-wiring-');
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(
      join(root, 'orchestrator', 'real-wiring.ts'),
      [
        "import { pinnedSdkQuery } from '../pinned-sdk-query.ts';",
        "import { sdkHooksForAgent } from '../orchestrator/studio/hook-dispatch.ts';",
        '',
        'export function spawnDirect(p: string) {',
        "  const hooks = sdkHooksForAgent({ skill: 'x' } as never);",
        '  return pinnedSdkQuery({ prompt: p, options: { hooks } } as never);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(offendersIn(root), [], 'real code wiring must clear the offender flag');
  });

  it('a type-only import of the adapter registry types (plus a comment naming getAdapter) does NOT make a file spawn-capable (no over-fire)', () => {
    const root = tmp('w8c4-type-only-');
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(
      join(root, 'orchestrator', 'type-only.ts'),
      [
        '/**',
        ' * Real callers reach the SDK via `getAdapter(id).createAgent(...)`; this',
        ' * file only names the TYPE and holds no spawn site.',
        ' */',
        "import type { RuntimeAdapter } from '../loops/_adapters/types.ts';",
        '',
        'export function describeAdapter(a: RuntimeAdapter): string {',
        "  return a.available ? 'available' : 'unavailable';",
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(
      spawnCapableFiles(root),
      [],
      'a type-only import (and a comment mentioning getAdapter) must not be enumerated as spawn-capable',
    );
  });
  it('a file that imports a runtime ADAPTER OBJECT directly and calls .query(...) on it IS an offender (kills: an enumeration that only knows the pinned-query import and the literal getAdapter( text — claudeAdapter.query IS pinnedSdkQuery re-exported, so this is a THIRD spawn route, found by adversarial review)', () => {
    const root = tmp('w8f5-adapter-const-');
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(
      join(root, 'orchestrator', 'direct-adapter-site.ts'),
      [
        "import { claudeAdapter } from '../loops/_adapters/claude/index.ts';",
        '',
        'export async function spawnDirect(p: string) {',
        '  return claudeAdapter.query({ prompt: p, options: {} } as never);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(
      offendersIn(root),
      ['orchestrator/direct-adapter-site.ts'],
      'importing the adapter VALUE bypasses both getAdapter( and the pinned-query import — it must still be enumerated',
    );
  });

  it('the same direct-adapter site, WITH the hooks bag wired, is NOT an offender (swap-the-fix twin)', () => {
    const root = tmp('w8f5-adapter-const-wired-');
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(
      join(root, 'orchestrator', 'direct-adapter-site.ts'),
      [
        "import { claudeAdapter } from '../loops/_adapters/claude/index.ts';",
        "import { sdkHooksForAgent } from './studio/hook-dispatch.ts';",
        '',
        'export async function spawnDirect(p: string, def: unknown) {',
        '  const hooks = sdkHooksForAgent(def as never);',
        '  return claudeAdapter.query({ prompt: p, options: { ...(hooks ? { hooks } : {}) } } as never);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(offendersIn(root), [], 'a wired direct-adapter site is not an offender');
  });

  it('the adapter TYPE (PascalCase RuntimeAdapter) does not make a file spawn-capable — only a camelCase adapter VALUE does (no over-fire)', () => {
    const root = tmp('w8f5-adapter-type-');
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(
      join(root, 'orchestrator', 'type-only-adapter.ts'),
      [
        "import type { RuntimeAdapter } from '../loops/_adapters/types.ts';",
        '',
        'export function describeAdapter(a: RuntimeAdapter): string {',
        '  return String(a);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(offendersIn(root), [], 'a type-only adapter import cannot spawn');
  });

  it('a comment nested inside a template-literal ${} hole does NOT count as wiring (kills: a comment stripper that treats a template literal as opaque — the fail-open shape this ratchet exists to close, relocated into a substitution, found by adversarial review)', () => {
    const root = tmp('w8f5-tpl-hole-');
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(
      join(root, 'orchestrator', 'tpl-hole-site.ts'),
      [
        "import { pinnedStreamQuery } from './pinned-sdk-query.ts';",
        '',
        'export async function spawn(p: string) {',
        '  const label = `run: ${/* sdkHooksForAgent still TODO, not wired */ p}`;',
        '  return pinnedStreamQuery({ prompt: label, options: {} } as never);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    assert.deepEqual(
      offendersIn(root),
      ['orchestrator/tpl-hole-site.ts'],
      'a ${} hole is a CODE context — a comment inside it is still a comment, not wiring',
    );
  });

});

// ---------------------------------------------------------------------------
// 2 — end-to-end plumbing through the REAL runAgent dispatch
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];
after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

/**
 * A real `AgentDefinition` loaded from a SKILL.md written outside the install
 * root. `runAgent` derives its spec via `deriveAgentSpec(relative(FORGE_ROOT,
 * def.path))` and `sdkHooksForAgent` resolves the same string back against
 * `FORGE_ROOT`, so an out-of-tree fixture round-trips without the test writing
 * a single byte inside the repo. Hook ids still resolve against the REAL
 * `studio/hooks/`, which is what makes the OOTB binding below meaningful.
 */
function fixtureAgent(slug: string, hooks: string[]): AgentDefinition {
  const dir = join(tmp('hook-e2e-'), 'skills', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    [
      '---',
      `name: ${slug}`,
      `description: W8-B6 end-to-end dispatch fixture (${slug}).`,
      'phase: reflection',
      'surface: unattended',
      'library: false',
      'purpose: Fixture.',
      'composition:',
      '  skills: []',
      '  tools: []',
      '  mcps: []',
      '  guards: []',
      `  hooks: [${hooks.join(', ')}]`,
      'runtime:',
      '  sdk: claude',
      '  strategy: fixed',
      '  model: claude-haiku-4-5-20251001',
      "  loopStrategy: 'one-shot'",
      'brainAccess: none',
      'interactivity: Fully autonomous.',
      'allowed-tools: [Read]',
      'disallowed-tools: [Bash]',
      'budgets: {}',
      '---',
      '',
      `# ${slug}`,
      '',
      'Fixture.',
      '',
    ].join('\n'),
    'utf8',
  );
  return loadAgentDefinition(join(dir, 'SKILL.md'));
}

/** Captures the options bag `runAgent` hands the SDK, then ends the stream. */
function capturingQuery(sink: { options?: Record<string, unknown> }): StreamQueryFn {
  return ({ options }) => {
    sink.options = options;
    return (async function* () {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0, duration_ms: 1, usage: {} };
    })();
  };
}

async function optionsFor(def: AgentDefinition): Promise<Record<string, unknown>> {
  const sink: { options?: Record<string, unknown> } = {};
  await runAgent(def, {
    runId: 'w8b6-e2e',
    workdir: tmp('hook-e2e-wd-'),
    prompt: 'noop',
    lifecycle: 'caller',
    logsRoot: tmp('hook-e2e-logs-'),
    queryFn: capturingQuery(sink),
  });
  assert.ok(sink.options, 'the fake query must have been called');
  return sink.options!;
}

describe('runAgent reaches the SDK options bag with the bound hooks (end-to-end plumbing)', () => {
  it('an agent binding a REAL library hook lands it under its declared lifecycle event (kills: HEAD, where no hooks key ever reached any spawn)', async () => {
    // post-merge-brain-ingest is an OOTB package under studio/hooks/, declared
    // `on: SessionEnd`. Deliberately NOT approved here: this pin is about the
    // plumbing reaching the SDK, and approving a package in the real install
    // to satisfy a test would be the "guard widened to fit the fixture" shape.
    const options = await optionsFor(fixtureAgent('w8b6-bound-fixture', ['post-merge-brain-ingest']));
    const hooks = options['hooks'] as Record<string, Array<{ hooks: unknown[] }>> | undefined;
    assert.ok(hooks, 'runAgent must pass a hooks option for an agent that binds one');
    assert.deepEqual(Object.keys(hooks), ['SessionEnd'], 'keyed by the hook.yaml-declared event, read off disk');
    assert.equal(hooks['SessionEnd']!.length, 1);
    assert.equal(hooks['SessionEnd']![0]!.hooks.length, 1);
    assert.equal(typeof hooks['SessionEnd']![0]!.hooks[0], 'function');
  });

  it('an agent binding nothing produces NO hooks key at all — the shape every shipped agent spawns with (kills: an always-on key, which would diff every golden spawn-capture fixture)', async () => {
    const options = await optionsFor(fixtureAgent('w8b6-unbound-fixture', []));
    assert.equal('hooks' in options, false);
  });

  it('no agent in the shipped roster binds a hook, so no shipped spawn shape changed', () => {
    const skillsDir = join(FORGE_ROOT, 'skills');
    const binders: string[] = [];
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const md = join(skillsDir, entry.name, 'SKILL.md');
      let def: AgentDefinition;
      try {
        def = loadAgentDefinition(md);
      } catch {
        continue;
      }
      if (def.composition.hooks.length > 0) binders.push(`${entry.name}: ${def.composition.hooks.join(', ')}`);
    }
    // Deliberately-green gap pin. EXPIRY CONDITION, stated as required: the
    // moment forge ships an agent with a bound hook, this must be replaced by a
    // spawn-capture fixture update showing the new bag — not deleted.
    assert.deepEqual(binders, [], 'a shipped agent now binds a hook; update the golden spawn-capture fixtures deliberately');
  });
});
