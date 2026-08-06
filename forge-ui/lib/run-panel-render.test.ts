/**
 * DOM regression + acceptance tests for the WI-3 (R6-04) expansion of
 * `RunPanel.tsx` (forge-ui/components/studio/agent-builder/RunPanel.tsx) —
 * the `[data-section="agent-run"]` panel on `/agents/[id]`, expanded IN
 * PLACE, never a new route (see docs/forge-ui-dom-and-harness.md's
 * `/agents/[id]` section and scripts/journeys/agents.mjs lines ~478-501 /
 * 567-573, which drive this exact panel today).
 *
 * These tests render the REAL component via `react-dom/server`'s
 * `renderToStaticMarkup` (react/react-dom are already forge-ui dependencies
 * — no new package added) and assert on the resulting markup string. This
 * catches the initial-render DOM contract (every `data-*` attribute this
 * file's header pins, for every prop combination below) WITHOUT jsdom or
 * `@testing-library/react` — neither is installed in this repo, and this
 * suite intentionally does not add them. `useEffect`/interaction (polling,
 * click handlers, file-input change events) do not run under
 * `renderToStaticMarkup`; those behaviours are pinned separately, as PURE
 * LOGIC, in `./run-panel-view.test.ts` (see that file's header for exactly
 * which contract it covers and why click-simulation itself is out of reach
 * here).
 *
 * TEST-WORLD NOTE: this file requires two additions to
 * `forge-ui/vitest.config.ts` (`resolve.alias['@']` and `oxc.jsx:
 * 'automatic'`) which this same test-writer pass added — see that file's
 * diff. Both are zero-new-dependency config additions (react/react-dom are
 * already installed); the full existing forge-ui vitest suite (28 files /
 * 431 tests before this file) was re-run after the change and stayed green.
 * Without `resolve.alias`, RunPanel's own `@/lib/studio-client` import
 * cannot resolve under vitest; without `oxc.jsx: 'automatic'`, vitest's
 * default JSX handling defers to tsconfig.json's `"jsx": "preserve"`
 * (Next.js's own convention, meant for the Next/SWC compiler) and errors
 * parsing RunPanel.tsx's JSX outright.
 *
 * NEW PROPS this file pins as the contract the implementer must build to
 * (RunPanel's `Props` type today has only `slug`/`interactive`/`canRun`/
 * `blockedMessage` — see that file's header comment, which explicitly calls
 * those four attributes "a contract other initiatives depend on"):
 *
 *   projects: { id: string; name: string }[]
 *   declaredMaterialKinds: string[]        // from capability.materials
 *   defaultCostCeilingUsd: number          // GET /api/studio/agents' top-level sibling field
 *   costCeilingEnforceable: boolean        // from capability.costCeilingEnforceable
 *   sessionEntryHref?: string | null       // real session route for an interactive agent, or null/absent
 *
 * NEW data-* HOOKS this file pins (none of these exist in RunPanel.tsx today
 * — every assertion using them is a legitimate RED against the current file):
 *
 *   [data-run-project]                         <select> project picker (replaces the free-text input)
 *   [data-component="cost-ceiling"]
 *     [data-ceiling-enforceable="true"|"false"] wraps the ceiling controls
 *   [data-run-cost-ceiling]                    <input type="number"> the ceiling value
 *   [data-component="ceiling-explanation"]     shown only when NOT enforceable
 *   [data-section="materials-attach"]
 *     [data-materials-declared="<comma-joined declaredMaterialKinds>"]
 *   [data-run-materials-input]                 <input type="file">
 *   [data-action="go-to-session"]              interactive-agent Run affordance (real entry point)
 *   [data-component="session-entry-missing"]   interactive-agent, no reachable entry point
 *
 * RUN: npx vitest run lib/run-panel-render.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RunPanel } from '@/components/studio/agent-builder/RunPanel';
import { MATERIAL_KINDS } from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// Rendering + tiny string-based DOM helpers (test-local; RunPanel itself is
// untouched — this file only reads its output).
// ---------------------------------------------------------------------------

type Project = { id: string; name: string };

type Props = {
  slug: string;
  interactive: boolean;
  canRun: boolean;
  blockedMessage: string;
  projects: Project[];
  declaredMaterialKinds: string[];
  defaultCostCeilingUsd: number;
  costCeilingEnforceable: boolean;
  sessionEntryHref?: string | null;
};

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    slug: 'test-agent',
    interactive: false,
    canRun: true,
    blockedMessage: '',
    projects: [{ id: 'gitpulse', name: 'GitPulse' }, { id: 'mdtoc', name: 'mdtoc' }],
    declaredMaterialKinds: ['images', 'documents'],
    defaultCostCeilingUsd: 10,
    costCeilingEnforceable: true,
    sessionEntryHref: null,
    ...overrides,
  };
}

function render(overrides: Partial<Props> = {}): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToStaticMarkup(React.createElement(RunPanel as any, baseProps(overrides)));
}

/** Return the smallest `<tag ...>` substring containing `marker`. Assumes no
 *  nested `<`/`>` inside attribute values (true for this component's plain
 *  string/number/boolean attrs) — sufficient for pinning purposes without a
 *  real DOM parser. */
