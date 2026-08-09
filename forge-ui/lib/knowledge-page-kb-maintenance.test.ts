/**
 * knowledge-page-kb-maintenance.test.ts — R1-06 WI-3 group B (1): the
 * `/knowledge` page's KB-maintenance action bar gains a
 * `[data-action="kb-maintain-session"]` button inside
 * `[data-component="kb-maintenance"]` (R1-06-F3 "Maintenance ops
 * contract" — the KB-page entry point for the consolidate-process
 * maintenance session; see docs/roadmaps/R1-contract-componentry.md
 * lines ~213-227). Today (forge-ui/app/knowledge/page.tsx:298-351) that
 * block renders exactly three actions: `kb-lint`, `kb-index`, `kb-delete`.
 *
 * WHY THIS IS A SOURCE-TEXT TEST, NOT A `renderToStaticMarkup` RENDER TEST
 * (spike proved empirically, not assumed):
 *
 *   `KbMaintenance` is a private, non-exported function defined inside
 *   `app/knowledge/page.tsx`; the page's only export is the default
 *   `KnowledgePage`, which wraps `KnowledgePageInner` in `<Suspense>`.
 *   `KnowledgePageInner` calls `useSearchParams()` directly in its body and
 *   only ever reaches a non-empty `currentId` (the gate on
 *   `{currentId && (<KbMaintenance .../>)}`, page.tsx:221) via a
 *   `useEffect` that resolves `fetchStudioKbs()`. `renderToStaticMarkup`
 *   never runs effects, so `currentId` stays `''` on every synchronous
 *   render pass and `KbMaintenance` never appears in the markup — proven by
 *   spiking exactly this render (`next/navigation` mocked with a working
 *   `useSearchParams`/`usePathname`) against the CURRENT file: the output is
 *   634 bytes of nav-chrome + the Suspense fallback ("Loading…"), and
 *   `html.includes('kb-maintenance')` is `false`. That is a structural
 *   property of the page's data-fetch gating, true identically whether or
 *   not `kb-maintain-session` exists — so a full-page render test cannot
 *   serve as this RED's proof (it would fail for the same reason before AND
 *   after the fix, i.e. it is not a test of the missing feature).
 *
 *   This file instead reads the REAL `app/knowledge/page.tsx` source and
 *   isolates the exact `KbMaintenance` function body via brace-matching
 *   (not a bare substring search over the whole file — that would pass
 *   trivially if the string appeared anywhere, e.g. in a comment). Every
 *   `data-action`/`data-component` value asserted on here is a STATIC JSX
 *   string attribute (no interpolation), so the source text these buttons
 *   are written as IS the DOM they render — a faithful, non-lossy proxy for
 *   the real production call path (the KbMaintenance component actually
 *   shipped in the running app), for exactly this "does this static markup
 *   exist" question.
 *
 * RUN: cd forge-ui && npx vitest run lib/knowledge-page-kb-maintenance.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_PATH = resolve(__dirname, '../app/knowledge/page.tsx');

/** Isolate the body of `function <name>(` in `source` via brace-matching,
 *  starting from the function's opening `{` through its matching closer.
 *  Throws (loudly, not a silent empty-string) if the function isn't found —
 *  a missing anchor must fail LOUD, never be mistaken for "block is empty". */
function extractFunctionBody(source: string, fnName: string): string {
  const sigStart = source.indexOf(`function ${fnName}(`);
  if (sigStart === -1) {
    throw new Error(`extractFunctionBody: "function ${fnName}(" not found in ${PAGE_PATH}`);
  }
  // Walk the PARAMETER LIST's own parens first (paren-depth, not brace-depth)
  // — a destructured param like `{ kbId, onDeleted }: { ... }` contains
  // braces of its own, so the function body's `{` is the FIRST `{` found
  // AFTER the parameter list's matching `)`, not the first `{` in the file.
  const parenOpenIdx = source.indexOf('(', sigStart);
  let parenDepth = 0;
  let parenCloseIdx = -1;
  for (let i = parenOpenIdx; i < source.length; i++) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) { parenCloseIdx = i; break; }
    }
  }
  if (parenCloseIdx === -1) {
    throw new Error(`extractFunctionBody: unbalanced parens walking "function ${fnName}("'s parameter list`);
  }
  const openIdx = source.indexOf('{', parenCloseIdx);
  if (openIdx === -1) {
    throw new Error(`extractFunctionBody: no opening brace found after "function ${fnName}("'s parameter list`);
  }
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  throw new Error(`extractFunctionBody: unbalanced braces walking "function ${fnName}("`);
}

describe('knowledge page — KbMaintenance action bar (R1-06 WI-3 group B, 1)', () => {
  const source = readFileSync(PAGE_PATH, 'utf8');
  const block = extractFunctionBody(source, 'KbMaintenance');

  it('precondition: the extracted block really is the kb-maintenance component (regression-anchors the extraction itself)', () => {
    // These three MUST be true today, independent of this WI — if they are
    // not, extractFunctionBody found the wrong block (or none), and the RED
    // below would be meaningless.
    expect(block).toContain('data-component="kb-maintenance"');
    expect(block).toContain('data-action="kb-lint"');
    expect(block).toContain('data-action="kb-index"');
    expect(block).toContain('data-action="kb-delete"');
  });

  it('RED: renders a [data-action="kb-maintain-session"] entry inside [data-component="kb-maintenance"] (R1-06-F3 maintenance-session entry point — missing today)', () => {
    expect(block).toContain('data-action="kb-maintain-session"');
  });
});
