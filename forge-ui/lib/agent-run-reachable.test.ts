/**
 * Acceptance test — the Run control on `/agents/[id]` is reachable WITHOUT
 * SCROLLING, including without scrolling *inside the panel itself*.
 *
 * ── why this file was rewritten (W8-F4, ON-8) ─────────────────────────────
 * The wave-8 exit gate's hostile re-verification broke the previous version
 * of this file. Its five assertions were source greps for the sticky IDIOM
 * (`position:'sticky'`, `top:0`, `maxHeight:'calc(100vh`, `overflowY:'auto'`,
 * DOM order). The refuter mirrored the tree and injected ONE mutation —
 * `paddingTop: 4000` into `RUN_PANEL_STYLE`, putting the button 4000 px down
 * inside the panel's own scroll region — and the file stayed **5/5 green**.
 * The browser half was blind too: `scripts/journeys/agents.mjs` measured
 * `getBoundingClientRect()` of the PANEL (`[data-section="agent-run"]`), which
 * straddles the fold happily while the control inside it is off screen. Their
 * verdict, verbatim: "BOTH GATES GREEN, CONTROL OFF SCREEN => neither gate can
 * fail if the claim is false."
 *
 * The panel's own comment stated the fallacy out loud — "Bounded, it scrolls
 * internally and the button stays reachable". Internal scrolling is
 * reachable-BY-scrolling, which is the opposite of the claim being made.
 *
 * ── what this file pins now ───────────────────────────────────────────────
 * It renders the REAL `RunPanel` (`react-dom/server`'s `renderToStaticMarkup`,
 * the same zero-new-dependency shape `lib/run-panel-render.test.ts` already
 * uses) and walks the ANCESTOR CHAIN of `[data-action="run-agent"]` with a
 * tiny tag-stack parser. Two structural facts, both of which the mutations
 * above violate:
 *
 *   1. NO ancestor of the dispatch control, up to the panel root, is a scroll
 *      container. The form (project picker, inputs, ceiling, materials, the
 *      live run log) lives in a sibling scroll region; the control does not.
 *      => "the button was pushed down by content" is no longer expressible,
 *      because content growth cannot move it at all.
 *   2. NO ancestor of the dispatch control declares more than
 *      `MAX_ANCESTOR_VERTICAL_OFFSET_PX` of vertical padding / margin / top
 *      offset. This is the GENERIC form of the refuter's 4000 px mutation:
 *      it does not matter which element in the chain the 4000 lands on.
 *
 * Fact 1 is what the shipped tree failed. Fact 2 is what the shipped TEST
 * failed. Both are asserted against rendered markup, not against source text,
 * so an idiom rename cannot satisfy them and a layout change cannot dodge them.
 *
 * ── the boundary this file does NOT claim ─────────────────────────────────
 * A static render has no layout engine: nothing here measures pixels. The
 * OUTCOME ("the control's own rect is inside the viewport") is measured in a
 * real browser by `scripts/journeys/agents.mjs`, which now reads
 * `[data-action="run-agent"]`'s own `getBoundingClientRect()` rather than the
 * panel's. This file pins the STRUCTURE that makes that outcome hold for any
 * amount of panel content; the journey pins the outcome itself. Neither is a
 * substitute for the other, and each is proven to go red under the mutation
 * that fooled its predecessor (see `_wave8/lanes/F4-ledger.md`).
 *
 * The walk deliberately stops at the panel root: `.col-right`
 * (`app/globals.css`) is itself an `overflow-y: auto` column, which is exactly
 * what the panel's `position: sticky` exists to survive. Ancestors above the
 * panel are the journey's business, not this file's.
 *
 * RUN: npx vitest run lib/agent-run-reachable.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RunPanel } from '@/components/studio/agent-builder/RunPanel';
import { MATERIAL_KINDS } from '@/lib/studio-client';

const UI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_PAGE = join(UI_ROOT, 'app', 'agents', '[id]', 'page.tsx');
const pageSrc = readFileSync(AGENT_PAGE, 'utf8');

/**
 * The largest vertical padding / margin / `top` any ancestor of the dispatch
 * control may declare.
 *
 * MEASURED, not guessed (immutable-gates: bisect the real limit rather than
 * picking a number that sounds large). After the fix the chain's largest
 * vertical value is the actions row's own padding; the panel root declares
 * `top: 0`. 64 px leaves several times that as headroom for an honest spacing
 * change, while staying an order of magnitude below anything that could
 * displace the control inside the panel's `calc(100vh - 96px)` box on the
 * 1000 px-tall viewport the journey drives. A change that legitimately needs
 * more than this must move this constant DELIBERATELY and re-check the
 * journey's rect measurement in the same PR.
 */
