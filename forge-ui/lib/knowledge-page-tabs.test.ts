/**
 * knowledge-page-tabs.test.ts — R6-08 WI-3 (F1 Explore surface + tabs) RED
 * pins (T3). Mirrors forge-ui/lib/knowledge-page-kb-maintenance.test.ts's
 * source-text + brace-matching technique — see that file's header for the
 * proven reason `/knowledge`'s page.tsx cannot be render-tested
 * (`useSearchParams` + effect-gated `currentId` never resolve under
 * `renderToStaticMarkup`; spiked and confirmed there, not assumed here).
 *
 * Pins:
 *   RULING 5 (URL-synced `?tab=`) —
 *     RED-H: page.tsx defines a tab bar with
 *       data-tab="explore" | "health" | "ingest-activity" + data-tab-active.
 *     RED-J (tab half): page.tsx reads the tab param from searchParams
 *       (`?tab=`).
 *   F1 (LintResolutionPanel/GuidancePanel/KbHealth move under Health tab;
 *   W6-B13 replaces LintResolutionPanel with KbDrainPanel — the anchor below
 *   was updated in place rather than dropped, since the STRUCTURAL claim it
 *   pins (the Health-tab component is nested under a `tab === 'health'`
 *   conditional, not merely gated on `currentId`) is unchanged by which
 *   component fills that slot) —
 *     RED-I: `<KbDrainPanel` (today gated ONLY by `{currentId && (`,
 *       page.tsx:278-279 — unconditional with respect to any tab) is
 *       textually nested under a health-tab conditional.
 *   RULING 1 (`?theme=` thin alias onto the existing `?node=` machinery,
 *   theme nodes only) —
 *     RED-J (theme half): page.tsx reads a `theme` param from searchParams
 *       (deep-link).
 *
 * RUN: cd forge-ui && npx vitest run lib/knowledge-page-tabs.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_PATH = resolve(__dirname, '../app/knowledge/page.tsx');

/**
 * Copied verbatim from knowledge-page-kb-maintenance.test.ts (a private,
 * non-exported helper there — not importable, so mirrored here rather than
 * duplicated-and-drifted). Isolates the body of `function <name>(` in
 * `source` via brace-matching, starting from the function's opening `{`
 * through its matching closer. Throws (loudly, not a silent empty string) if
 * the function isn't found — a missing anchor must fail LOUD, never be
 * mistaken for "block is empty".
 */
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

describe('knowledge page — tab bar (R6-08 WI-3, RULING 5)', () => {
  const source = readFileSync(PAGE_PATH, 'utf8');

  it('RED: defines data-tab="explore"', () => {
    expect(source).toContain('data-tab="explore"');
  });

  it('RED: defines data-tab="health"', () => {
    expect(source).toContain('data-tab="health"');
  });

  it('RED: defines data-tab="ingest-activity"', () => {
    expect(source).toContain('data-tab="ingest-activity"');
  });

  it('RED: exposes data-tab-active for the current tab', () => {
    expect(source).toContain('data-tab-active');
  });
});

describe('knowledge page — Health tab gating (R6-08 WI-3, F1)', () => {
  const source = readFileSync(PAGE_PATH, 'utf8');
  const block = extractFunctionBody(source, 'KnowledgePageInner');

  it('precondition: KbDrainPanel really is rendered in KnowledgePageInner today (regression-anchors the extraction before trusting the RED below)', () => {
    expect(block).toContain('<KbDrainPanel');
  });

  it('RED: <KbDrainPanel is nested under a health-tab conditional, not merely gated on currentId', () => {
    const idx = block.indexOf('<KbDrainPanel');
    expect(idx).toBeGreaterThan(-1);
    // W7-B2 widened the sniff window: the KbActionGroup block now sits
    // between the health-tab conditional and the drain panel — the panel is
    // still nested under `tab === 'health'`, just further from it.
    const before = block.slice(Math.max(0, idx - 1400), idx);
    expect(before).toMatch(/tab\s*===\s*['"]health['"]/);
  });
});

describe('knowledge page — ?tab= URL sync + ?theme= deep-link alias (R6-08 WI-3, RULING 5 + RULING 1)', () => {
  const source = readFileSync(PAGE_PATH, 'utf8');

  it('RED: reads the tab param from searchParams (?tab=)', () => {
    expect(source).toMatch(/searchParams\.get\(\s*['"]tab['"]\s*\)/);
  });

  it('RED: reads a theme param from searchParams (?theme= deep-link, thin alias onto ?node=)', () => {
    expect(source).toMatch(/searchParams\.get\(\s*['"]theme['"]\s*\)/);
  });
});
