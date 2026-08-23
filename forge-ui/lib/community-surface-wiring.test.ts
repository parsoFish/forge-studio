/**
 * W8-B5 / WI-6 — WIRING + STYLESHEET pins for the four `/community` defects
 * whose fix lives in a page component or in globals.css rather than in a pure
 * function (exit rows E9, E12, E13, E15, plus the two render sites of E10/E16).
 *
 * Why source-text pins and not rendered-DOM pins: this repo's forge-ui vitest
 * config is `environment: 'node'` (a standing decision — see
 * community-view.test.ts's own header), and every page below is a
 * `use client` component whose state arrives from an effect-driven fetch,
 * which `renderToStaticMarkup` never runs. `detail-pages-fail-closed-wiring.
 * test.ts` and `knowledge-page-empty-state-wiring.test.ts` set the precedent:
 * pin the WIRING in the source, pin the pure logic in its own unit tests, and
 * let the live journey drive the real DOM.
 *
 * Everything ASSERTED here is a fact about the file's structure that the
 * defect made false, so each assertion fails against the pre-fix source.
 */
import { test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const APP = resolve(__dirname, '../app');
const COMMUNITY_DIR = join(APP, 'community');
const BROWSE_PAGE = join(COMMUNITY_DIR, 'page.tsx');
const FORM_PAGE = join(COMMUNITY_DIR, 'new', 'page.tsx');
const DETAIL_PAGE = join(COMMUNITY_DIR, '[kind]', '[id]', 'page.tsx');
const GLOBALS_CSS = resolve(__dirname, '../app/globals.css');
const COMMUNITY_CLIENT = resolve(__dirname, './community-client.ts');

const read = (p: string): string => readFileSync(p, 'utf8');

/** Source with comment PROSE removed, for the tag scanners below. These files
 *  discuss `<Field>` / `<select>` / `<input>` in their own explanatory
 *  comments, and a scanner that counted those would report a defect in a
 *  sentence. Block comments (including the `{/* … *\/}` JSX form) and
 *  whole-line `//` comments only — never a mid-line `//`, which would
 *  truncate a line carrying an `https://` URL. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Every .tsx below `dir`. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (entry.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Opening tags of `name` in `src`, brace-aware so `{a ? '>' : ''}` inside a
 *  JSX expression does not end the tag early (mirrors
 *  scripts/check-disabled-reason.mjs's own scanner). */
function openingTags(src: string, name: string): Array<{ tag: string; index: number; line: number }> {
  const out: Array<{ tag: string; index: number; line: number }> = [];
  let i = 0;
  const needle = `<${name}`;
  while ((i = src.indexOf(needle, i)) >= 0) {
    const after = src[i + needle.length];
    if (after !== undefined && /[A-Za-z0-9]/.test(after)) { i += needle.length; continue; }
    let depth = 0;
    let end = -1;
    for (let j = i; j < src.length; j += 1) {
      const c = src[j];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) { end = j; break; }
    }
    if (end < 0) break;
    out.push({ tag: src.slice(i, end + 1), index: i, line: src.slice(0, i).split('\n').length });
    i = end;
  }
  return out;
}

// ---------------------------------------------------------------------------
// E9 — an edit load that 404s renders the SHARED NotFound; a bridge that is
// down does NOT.
// ---------------------------------------------------------------------------

test('E9: the registry form imports the shared NotFound component', () => {
  expect(read(FORM_PAGE)).toMatch(/import\s*\{\s*NotFound\s*\}\s*from\s*'@\/components\/NotFound'/);
});

test('E9: the registry form RENDERS NotFound, and names the object kind + the id asked for', () => {
  const src = read(FORM_PAGE);
  const tag = openingTags(stripComments(src), 'NotFound')[0];
  expect(tag, 'no <NotFound …> is rendered by the registry form').toBeTruthy();
  expect(tag!.tag).toMatch(/kind=/);
  expect(tag!.tag).toMatch(/id=/);
  expect(tag!.tag).toMatch(/backHref=/);
});

test('E9: NotFound is gated on the not-found OUTCOME, never on the presence of any load error', () => {
  const src = read(FORM_PAGE);
  expect(src).toMatch(/registryEditLoadOutcome/);
  expect(src).toMatch(/'not-found'/);
  // The pre-fix page had a single `loadError` string and no outcome at all;
  // a fix that renders NotFound whenever `loadError` is set would turn a down
  // bridge into a fabricated "no such row" claim.
  expect(src).not.toMatch(/loadError\s*(&&|\?)[^\n]*<NotFound/);
});

test('E9: the transport-failure banner SURVIVES — a bridge that is down still renders the error surface', () => {
  expect(read(FORM_PAGE)).toMatch(/data-component="fetch-error"/);
});

