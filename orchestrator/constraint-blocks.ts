/**
 * Constraint-block parser (ADR 037 decision item 1 — wi-spec-compiler).
 *
 * `profile.md` and a project's Brain-3 theme files can carry machine-readable
 * clauses: HTML-comment-delimited blocks tagged with a MANDATORY stable `id:`
 * plus an `applies_to:` selector.
 *
 *   <!-- forge:constraint id: dereg-checklist applies_to: wi.kind=framework-migrate -->
 *   ...verbatim clause content (markdown)...
 *   <!-- /forge:constraint -->
 *
 * The `id` (slug charset: `[A-Za-z0-9][A-Za-z0-9_-]*`) is the clause's
 * STABLE identity — the injector keys its idempotency anchors on it, so a
 * clause can move lines (or files) in its source document without
 * re-injecting, and an edited clause body is detected + replaced in place.
 * A missing id, or a duplicate id within one source file (checked here) or
 * across a project's sources (checked in `loadProjectConstraintBlocks`), is
 * a loud parse error. This refines ADR 037's original position-keyed
 * (`sourceFile:startLine`) anchor convention, which duplicated injected
 * clauses on any line shift.
 *
 * Selector grammar v1 (deliberately small): `all`, or comma-separated AND
 * terms `wi.<field>=<glob>` / `manifest.<field>=<glob>`, where `<glob>`
 * supports only `*` as a wildcard. `<field>` is looked up dynamically
 * against the parsed WorkItem / InitiativeManifest object at match time —
 * there is no fixed field allowlist here, so any current or future schema
 * field is selectable without touching this module.
 *
 * Parse errors are LOUD: a malformed selector or an unterminated/nested/
 * stray block throws an explicit `Error` naming the source file + line.
 * Silently skipping a malformed clause is exactly the failure mode ADR 037
 * exists to close (a constraint present in the brain that never reaches a
 * WI body) — see `docs/decisions/037-compiled-wi-contracts.md`.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectBrainDir, projectThemesDir } from './brain-paths.ts';

export type ConstraintTerm = {
  namespace: 'wi' | 'manifest';
  field: string;
  glob: string;
};

export type ConstraintSelector =
  | { kind: 'all' }
  | { kind: 'and'; terms: ConstraintTerm[] };

export type ConstraintBlock = {
  /** Mandatory stable clause identity — the injector's idempotency anchor key. */
  id: string;
  selector: ConstraintSelector;
  /** Verbatim clause markdown — comment delimiters stripped, blank edges trimmed. */
  content: string;
  /** Absolute path of the source file the block was parsed from. */
  sourceFile: string;
  /** 1-based line number of the opening `<!-- forge:constraint ... -->` tag. */
  startLine: number;
};

const NAMESPACES = new Set(['wi', 'manifest']);
const OPEN_LIKE = /^<!--\s*forge:constraint\b/;
const OPEN_TAG = /^<!--\s*forge:constraint\s+id:\s*([A-Za-z0-9][A-Za-z0-9_-]*)\s+applies_to:\s*(.+?)\s*-->$/;
const HAS_ID_ATTR = /\bid:\s*\S/;
const CLOSE_LIKE = /^<!--\s*\/\s*forge:constraint\b/;
const CLOSE_TAG = /^<!--\s*\/forge:constraint\s*-->$/;
const TERM_PATTERN = /^([a-zA-Z]+)\.([a-zA-Z0-9_]+)=(.+)$/;

/** Parse every `forge:constraint` block out of one markdown source string. */
export function parseConstraintBlocks(source: string, sourceFile: string): ConstraintBlock[] {
  // CRLF/CR-authored sources (Windows editors, classic-Mac artifacts) parse
  // identically to LF: normalize before line-splitting so no `\r` survives
  // into tag matching or clause content.
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ConstraintBlock[] = [];
  /** id → 1-based line of first definition, for the duplicate-id error. */
  const seenIds = new Map<string, number>();
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i]!.trim();

    if (CLOSE_LIKE.test(trimmed)) {
      throw new Error(`${sourceFile}:${i + 1}: stray forge:constraint close tag with no matching open`);
    }

    if (!OPEN_LIKE.test(trimmed)) {
      i++;
      continue;
    }

    const startLine = i + 1;
    const openMatch = OPEN_TAG.exec(trimmed);
    if (!openMatch) {
      if (!HAS_ID_ATTR.test(trimmed)) {
        throw new Error(
          `${sourceFile}:${startLine}: forge:constraint opening tag is missing mandatory id: attribute — ` +
            `expected '<!-- forge:constraint id: <id> applies_to: <selector> -->', got: ${lines[i]}`,
        );
      }
      throw new Error(
        `${sourceFile}:${startLine}: malformed forge:constraint opening tag — expected ` +
          `'<!-- forge:constraint id: <id> applies_to: <selector> -->' (id charset ` +
          `[A-Za-z0-9][A-Za-z0-9_-]*), got: ${lines[i]}`,
      );
    }
    const id = openMatch[1]!;
    const firstLine = seenIds.get(id);
    if (firstLine !== undefined) {
      throw new Error(
        `${sourceFile}:${startLine}: duplicate constraint id "${id}" — already defined at line ${firstLine}; ` +
          `constraint ids must be unique within a project's sources`,
      );
    }
    seenIds.set(id, startLine);
    const selector = parseSelector(openMatch[2]!, sourceFile, startLine);

    let j = i + 1;
    const contentLines: string[] = [];
    let closed = false;
    while (j < lines.length) {
      const inner = lines[j]!.trim();
      if (CLOSE_TAG.test(inner)) {
        closed = true;
        break;
      }
      if (OPEN_LIKE.test(inner)) {
        throw new Error(
          `${sourceFile}:${j + 1}: nested forge:constraint open tag — the block opened at line ` +
            `${startLine} is not closed before another one begins`,
        );
      }
      contentLines.push(lines[j]!);
      j++;
    }
    if (!closed) {
      throw new Error(
        `${sourceFile}:${startLine}: unterminated forge:constraint block — missing ` +
          `'<!-- /forge:constraint -->'`,
      );
    }

    blocks.push({ id, selector, content: trimBlankEdges(contentLines.join('\n')), sourceFile, startLine });
    i = j + 1;
  }
  return blocks;
}