function tagContaining(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  if (start === -1 || end === -1) return '';
  return html.slice(start, end + 1);
}

function count(html: string, substr: string): number {
  return html.split(substr).length - 1;
}

// ---------------------------------------------------------------------------
// REGRESSION — every attribute RunPanel.tsx's own header calls "a contract
// other initiatives depend on" must survive byte-identically. Each assertion
// here is a pin against the EXISTING file, so it should already be GREEN —
// its purpose is to fail LOUDLY the moment WI-3's expansion drops or renames
// one of these (per the task brief's explicit ask).
// ---------------------------------------------------------------------------

test('REGRESSION: non-interactive, unblocked — data-section, data-run-dispatchable, data-run-id, data-run-status, data-run-cost, data-run-blocked all present with idle values', () => {
  const html = render({ interactive: false, canRun: true, blockedMessage: '' });
  expect(html).toContain('data-section="agent-run"');
  expect(html).toContain('data-run-dispatchable="true"');
  expect(html).toContain('data-run-id=""');
  expect(html).toContain('data-run-status="idle"');
  expect(html).toContain('data-run-cost="0"');
  expect(html).toContain('data-run-blocked="false"');
});

test('REGRESSION: data-run-inputs textarea still present for a non-interactive agent', () => {
  const html = render({ interactive: false });
  expect(html).toContain('data-run-inputs');
});

test('REGRESSION: data-action="run-agent" button still present for a non-interactive agent, exactly once', () => {
  const html = render({ interactive: false });
  expect(count(html, 'data-action="run-agent"')).toBe(1);
});

test('REGRESSION: blockedMessage renders data-run-blocked="true" and data-component="connection-run-block" with the message VERBATIM', () => {
  // No embedded double-quotes here deliberately — renderToStaticMarkup HTML-
  // escapes them to `&quot;` in both the `title` attribute and the <p> text
  // node, and this pin only needs to prove verbatim passthrough + presence,
  // not re-derive React's own attribute/text escaping rules.
  const message = 'mcp memory-connector not-ready';
  const html = render({ interactive: false, blockedMessage: message });
  expect(html).toContain('data-run-blocked="true"');
  expect(html).toContain('data-component="connection-run-block"');
  expect(html).toContain(message);
});

test('REGRESSION: interactive agent still renders data-section="agent-run" data-run-dispatchable="false"', () => {
  const html = render({ interactive: true, sessionEntryHref: '/sessions/instructions/sess-1' });
  expect(html).toContain('data-section="agent-run"');
  expect(html).toContain('data-run-dispatchable="false"');
});

// ---------------------------------------------------------------------------
// NEW — project select (replaces the free-text project input)
// ---------------------------------------------------------------------------

test('project select: [data-run-project] present, free-text placeholder input GONE — kills "kept the old text input and just added a datalist"', () => {
  const html = render({ canRun: true });
  expect(html).toContain('data-run-project');
  expect(html).not.toContain('placeholder="project (optional)"');
});

test('project select: lists the REAL projects prop, not a hardcoded list — kills "static hardcoded project list ignoring the prop"', () => {
  const projectsA = [{ id: 'alpha', name: 'Alpha Project' }];
  const projectsB = [{ id: 'beta', name: 'Beta Project' }, { id: 'gamma', name: 'Gamma Project' }];
  const htmlA = render({ projects: projectsA });
  const htmlB = render({ projects: projectsB });
  expect(htmlA).toContain('alpha');
  expect(htmlA).toContain('Alpha Project');
  expect(htmlA).not.toContain('Beta Project');
  expect(htmlB).toContain('beta');
  expect(htmlB).toContain('Beta Project');
  expect(htmlB).toContain('gamma');
  expect(htmlB).toContain('Gamma Project');
  expect(htmlB).not.toContain('Alpha Project');
});

// ---------------------------------------------------------------------------
// NEW — editable cost ceiling, pre-filled from defaultCostCeilingUsd
// (never a hardcoded number in the component)
// ---------------------------------------------------------------------------

test('cost ceiling: [data-run-cost-ceiling] pre-filled from the defaultCostCeilingUsd PROP — kills a hardcoded literal in the component', () => {
  const htmlSeven = render({ costCeilingEnforceable: true, defaultCostCeilingUsd: 7.5 });
  const htmlFortyTwo = render({ costCeilingEnforceable: true, defaultCostCeilingUsd: 42 });
  const tagSeven = tagContaining(htmlSeven, 'data-run-cost-ceiling');
  const tagFortyTwo = tagContaining(htmlFortyTwo, 'data-run-cost-ceiling');
  expect(tagSeven).toContain('7.5');
  expect(tagFortyTwo).toContain('42');
  // A hardcoded literal (e.g. always 10, the server's DEFAULT_KICKOFF_COST_CEILING_USD
  // fallback) would make these two renders' ceiling values identical regardless
  // of the prop — assert they differ.
  expect(tagSeven).not.toBe(tagFortyTwo);
});

