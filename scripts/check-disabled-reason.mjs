#!/usr/bin/env node
/**
 * check-disabled-reason — a disabled PRIMARY CTA must say why (W7-C3 review,
 * A-M12; the fifth member of the scripts/check-*.mjs ratchet family).
 *
 * THE DEFECT THIS CLOSES. `data-disabled-reason` + a matching `title` shipped
 * as a documented cross-cutting contract and as pure per-component
 * discipline: 7 CTAs implemented it, ~29 primary CTAs carried NEITHER
 * attribute, two more carried a `title` covering only one of two disabling
 * branches — and enforcement was nowhere. There is no eslint config in this
 * repo, the root `lint` is markdownlint over docs, none of the other four
 * check-*.mjs mentioned it, and all 19 journeys grepped zero for it. The
 * doc's claim that it was "pinned by the owning route's journey beat" was
 * unsupported. That is the campaign's dominant defect class — a field
 * surfaced everywhere and enforced nowhere — and only a constructive gate
 * closes it.
 *
 * SCOPE, stated honestly. It checks `<button>` elements in `forge-ui/app` and
 * `forge-ui/components` whose opening tag carries a DYNAMIC `disabled={…}`
 * (a runtime state the operator can hit) AND reads as a primary CTA
 * (`btn-primary`, or the `primaryBtn`/`launchButtonStyle` style objects). It
 * does NOT check secondary/ghost buttons, `<a>` elements, statically disabled
 * controls, or whether the reason TEXT is accurate — the last of those is
 * what `disabledAttrs()` is for: one nullable reason drives `disabled`,
 * `title` and `data-disabled-reason` together, so they cannot drift.
 *
 * FIX A FAILURE by spreading `{...disabledAttrs(cond ? 'why' : null)}`
 * (forge-ui/lib/disabled-reason.ts) in place of the bare `disabled={cond}`,
 * or by adding an ALLOWLIST row below for an audited residual.
 *
 * RUN: node scripts/check-disabled-reason.mjs [--json]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI = join(ROOT, 'forge-ui');

/**
 * Audited residuals: file + the button's `data-action` (NOT a line number —
 * a reason-less CTA is a defect wherever it moves to, and line-keyed rows
 * rot into remap churn). Each needs a reason a human can check.
 */
const ALLOWLIST = [
  // (empty — every primary CTA carries its reason)
];

function tsxFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (entry.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** The `<button …>` opening tags in `src`, brace-aware so `{a ? '>' : ''}` does not end it. */
function buttonTags(src) {
  const tags = [];
  let i = 0;
  while ((i = src.indexOf('<button', i)) >= 0) {
    let depth = 0;
    let end = -1;
    for (let j = i; j < src.length; j += 1) {
      const c = src[j];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) { end = j; break; }
    }
    if (end < 0) break;
    tags.push({ tag: src.slice(i, end + 1), line: src.slice(0, i).split('\n').length });
    i = end;
  }
  return tags;
}

const PRIMARY = /btn-primary|primaryBtn|launchButtonStyle/;

const offenders = [];
let checked = 0;
for (const file of [...tsxFiles(join(UI, 'app')), ...tsxFiles(join(UI, 'components'))]) {
  const src = readFileSync(file, 'utf8');
  for (const { tag, line } of buttonTags(src)) {
    const dynamicDisable = /\bdisabled=\{/.test(tag) || /\{\.\.\.disabledAttrs\(/.test(tag);
    if (!dynamicDisable || !PRIMARY.test(tag)) continue;
    checked += 1;
    if (/data-disabled-reason/.test(tag) || /\{\.\.\.disabledAttrs\(/.test(tag)) continue;
    const action = tag.match(/data-action=\{?["'`]?([a-z0-9-]+)/i)?.[1] ?? '(no data-action)';
    const rel = relative(ROOT, file);
    if (ALLOWLIST.some((r) => r.file === rel && r.action === action)) continue;
    offenders.push({ file: rel, line, action });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ checked, offenders }, null, 2));
} else if (offenders.length > 0) {
  console.error(`check-disabled-reason: FAIL — ${offenders.length} of ${checked} disabled primary CTA(s) give the operator no reason:\n`);
  for (const o of offenders) console.error(`  ✗ ${o.file}:${o.line} [${o.action}] — disabled with no data-disabled-reason`);
  console.error(`
Each must be either:
  1. Spread from the ONE derivation:
       {...disabledAttrs(cond ? 'why the operator cannot do this yet' : null)}
     (forge-ui/lib/disabled-reason.ts — drives disabled + title + data-disabled-reason together).
  2. Or added to the ALLOWLIST in scripts/check-disabled-reason.mjs (file + data-action + reason).`);
  process.exit(1);
} else {
  console.log(`check-disabled-reason: PASS — ${checked} disabled primary CTA(s), every one carries its reason, ${ALLOWLIST.length} allowlisted residual(s)`);
}