const MAX_ANCESTOR_VERTICAL_OFFSET_PX = 64;

const DISPATCH_CONTROL = 'data-action="run-agent"';
const PANEL_ROOT = 'data-section="agent-run"';

// ---------------------------------------------------------------------------
// A minimal tag-stack parser. `renderToStaticMarkup` escapes `<`, `>`, `"`
// and `&` inside attribute VALUES, so `[^>]*` cannot run past a tag boundary.
// ---------------------------------------------------------------------------

type Element = {
  tag: string;
  attrs: Record<string, string>;
  /** Outermost first, immediate parent last. */
  ancestors: Element[];
};

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2]);
  }
  for (const match of raw.matchAll(/(?:^|\s)([a-zA-Z_:][\w:.-]*)(?=\s|\/?$)/g)) {
    const name = match[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = '';
  }
  return attrs;
}

/** Every element in `html`, each carrying its own ancestor chain. */
function parseElements(html: string): Element[] {
  const out: Element[] = [];
  const stack: Element[] = [];
  for (const match of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [, closing, tagRaw, rest] = match;
    const tag = tagRaw.toLowerCase();
    if (closing === '/') {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const element: Element = { tag, attrs: parseAttrs(rest), ancestors: [...stack] };
    out.push(element);
    if (!VOID_TAGS.has(tag) && !rest.trimEnd().endsWith('/')) stack.push(element);
  }
  return out;
}

function styleOf(element: Element): Record<string, string> {
  const declarations: Record<string, string> = {};
  for (const part of (element.attrs['style'] ?? '').split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    declarations[part.slice(0, idx).trim().toLowerCase()] = part.slice(idx + 1).trim();
  }
  return declarations;
}

function hasAttr(element: Element, marker: string): boolean {
  const idx = marker.indexOf('=');
  if (idx === -1) return marker.toLowerCase() in element.attrs;
  return element.attrs[marker.slice(0, idx).toLowerCase()] === marker.slice(idx + 2, -1);
}

/** `12px` → 12. Anything that is not a plain px/unitless number → null (a
 *  `calc(...)` bound is a bound, not an offset, and is judged separately). */
function px(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(value.trim());
  return match === null ? null : Number.parseFloat(match[1]);
}

/** The top+bottom components of a `padding`/`margin` shorthand, per CSS. */
function verticalShorthand(value: string | undefined): number[] {
  if (value === undefined) return [];
  const parts = value.trim().split(/\s+/);
  const picks = parts.length === 1 ? [parts[0]]
    : parts.length === 2 || parts.length === 3 ? [parts[0], parts[parts.length - 1]]
      : [parts[0], parts[2]];
  return picks.map(px).filter((n): n is number => n !== null);
}

/** Every vertical offset an element contributes above/below its own content. */
function verticalOffsetsOf(element: Element): { prop: string; value: number }[] {
  const style = styleOf(element);
  const found: { prop: string; value: number }[] = [];
  for (const prop of ['padding-top', 'padding-bottom', 'margin-top', 'margin-bottom', 'top', 'height', 'min-height']) {
    const value = px(style[prop]);
    if (value !== null) found.push({ prop, value });
  }
  for (const prop of ['padding', 'margin']) {
    for (const value of verticalShorthand(style[prop])) found.push({ prop, value });
  }
  return found;
}

function scrolls(element: Element): boolean {
  const style = styleOf(element);
  return ['overflow', 'overflow-y'].some((prop) => {
    const value = style[prop];
    return value === 'auto' || value === 'scroll';
  });
}

// ---------------------------------------------------------------------------
// Render the WORST realistic panel: every optional block present, a long
// project list, every declarable material kind. If the control survives this,
// content growth is not what moves it.
// ---------------------------------------------------------------------------

type Props = Parameters<typeof RunPanel>[0];

function renderPanel(overrides: Partial<Props> = {}): string {
  const props = {
    slug: 'a-long-agent-slug-for-reachability',
    interactive: false,
    canRun: true,
    blockedMessage: '',
    projects: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `Managed project number ${i}` })),
    declaredMaterialKinds: [...MATERIAL_KINDS],
    defaultCostCeilingUsd: 12,
    costCeilingEnforceable: true,
    sessionEntryHref: null,
    ...overrides,
  } as Props;
  return renderToStaticMarkup(React.createElement(RunPanel, props));
}

