// ---------------------------------------------------------------------------
// W8-B4 — a Next.js `app/**/page.tsx` may export ONLY the framework's
// whitelisted names. Exporting anything else fails `next build` with
//
//     Type error: Page "app/<route>/page.tsx" does not match the required
//     types of a Next.js Page.  "<Name>" is not a valid Page export field.
//
// This lane hit that THREE times in one branch: WI-6 (`app/hooks/page.tsx`,
// caught by the worker), WI-7 (`app/skills/[id]/page.tsx`, exported
// `SkillDetailBody` for render testing) and WI-4 (`app/templates/new/page.tsx`,
// exported `CATEGORY_LABEL`/`writableCategoryNames` for a derivation pin).
// The first was found and fixed; the other two reached a full-gate `npm run
// build` and turned it RED.
//
// The reason it kept happening is that NOTHING CHEAPER THAN A FULL NEXT BUILD
// SAW IT: `npm run test:ui:typecheck` (`tsc -p forge-ui/tsconfig.tests.json`)
// passes, because that project does not read Next's generated route types, and
// every unit test passes too — the export is perfectly valid TypeScript. So a
// worker gets a clean file-scoped signal and the failure only appears minutes
// later at the gate.
//
// This test is the cheap signal. When it fails, the fix is NOT to delete the
// export: move the symbol to `components/studio/*.tsx` or `lib/*.ts` and import
// it back into the page. That is what `HookLibraryResults.tsx`,
// `SkillDetailBody.tsx` and `lib/template-authoring-view.ts` are.
// ---------------------------------------------------------------------------

import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP_ROOT = join(import.meta.dirname, '..', 'app');

/** Next's allowed `page.tsx` export names. `default` is the page itself; the
 *  rest are route-segment config Next reads by name. Source: the same list
 *  Next's own generated route-type check enforces. */
const ALLOWED = new Set([
  'default',
  'metadata',
  'generateMetadata',
  'viewport',
  'generateViewport',
  'generateStaticParams',
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
  'experimental_ppr',
  'config',
]);

function pageFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) pageFiles(p, out);
    else if (e.name === 'page.tsx') out.push(p);
  }
  return out;
}

/** Every top-level `export` NAME in a page module, `export default` included.
 *  Deliberately line-anchored: a nested/indented `export` cannot occur at
 *  module scope in these files, and matching indented text would produce
 *  false positives from strings and comments. */
function exportedNames(src: string): string[] {
  const names: string[] = [];
  for (const line of src.split('\n')) {
    if (!line.startsWith('export')) continue;
    if (/^export\s+default\b/.test(line)) { names.push('default'); continue; }
    const m = line.match(/^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/);
    if (m) { names.push(m[1]); continue; }
    const braced = line.match(/^export\s*\{([^}]*)\}/);
    if (braced) {
      for (const part of braced[1].split(',')) {
        const as = part.trim().split(/\s+as\s+/);
        const name = (as[1] ?? as[0] ?? '').trim();
        if (name) names.push(name);
      }
      continue;
    }
    if (/^export\s*\*/.test(line)) { names.push('*'); continue; }
    names.push(line.trim());
  }
  return names;
}

describe('app/**/page.tsx export whitelist (next build route-type constraint)', () => {
  const files = pageFiles(APP_ROOT);

  test('the sweep actually finds the app pages (guards against a silently-empty pass)', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test('no page.tsx exports a name outside Next\'s whitelist', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const name of exportedNames(readFileSync(file, 'utf8'))) {
        if (!ALLOWED.has(name)) {
          offenders.push(`${relative(join(import.meta.dirname, '..'), file)} exports "${name}"`);
        }
      }
    }
    expect(
      offenders,
      `A Next.js page.tsx may only export ${[...ALLOWED].join(', ')}. `
      + 'Each offender below makes `npm run build` fail with "is not a valid Page export field", '
      + 'while tsc and every unit test stay green. Move the symbol into components/ or lib/ and '
      + 'import it back into the page — do not delete it.\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });
});