test('cost ceiling: costCeilingEnforceable=true -> data-ceiling-enforceable="true", input NOT disabled', () => {
  const html = render({ costCeilingEnforceable: true });
  expect(html).toContain('data-ceiling-enforceable="true"');
  const inputTag = tagContaining(html, 'data-run-cost-ceiling');
  expect(inputTag).not.toContain('disabled');
});

test('cost ceiling: costCeilingEnforceable=false -> data-ceiling-enforceable="false", input DISABLED, explanation rendered — an operator must never be able to submit a ceiling that will be refused', () => {
  const html = render({ costCeilingEnforceable: false });
  expect(html).toContain('data-ceiling-enforceable="false"');
  const inputTag = tagContaining(html, 'data-run-cost-ceiling');
  expect(inputTag).toContain('disabled');
  expect(html).toContain('data-component="ceiling-explanation"');
  // The explanation must carry actual prose, not an empty/decorative element.
  const explanationTag = tagContaining(html, 'data-component="ceiling-explanation"');
  const afterOpenTag = html.slice(html.indexOf(explanationTag) + explanationTag.length);
  const closeIdx = afterOpenTag.search(/<\/(p|div|span)>/);
  const innerText = closeIdx === -1 ? '' : afterOpenTag.slice(0, closeIdx);
  expect(innerText.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// NEW — materials attach section, driven by declaredMaterialKinds (the
// DESCRIPTOR), never MATERIAL_KINDS (the full closed vocabulary) directly.
// ---------------------------------------------------------------------------

test('materials attach: [data-section="materials-attach"] and [data-run-materials-input] file input present', () => {
  const html = render({ declaredMaterialKinds: ['images', 'audio'] });
  expect(html).toContain('data-section="materials-attach"');
  expect(html).toContain('data-run-materials-input');
});

test('materials attach: declared kinds come from the descriptor PROP, not the full hardcoded MATERIAL_KINDS vocabulary — kills "always advertises every kind regardless of what the agent declared"', () => {
  const htmlImagesOnly = render({ declaredMaterialKinds: ['images'] });
  const htmlAudioOnly = render({ declaredMaterialKinds: ['audio'] });
  // Sanity: MATERIAL_KINDS has more than one member, so "always all of them"
  // is a real, distinguishable wrong implementation this test can catch.
  expect(MATERIAL_KINDS.length).toBeGreaterThan(1);
  const tagImages = tagContaining(htmlImagesOnly, 'data-section="materials-attach"');
  const tagAudio = tagContaining(htmlAudioOnly, 'data-section="materials-attach"');
  expect(tagImages).toContain('images');
  expect(tagImages).not.toContain('audio');
  expect(tagAudio).toContain('audio');
  expect(tagAudio).not.toContain('images');
});

test('materials attach: an agent that declares NO materials renders a structurally distinct (empty-declared) state, not a silently-permissive default', () => {
  const html = render({ declaredMaterialKinds: [] });
  expect(html).toContain('data-section="materials-attach"');
  expect(html).toContain('data-materials-declared=""');
});

// ---------------------------------------------------------------------------
// NEW — one Run affordance, interactive agents get a real entry point or an
// explicit "no reachable entry point" — never a fabricated link.
// ---------------------------------------------------------------------------

test('interactive agent WITH a real session entry point: exactly one [data-action="go-to-session"] link, with the EXACT href given — never fabricated/transformed', () => {
  const href = '/sessions/instructions/sess-42';
  const html = render({ interactive: true, sessionEntryHref: href });
  expect(count(html, 'data-action="go-to-session"')).toBe(1);
  const anchorTag = tagContaining(html, 'data-action="go-to-session"');
  expect(anchorTag).toContain(`href="${href}"`);
  // No run-agent dispatch button on the interactive path.
  expect(html).not.toContain('data-action="run-agent"');
});

test('interactive agent with NO reachable entry point (sessionEntryHref: null): NO link is rendered at all, and the panel says so explicitly — kills "always renders a link even when there is nowhere real to send it"', () => {
  const html = render({ interactive: true, sessionEntryHref: null });
  expect(html).not.toMatch(/<a\b/i);
  expect(html).not.toContain('data-action="go-to-session"');
  expect(html).toContain('data-component="session-entry-missing"');
});

test('interactive agent, sessionEntryHref OMITTED (undefined, not explicitly null) behaves identically to null — defensive, kills "only handles null, mishandles undefined"', () => {
  const props = baseProps({ interactive: true });
  delete (props as { sessionEntryHref?: string | null }).sessionEntryHref;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const html = renderToStaticMarkup(React.createElement(RunPanel as any, props));
  expect(html).not.toMatch(/<a\b/i);
  expect(html).toContain('data-component="session-entry-missing"');
});

test('exactly one Run affordance for a non-interactive, unblocked agent: one data-action="run-agent" button, zero go-to-session links', () => {
  const html = render({ interactive: false, canRun: true, blockedMessage: '' });
  expect(count(html, 'data-action="run-agent"')).toBe(1);
  expect(count(html, 'data-action="go-to-session"')).toBe(0);
});