function dispatchControlOf(elements: Element[]): Element {
  const controls = elements.filter((el) => hasAttr(el, DISPATCH_CONTROL));
  expect(controls).toHaveLength(1);
  return controls[0];
}

/** Parse once per render: the assertions below compare element IDENTITY
 *  (`toContain`, `includes`), so two parses of the same markup would silently
 *  never match — an "accidentally passing" test of exactly the kind this file
 *  exists to stop shipping. */
function panelOf(overrides: Partial<Props> = {}): Element[] {
  return parseElements(renderPanel(overrides));
}

/** Panel root first, immediate parent last — the chain the mutations attack. */
function chainInsidePanel(control: Element): Element[] {
  const rootIndex = control.ancestors.findIndex((el) => hasAttr(el, PANEL_ROOT));
  expect(rootIndex).toBeGreaterThan(-1);
  return control.ancestors.slice(rootIndex);
}

// ── 1. the control is not inside a scroll region (the SHIPPED-TREE defect) ──

test('no ancestor of the Run control, up to the panel root, is a scroll container', () => {
  // Kills the shipped tree: RUN_PANEL_STYLE carried `overflowY: 'auto'` on the
  // root itself, so the control sat inside the panel's own scroll region after
  // four form blocks. "Bounded, it scrolls internally and the button stays
  // reachable" is reachable-BY-scrolling — the claim's own negation.
  const chain = chainInsidePanel(dispatchControlOf(panelOf()));
  const scrolling = chain.filter(scrolls).map((el) => `${el.tag}[${el.attrs['style']}]`);
  expect(scrolling).toEqual([]);
});

test('the panel DOES have a scroll region — the form scrolls, in a container the control is not in', () => {
  // Kills the lazy "fix" of deleting the scroll bound altogether: an unbounded
  // panel taller than the viewport is the same defect wearing a third hat.
  // Exactly one element inside the panel scrolls, and the control is outside it.
  const elements = panelOf();
  const control = dispatchControlOf(elements);
  const panelElements = elements.filter(
    (el) => hasAttr(el, PANEL_ROOT) || el.ancestors.some((a) => hasAttr(a, PANEL_ROOT)),
  );
  const scrollRegions = panelElements.filter(scrolls);
  expect(scrollRegions).toHaveLength(1);
  expect(control.ancestors).not.toContain(scrollRegions[0]);
  // and the form really is inside it — otherwise "the form scrolls" is fiction
  const insideScroll = panelElements.filter((el) => el.ancestors.includes(scrollRegions[0]));
  expect(insideScroll.some((el) => hasAttr(el, 'data-run-inputs'))).toBe(true);
  expect(insideScroll.some((el) => hasAttr(el, 'data-run-project'))).toBe(true);
});

