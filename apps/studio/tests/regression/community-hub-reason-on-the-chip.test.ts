/**
 * 7.6.84 — `data-hub-reason` must sit on the CHIP BUTTON, not on the count span
 * inside it.
 *
 * WHY THIS DOOR EXISTS, and why the three before it could not have caught the
 * defect. S8 beat 5 reported `data-hub-reason: expected "not-reachable", absent
 * from the page` across runs 5, 6 and 7. Two rounds of fixes went into the
 * SERVER — persisting `meta.hubs`, then moving the enrichment onto the function
 * the route actually calls — and both were real fixes to real gaps that changed
 * the beat's verdict not at all, because the server was never the problem after
 * the first one. Measured end to end on `77935c33` with a token, the way beat 4
 * runs the refresh:
 *
 *   refresh   wrote=true
 *   on disk   {"hubId":"skills-sh","discovered":0,"reason":"not-reachable"}
 *   payload   {"id":"skills-sh",...,"itemCount":0,"reason":"not-reachable"}
 *
 * The value was in the route's own payload. It was the ATTRIBUTE'S NODE that
 * was wrong: it rendered on the count `<span>` inside the button, and
 * `resolveExpectations` (`beats-page.mjs:286`) reads a key from its own element
 * only when EXACTLY ONE element on the page carries it. `data-hub-reason` is
 * emitted for every hub that has a reason — two of the nine in the shipped
 * registry, `skills-sh` and `smithery` — so it falls under the together-rule,
 * and the beat asks for it beside `action`/`hub-id`, which no span carries. No
 * amount of correct data can satisfy that from a child node.
 *
 * So the pin is structural, and it is the kind a unit test on a pure function
 * cannot express: it is about WHICH ELEMENT carries the fact. Every other fact
 * about a hub — its kinds, its item count, whether it is declared-only — was
 * already on the button; the reason is a fact about the same hub and belongs in
 * the same place.
 *
 * Source-text pins rather than rendered-DOM pins, per this directory's standing
 * decision (`community-surface-wiring.test.ts`'s header): forge-ui's vitest
 * environment is `node` and this is a `use client` component whose state
 * arrives from an effect-driven fetch.
 */
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BROWSE_PAGE = resolve(__dirname, '../../app/community/page.tsx');
const DOM_CONTRACT = resolve(__dirname, '../../../../docs/reference/studio-dom-contract.md');

/** Block comments and whole-line `//` comments only — never a mid-line `//`,
 *  which would truncate a line carrying an `https://` URL. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * The text of the opening tag that starts at `from`, ending at the first `>`
 * seen OUTSIDE any `{…}` expression. A naive scan to the first `>` stops on the
 * `=>` inside this button's own `onClick`, which would make every assertion
 * below vacuously pass against a tag it never actually read.
 */
function openingTag(src: string, from: number): string {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0 && src[i - 1] !== '=') return src.slice(from, i + 1);
  }
  throw new Error('unterminated opening tag from index ' + String(from));
}

function hubChipTag(): string {
  const src = stripComments(readFileSync(BROWSE_PAGE, 'utf8'));
  let at = src.indexOf('<button');
  while (at !== -1) {
    const tag = openingTag(src, at);
    if (tag.includes('data-action="filter-hub"')) return tag;
    at = src.indexOf('<button', at + 1);
  }
  throw new Error('no <button> carrying data-action="filter-hub" in ' + BROWSE_PAGE);
}

test('the hub chip carries its own reason, beside the id that reason explains', () => {
  const tag = hubChipTag();
  expect(tag).toContain('data-hub-id={hub.id}');
  expect(tag).toContain('data-hub-reason=');
});

test('the reason resolves TOGETHER with action and hub-id on one element', () => {
  // The together-rule's actual requirement, stated as the beat states it: one
  // element answers all three. This is the assertion that was false before.
  const tag = hubChipTag();
  for (const key of ['data-action="filter-hub"', 'data-hub-id=', 'data-hub-reason=']) {
    expect(tag).toContain(key);
  }
});

test('the count span carries no data-hub-reason of its own', () => {
  // Two elements carrying the key would put it back under the together-rule
  // from the other direction, and the span still answers neither action nor id.
  const src = stripComments(readFileSync(BROWSE_PAGE, 'utf8'));
  const spans = src.split('<span').slice(1);
  for (const s of spans) {
    const tag = s.slice(0, s.indexOf('>') + 1);
    expect(tag).not.toContain('data-hub-reason');
  }
});

test('the DOM contract names the chip, not the span', () => {
  // journey-sync: the attribute, the doc and the journey move together. A doc
  // that still says "the chip's count span" would send the next reader to the
  // node this defect lived on.
  const doc = readFileSync(DOM_CONTRACT, 'utf8');
  const at = doc.indexOf('[data-hub-reason]');
  expect(at).toBeGreaterThan(-1);
  const around = doc.slice(at, at + 400);
  expect(around).not.toContain('count span');
  expect(around).toMatch(/chip button|chip itself|beside `data-hub-id`/);
});