test('E9: fetchRegistryItem carries the HTTP status through, so 404 is distinguishable from "never reached"', () => {
  const src = read(COMMUNITY_CLIENT);
  const fn = src.slice(src.indexOf('export async function fetchRegistryItem'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  expect(body).toMatch(/status\??:\s*number/);
  // Specifically the NON-2xx arm — the one that carries the 404. Asserting a
  // bare `status: res.status` anywhere in the function is not enough: another
  // arm carrying it would let this pass with the 404 arm's status removed
  // (found by the kill-proof swap-back on the first version of this test).
  expect(body).toMatch(/if \(!res\.ok\) return \{[^}]*status:\s*res\.status/);
  // The transport-throw arm must NOT invent a status: no status === the
  // bridge was never reached (bridge-result.ts's own vocabulary).
  const transportArm = body.slice(body.indexOf('catch (err)'), body.indexOf('const data'));
  expect(transportArm).not.toMatch(/status:/);
});

// ---------------------------------------------------------------------------
// E10 — the disabled reason is DERIVED, not retyped.
// ---------------------------------------------------------------------------

test('E10: the registry form derives its disabled reason from the shared predicate module', () => {
  const src = read(FORM_PAGE);
  expect(src).toMatch(/registryFormDisabledReason/);
  expect(src).toMatch(/from\s*'@\/lib\/community-form'/);
});

test('E10: the wrong hand-typed field list is GONE from the source', () => {
  const src = read(FORM_PAGE);
  expect(src).not.toContain('Fill in id, name, description and upstream first');
});

test('E10: no <Field> hardcodes `required` any more — the asterisk comes from the same SSOT as the gate', () => {
  const src = read(FORM_PAGE);
  for (const { tag, line } of openingTags(stripComments(src), 'Field')) {
    expect(/\srequired(\s|>|=\{true\})/.test(tag), `new/page.tsx:${line} still hardcodes a required marker: ${tag}`).toBe(false);
    expect(/\sfield=/.test(tag), `new/page.tsx:${line} does not name its form field: ${tag}`).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// E12 — the `.kv` grid must not blow the document out horizontally.
// ---------------------------------------------------------------------------

function cssRule(selector: string): string {
  const css = read(GLOBALS_CSS);
  const at = css.indexOf(`${selector} {`);
  expect(at, `no "${selector} {" rule in globals.css`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at) + 1);
}

test('E12: the .kv value track is minmax(0, 1fr) — a 1fr track\'s default min-width:auto cannot shrink below an unbreakable URL', () => {
  const rule = cssRule('.kv');
  expect(rule).toMatch(/grid-template-columns:\s*max-content\s+minmax\(\s*0\s*,\s*1fr\s*\)/);
  expect(rule).not.toMatch(/grid-template-columns:\s*max-content\s+1fr\s*;/);
});

test('E12: .kv dd breaks an unbreakable string rather than widening the page', () => {
  const rule = cssRule('.kv dd');
  expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
  expect(rule).toMatch(/min-width:\s*0/);
});

test('E12: the fix is the CAUSE, not a body-level overflow-x:hidden that merely clips the blowout', () => {
  const css = read(GLOBALS_CSS);
  for (const selector of ['body', 'html', 'html, body', 'body, html']) {
    const at = css.indexOf(`${selector} {`);
    if (at < 0) continue;
    const rule = css.slice(at, css.indexOf('}', at) + 1);
    expect(rule, `${selector} papers over the grid blowout with overflow-x`).not.toMatch(/overflow-x:\s*(hidden|clip)/);
  }
});

// ---------------------------------------------------------------------------
// E13 — every form control on the community surface has an accessible name.
// ---------------------------------------------------------------------------

/** A control is named if its own tag carries aria-label/aria-labelledby/id,
 *  or if it sits inside a `<Field …>…</Field>` (which wraps its children in a
 *  real <label> carrying the field name). */
function unnamedControls(file: string): string[] {
  const src = stripComments(read(file));
  const fieldRanges: Array<[number, number]> = [];
  let i = 0;
  while ((i = src.indexOf('<Field', i)) >= 0) {
    const close = src.indexOf('</Field>', i);
    if (close < 0) break;
    fieldRanges.push([i, close]);
    i = close + 1;
  }
  const inField = (at: number): boolean => fieldRanges.some(([a, b]) => at > a && at < b);
  const bad: string[] = [];
  for (const name of ['input', 'select', 'textarea']) {
    for (const { tag, index, line } of openingTags(src, name)) {
      if (/\baria-label(ledby)?=/.test(tag)) continue;
      if (inField(index)) continue;
      bad.push(`${file}:${line} <${name}> has no accessible name`);
    }
  }
  return bad;
}

test('E13: EVERY input/select/textarea under app/community carries an accessible name', () => {
  const files = tsxFiles(COMMUNITY_DIR);
  expect(files.length).toBeGreaterThan(0);
  const bad = files.flatMap(unnamedControls);
  expect(bad, bad.join('\n')).toEqual([]);
});

test('E13: the community search input specifically carries an aria-label (the one that was bare)', () => {
  const src = read(BROWSE_PAGE);
  const tag = openingTags(stripComments(src), 'input').find((t) => t.tag.includes('data-field="community-search"'));
  expect(tag, 'the [data-field="community-search"] input is gone').toBeTruthy();
  expect(tag!.tag).toMatch(/aria-label="[^"]+"/);
});

// ---------------------------------------------------------------------------
// E14 — the empty block consumes the derived state.
// ---------------------------------------------------------------------------

test('E14: the browse page renders the DERIVED empty state and exposes it as data-empty-state', () => {
  const src = read(BROWSE_PAGE);
  expect(src).toMatch(/communityEmptyState\(/);
  expect(src).toMatch(/data-empty-state=/);
  expect(src).not.toContain("'Nothing matches this filter.'");
});

test('E14: the hub chip and the empty state share ONE predicate — no second copy of the declared-only flag', () => {
  const src = read(BROWSE_PAGE);
  expect(src).toMatch(/isHubDeclaredOnly\(/);
  expect(src).not.toMatch(/const\s+declaredOnly\s*=\s*hub\.itemCount\s*===\s*0/);
});

// ---------------------------------------------------------------------------
// E15 — browse state lives in the URL.
// ---------------------------------------------------------------------------

test('E15: the browse page reads its state from the URL and writes it back through the router', () => {
  const src = read(BROWSE_PAGE);
  expect(src).toMatch(/useSearchParams/);
  expect(src).toMatch(/useRouter/);
  expect(src).toMatch(/parseCommunityViewState/);
  // The page builds its hrefs through community-url-state's own serialiser
  // (`communityHrefFor` wraps `communityViewStateToSearch`) — the point is
  // that the search string is DERIVED there, never hand-assembled here.
  expect(src).toMatch(/communityHrefFor|communityViewStateToSearch/);
});

test('E15: a client component reading search params is wrapped in a Suspense boundary', () => {
  const src = read(BROWSE_PAGE);
  expect(src).toMatch(/Suspense/);
  expect(src).toMatch(/<Suspense/);
});

test('E15: kind/hub/sort are pushed (Back restores them); the search box is REPLACED (no history entry per keystroke)', () => {
  const src = read(BROWSE_PAGE);
  expect(src).toMatch(/router\.push\(/);
  expect(src).toMatch(/router\.replace\(/);
});

test('E15: the five ad-hoc useStates that held browse state are gone', () => {
  const src = read(BROWSE_PAGE);
  for (const gone of ['useState<CommunityKind | \'all\'>', 'useState<CommunitySortKey>', 'useState<CommunitySortDirection>']) {
    expect(src, `browse state is still held in a local useState: ${gone}`).not.toContain(gone);
  }
});

test('E15: the journey-contract attributes still render, sourced from the URL state', () => {
  const src = read(BROWSE_PAGE);
  for (const attr of ['data-kind-filter', 'data-hub-filter', 'data-sort-key', 'data-sort-dir', 'data-item-count']) {
    expect(src, `${attr} was dropped from the browse page`).toContain(attr);
  }
});

// ---------------------------------------------------------------------------
// E16 — the detail page renders the added connection link.
// ---------------------------------------------------------------------------

test('E16: the detail page renders the connection-page link beside the install action', () => {
  const src = read(DETAIL_PAGE);
  expect(src).toMatch(/connectionPageLinkFor\(/);
  // The NEW render site specifically. `data-action="open-owning-page"` alone
  // is not enough: the pre-existing `open-owning` arm already carries it, so
  // that assertion passed with the whole new block deleted (found by the
  // kill-proof swap-back on the first version of this test).
  expect(src).toMatch(/\{connectionHref !== null && \(/);
  expect(src).toMatch(/data-component="connection-page-link"/);
  expect(src).toMatch(/<Link href=\{connectionHref\} data-action="open-owning-page">/);
  // …and the section advertises it in the DOM contract.
  expect(src).toMatch(/'data-connection-link': 'true'/);
});

test('E16: the install arms are untouched — install / install-confirm / browse-upstream / none-system all still render', () => {
  const src = read(DETAIL_PAGE);
  for (const arm of ['install-confirm', 'browse-upstream', 'none-system', 'present-unmanaged', 'open-owning']) {
    expect(src, `the "${arm}" install arm was removed`).toContain(`'${arm}'`);
  }
});
