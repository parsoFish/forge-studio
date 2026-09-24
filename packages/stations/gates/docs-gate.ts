/**
 * `forge gate docs` — the docs class's merge-boundary gate, as an ORCHESTRATOR
 * VERB (spec §5 item 6, ADR 036).
 *
 * WHY A VERB AND NOT A `quality_gate_cmd`. The class profile gives `docs` an
 * EMPTY `mergeBoundaryTest` — there is no `testProcess.*` to run, because a
 * prose change has no suite — and names this verb instead. If the gate were a
 * command string an agent could author, the agent writing the docs would also
 * be writing the test that judges them; the loop-design-check red line. The
 * orchestrator runs this; nothing an agent writes decides whether it passed.
 *
 * THREE CHECKS, each with a failure mode taken from a real defect:
 *
 *   sections   A required heading is missing. Cheap, and it is what "the doc
 *              was rewritten and the Contract section vanished" looks like.
 *   forbidden  A retired term survives. Matched on WORD BOUNDARIES, because the
 *              substring form is how a token check earns its own suppression:
 *              `zep` inside `zeppelin` is not a hit, and a check that says it is
 *              gets an allowlist entry, and the allowlist is where the rule goes
 *              to die (§15.41's shape through a different door).
 *   links      A relative link resolves to nothing on disk. The docs equivalent
 *              of a green test over a file that does not exist.
 *
 * Every finding carries `path:line`, because a gate that reports a count sends
 * its reader looking (§15.92).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

export type DocsGateFinding = { path: string; line: number; check: 'sections' | 'forbidden' | 'links'; detail: string };

export type DocsGateSpec = {
  /** Headings that must be present, matched on the heading TEXT, any level. */
  sections?: readonly string[];
  /** Terms that must not appear, matched case-insensitively on word boundaries. */
  forbidden?: readonly string[];
  /** Check that relative markdown links resolve on disk. Default true. */
  links?: boolean;
};

const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/;
/** `[text](target)` — the target only, and only the inline form. */
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** True for a link target this gate can check on disk. */
function isCheckableLink(target: string): boolean {
  if (target.startsWith('#')) return false;                 // in-page anchor
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false;    // http:, mailto:, etc.
  return !isAbsolute(target);
}

/**
 * Run the gate over already-read documents. Pure: the caller reads the files,
 * so the rules are testable without a filesystem and the verb stays a thin
 * shell around them.
 */
export function docsGateFindings(
  docs: ReadonlyArray<{ path: string; content: string }>,
  spec: DocsGateSpec,
): DocsGateFinding[] {
  const findings: DocsGateFinding[] = [];
  const forbiddenRe =
    spec.forbidden && spec.forbidden.length > 0
      ? new RegExp(`\\b(${spec.forbidden.map(escapeForRegExp).join('|')})\\b`, 'gi')
      : null;

  for (const doc of docs) {
    const lines = doc.content.split('\n');

    if (spec.sections && spec.sections.length > 0) {
      const headings = new Set(
        lines.map((l) => HEADING_RE.exec(l)?.[1]?.toLowerCase()).filter((h): h is string => h !== undefined),
      );
      for (const wanted of spec.sections) {
        if (!headings.has(wanted.toLowerCase())) {
          findings.push({ path: doc.path, line: 1, check: 'sections', detail: `required section "${wanted}" is missing` });
        }
      }
    }

    for (const [i, line] of lines.entries()) {
      if (forbiddenRe !== null) {
        forbiddenRe.lastIndex = 0;
        for (const m of line.matchAll(forbiddenRe)) {
          findings.push({ path: doc.path, line: i + 1, check: 'forbidden', detail: `forbidden term "${m[1]}"` });
        }
      }
      if (spec.links !== false) {
        for (const m of line.matchAll(LINK_RE)) {
          const target = m[1]!;
          if (!isCheckableLink(target)) continue;
          const resolved = resolve(dirname(doc.path), target.split('#')[0]!);
          if (!existsSync(resolved)) {
            findings.push({ path: doc.path, line: i + 1, check: 'links', detail: `link target does not resolve: ${target}` });
          }
        }
      }
    }
  }
  return findings;
}

/** Read the documents and run the gate. Exit-code shaped for the CLI verb. */
export function runDocsGate(paths: readonly string[], spec: DocsGateSpec): DocsGateFinding[] {
  return docsGateFindings(
    paths.map((p) => ({ path: p, content: existsSync(p) ? readFileSync(p, 'utf8') : '' })),
    spec,
  );
}

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