test('the panel root is still height-bounded and still pinned to its scrolling column', () => {
  // Kills a silent revert to plain flow positioning: `.col-right` is itself an
  // overflow-y:auto column, so without the sticky pin the whole panel scrolls
  // away and the control goes with it.
  const root = panelOf().find((el) => hasAttr(el, PANEL_ROOT));
  expect(root).toBeDefined();
  const style = styleOf(root as Element);
  expect(style['position']).toBe('sticky');
  expect(px(style['top'])).toBe(0);
  expect(style['max-height']).toMatch(/^calc\(100vh/);
});

// ── 2. no ancestor can displace it (the SHIPPED-TEST defect: MUT-F) ──

test('no ancestor of the Run control declares a vertical offset that could push it out of the panel', () => {
  // Kills the refuter's MUT-F verbatim (`paddingTop: 4000` in RUN_PANEL_STYLE
  // left the previous version of this file 5/5 green) — and every relative of
  // it, because the assertion is over the RENDERED chain, so it does not care
  // WHICH element the space is declared on or what the property is called.
  const chain = chainInsidePanel(dispatchControlOf(panelOf()));
  const offenders: string[] = [];
  for (const element of chain) {
    for (const { prop, value } of verticalOffsetsOf(element)) {
      if (Math.abs(value) > MAX_ANCESTOR_VERTICAL_OFFSET_PX) {
        offenders.push(`<${element.tag}> ${prop}: ${value}px`);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test('the control\'s own container cannot be squeezed out of the bounded panel', () => {
  // Kills the flex-layout inverse of the same defect: an actions row with a
  // shrinkable basis inside a max-height column collapses to nothing when the
  // form is tall, which is "off screen" by another route.
  const chain = chainInsidePanel(dispatchControlOf(panelOf()));
  const actions = chain[chain.length - 1];
  const style = styleOf(actions);
  const flex = style['flex'] ?? '';
  expect(style['flex-shrink'] === '0' || /^0\s+0(\s|$)/.test(flex)).toBe(true);
});

test('NEITHER container in the chain is shrinkable — including the panel root itself', () => {
  // Found by the agents journey's own hit test, in the browser, against the
  // first version of this fix. `.col-right` (app/globals.css) is a COLUMN FLEX
  // container with overflow-y:auto, so its children default to
  // `flex-shrink: 1`: a tall YAML preview compressed this panel toward its
  // min-content height — the body collapses to 0 (minHeight:0), leaving just
  // the actions row — and because the root clips (`overflow: hidden`), the
  // button ended up rendered OUTSIDE its own clip box. Its rect was still
  // inside the viewport, so a rect check alone said "reachable"; the hit test
  // said otherwise, and the real Playwright click returned no runId.
  //
  // Every element on the chain must therefore be unshrinkable, not just the
  // one nearest the button.
  const chain = chainInsidePanel(dispatchControlOf(panelOf()));
  const shrinkable = chain.filter((el) => {
    const style = styleOf(el);
    const flex = style['flex'] ?? '';
    return !(style['flex-shrink'] === '0' || /^0\s+0(\s|$)/.test(flex));
  });
  expect(shrinkable.map((el) => `<${el.tag} ${el.attrs['data-section'] ?? el.attrs['data-run-panel-actions'] !== undefined ? 'actions' : ''}>`)).toEqual([]);
});

test('content growth does not change the control\'s ancestry — the worst panel and the barest one agree', () => {
  // The outcome claim in structural form: whatever the panel is asked to
  // render, the dispatch control hangs off the same non-scrolling container.
  const worst = chainInsidePanel(dispatchControlOf(panelOf({ blockedMessage: 'gitpulse-mcp is not available' })));
  const barest = chainInsidePanel(dispatchControlOf(panelOf({
    projects: [], declaredMaterialKinds: [], costCeilingEnforceable: false,
  })));
  expect(worst.map((el) => el.tag)).toEqual(barest.map((el) => el.tag));
  expect(worst.length).toBeLessThanOrEqual(2); // panel root → actions row
});

// ── 3. order + uniqueness (kept from the previous version: real reverts) ──

test('RunPanel renders BEFORE the YAML preview and the readiness panel', () => {
  // Kills the shipped order (YamlPreview → ReadinessPanel → RunPanel), where
  // the Run control sat third in a scrolling column.
  const run = pageSrc.indexOf('<RunPanel');
  const yaml = pageSrc.indexOf('<YamlPreview');
  const readiness = pageSrc.indexOf('<ReadinessPanel');
  expect(run).toBeGreaterThan(-1);
  expect(yaml).toBeGreaterThan(-1);
  expect(readiness).toBeGreaterThan(-1);
  expect(run).toBeLessThan(yaml);
  expect(run).toBeLessThan(readiness);
});

test('the page mounts exactly ONE RunPanel — reachability is not bought with a second control', () => {
  // Kills the obvious wrong fix: leaving the panel where it was and adding a
  // duplicate Run button at the top. Two controls for one action is its own
  // defect (the operator cannot tell which one is authoritative).
  expect((pageSrc.match(/<RunPanel\b/g) ?? []).length).toBe(1);
});

test('the rendered panel declares exactly one dispatch control', () => {
  // Same class, one level down, and counted on the RENDERED DOM rather than on
  // the source text — the previous version counted source lines and had to
  // special-case its own header comment to avoid reading documentation as a
  // second control. A count that cannot tell code from prose is not a count.
  const controls = panelOf().filter((el) => hasAttr(el, DISPATCH_CONTROL));
  expect(controls).toHaveLength(1);
  expect(controls[0].tag).toBe('button');
});
