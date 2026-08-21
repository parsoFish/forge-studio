/**
 * W7-C3 — a11y token + focus contract on `app/globals.css` (crosscut-17,
 * crosscut-24, sessions-kinds-V02).
 *
 * Pins, computed from the REAL stylesheet (no fixture copy):
 *   1. `--faint` — the metadata-text token — meets WCAG 2.1 AA (≥ 4.5:1)
 *      against every surface it is painted on (`--bg`, `--panel`,
 *      `--panel-2`). Before this pin it scored 2.78–3.37:1 (crosscut-24).
 *   2. `--accent` is a DEFINED token. Ten components paint primary
 *      actions with `var(--accent)`; undefined, it resolved to transparent
 *      and the primary CTA rendered recessive (sessions-kinds-V02).
 *   3. A GLOBAL `:focus-visible` rule exists — not one scoped to
 *      `.btn/.chip/.tab/a` — so native `<input>/<select>/<textarea>` get a
 *      visible keyboard focus ring (crosscut-17, WCAG 2.4.7).
 *   4. The input-family selectors no longer kill the outline: no
 *      `outline: none` inside the `.input`, `.agent-select-wrap select`,
 *      or `.agent-name-input` blocks (their old border-color:focus
 *      substitute rendered no visible change).
 *
 * RUN: cd forge-ui && npx vitest run lib/a11y-tokens.test.ts
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token ${name} not defined in globals.css`);
  return m[1].trim();
}

function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const chan = [0, 2, 4]
    .map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [hexLuminance(a), hexLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('crosscut-24: --faint meets AA (>=4.5:1) on every surface it is painted on', () => {
  const faint = token('--faint');
  for (const surface of ['--bg', '--panel', '--panel-2']) {
    const r = contrast(faint, token(surface));
    expect(r, `--faint (${faint}) on ${surface} (${token(surface)}) = ${r.toFixed(3)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});

test('sessions-kinds-V02: --accent is a defined token (primary CTAs paint var(--accent))', () => {
  // Either a literal color or an alias of another defined token.
  const accent = token('--accent');
  expect(accent.length).toBeGreaterThan(0);
  if (accent.startsWith('var(')) {
    const inner = accent.match(/var\((--[a-z0-9-]+)/i)?.[1];
    expect(inner, `--accent aliases ${inner} which must itself be defined`).toBeTruthy();
    expect(() => token(inner as string)).not.toThrow();
  } else {
    expect(accent).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  }
});

test('crosscut-17: a GLOBAL :focus-visible rule exists (not scoped to .btn/.chip/.tab/a)', () => {
  // A selector list where :focus-visible applies to EVERY element — the bare
  // pseudo-class (`:focus-visible {`) or the universal form
  // (`*:focus-visible`). The old rule scoped it to :is(.btn,.chip,.tab,a).
  const global = /(^|\n)\s*(\*)?:focus-visible[^{,]*\{/.test(css);
  expect(global, 'globals.css must carry a bare/universal :focus-visible rule').toBe(true);
});

test('crosscut-17: input-family blocks no longer set outline: none', () => {
  const blockOf = (selectorRe: RegExp): string => {
    const m = css.match(selectorRe);
    if (!m || m.index === undefined) return '';
    const open = css.indexOf('{', m.index);
    const close = css.indexOf('}', open);
    return css.slice(open, close);
  };
  const blocks: Array<[string, RegExp]> = [
    ['.input', /\n\.input,\s*textarea\.input\s*\{/],
    ['.agent-select-wrap select', /\n\.agent-select-wrap select\s*\{/],
    ['.agent-name-input', /\n\.agent-name-input\s*\{/],
  ];
  for (const [name, re] of blocks) {
    const body = blockOf(re);
    expect(body.length, `selector block ${name} not found`).toBeGreaterThan(0);
    expect(body, `${name} must not kill the focus outline`).not.toMatch(/outline:\s*none/);
  }
});

// ---------------------------------------------------------------------------
// crosscut-18: the skip link's own target. A skip link is worse than no skip
// link when it reads as provided and skips nowhere — so the fragment it
// advertises must actually resolve. W7-C3 review (A-H2/A-H3) replaced the
// runtime stamp with a DECLARED id on every route's own `<main>`; the
// rendered-output proof and the app-wide enumeration live in
// `lib/main-landmark.test.ts`. This file keeps the source-side half: the
// link and the markup must read the SAME constant, and nothing may write the
// id back at runtime (that is what clobbered `#col-center` and died the
// moment a route swapped its `<main>`).
// ---------------------------------------------------------------------------

test('crosscut-18: the skip link targets the DECLARED landmark id, and stamps nothing', () => {
  const src = readFileSync(resolve(__dirname, '../components/SkipLink.tsx'), 'utf8');
  expect(src, 'the target fragment must be ONE shared constant, not a literal that can drift')
    .toMatch(/import \{ MAIN_CONTENT_ID \} from '@\/lib\/main-landmark'/);
  expect(src, 'href must be built from MAIN_CONTENT_ID').toMatch(/href=\{`#\$\{MAIN_CONTENT_ID\}`\}/);
  expect(src, 'the id must be declared in the markup, never written at runtime')
    .not.toMatch(/setAttribute\(\s*'id'/);
  expect(src, 'a pathname-keyed effect cannot see a <main> swap — the declared id replaced it')
    .not.toMatch(/usePathname/);
});