function trimBlankEdges(s: string): string {
  return s.replace(/^\n+/, '').replace(/\s+$/, '');
}

function parseSelector(raw: string, sourceFile: string, line: number): ConstraintSelector {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(
      `${sourceFile}:${line}: empty applies_to selector — use "all" or e.g. "wi.kind=framework-migrate"`,
    );
  }
  if (trimmed === 'all') return { kind: 'all' };
  const terms = trimmed.split(',').map((t) => parseTerm(t.trim(), sourceFile, line));
  return { kind: 'and', terms };
}

function parseTerm(raw: string, sourceFile: string, line: number): ConstraintTerm {
  const match = TERM_PATTERN.exec(raw);
  if (!match) {
    throw new Error(
      `${sourceFile}:${line}: malformed applies_to term "${raw}" — expected "wi.<field>=<glob>" or ` +
        `"manifest.<field>=<glob>"`,
    );
  }
  const [, namespace, field, glob] = match;
  if (!NAMESPACES.has(namespace!)) {
    throw new Error(
      `${sourceFile}:${line}: unknown applies_to namespace "${namespace}" in term "${raw}" — must be ` +
        `"wi" or "manifest"`,
    );
  }
  if (glob!.length === 0) {
    throw new Error(`${sourceFile}:${line}: empty glob value in applies_to term "${raw}"`);
  }
  return { namespace: namespace as 'wi' | 'manifest', field: field!, glob: glob! };
}

/** Convert a `*`-only glob into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Selector-match context: the plain field-value maps a clause is tested against. */
export type ConstraintMatchContext = {
  wi: Record<string, unknown>;
  manifest: Record<string, unknown>;
};

export function selectorMatches(selector: ConstraintSelector, ctx: ConstraintMatchContext): boolean {
  if (selector.kind === 'all') return true;
  return selector.terms.every((term) => fieldMatches(ctx[term.namespace][term.field], term.glob));
}

function fieldMatches(value: unknown, glob: string): boolean {
  if (value === undefined || value === null) return false;
  const regex = globToRegExp(glob);
  if (Array.isArray(value)) return value.some((v) => regex.test(String(v)));
  return regex.test(String(value));
}

/**
 * Load every constraint block from a project's declared sources: `profile.md`
 * (single file, best-effort — a project without one contributes no blocks)
 * plus every `*.md` file directly under its Brain-3 themes dir
 * (`brain/projects/<project>/themes/`, ADR 018/035), read in sorted filename
 * order for determinism. Missing sources are NOT an error (a project may not
 * have onboarded constraint blocks yet); a malformed block inside a source
 * that DOES exist always is (see `parseConstraintBlocks`), and so is a
 * constraint id reused across two of the project's sources — loud failure
 * beats a silently-dropped (or wrongly-replaced) clause.
 */
export function loadProjectConstraintBlocks(forgeRoot: string, projectName: string): ConstraintBlock[] {
  const blocks: ConstraintBlock[] = [];

  const profilePath = resolve(projectBrainDir(forgeRoot, projectName), 'profile.md');
  if (existsSync(profilePath)) {
    blocks.push(...parseConstraintBlocks(readFileSync(profilePath, 'utf8'), profilePath));
  }

  const themesDir = projectThemesDir(forgeRoot, projectName);
  if (existsSync(themesDir)) {
    const files = readdirSync(themesDir)
      .filter((f) => f.endsWith('.md'))
      .sort();
    for (const file of files) {
      const full = resolve(themesDir, file);
      blocks.push(...parseConstraintBlocks(readFileSync(full, 'utf8'), full));
    }
  }

  // Cross-source duplicate-id check (within-source duplicates already threw in
  // parseConstraintBlocks). The id is the injector's idempotency key, so a
  // collision would make one clause silently replace the other in WI bodies.
  const byId = new Map<string, ConstraintBlock>();
  for (const block of blocks) {
    const first = byId.get(block.id);
    if (first) {
      throw new Error(
        `duplicate constraint id "${block.id}" across project sources: first defined in ` +
          `${first.sourceFile}:${first.startLine}, redefined in ${block.sourceFile}:${block.startLine} — ` +
          `constraint ids must be unique within a project's sources`,
      );
    }
    byId.set(block.id, block);
  }

  return blocks;
}
