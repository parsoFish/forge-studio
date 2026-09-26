/**
 * PR-body rendering of a demo's committed capture media (forge-mfv5.2.5): enumerate what
 * is actually committed under `<demoDir>/.capture/{before,after}/`, build commit-pinned
 * GitHub URLs, and compose the markdown block `embedDemoInPr` (pr.ts) places in the body.
 */

import { execFileSync } from 'node:child_process';
import { guardedReadDir } from '@forge/kernel';
import { SAFE_CAPTURE_NAME_RE } from './demo-paths.ts';

/**
 * URL-encode a repo-relative path SEGMENT BY SEGMENT, never the whole string
 * — an initiative id, artifactRoot, or checkpoint label can carry a
 * character (space, `#`, `?`, `&`) that must not corrupt the surrounding
 * markdown link or the query string, but the `/` separators between
 * `relDir`, `.capture`, `<side>` and the filename must stay literal
 * separators, not become `%2F`.
 */
export function encodeRelPath(relPath: string): string {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

/** One checkpoint label's captured media on one side (`.capture/<side>/`) —
 *  `filmstrip` mirrors `collectCapturedMedia`'s own precedence (stations
 *  demo-model.ts): a `.filmstrip.png` always wins over a plain `.png` of the
 *  same label. */
type CaptureSideMedia = { filmstrip?: string; filmstripIsReal?: boolean; webm?: string };

/**
 * Enumerate `<trackedDemoDir>/.capture/<side>/`, grouped by checkpoint label.
 * Containment goes through `@forge/kernel`'s `resolveGuardedPath`
 * (`guardedReadDir`) rather than a raw `readdirSync` — the same reasoning as
 * `collectCommittableCaptureMedia` in orchestrated-capture.ts: a demo
 * `command` checkpoint runs arbitrary project code with cwd = the worktree,
 * so `.capture/<side>/` is not fully trusted input. In practice this is a
 * secondary defence here — `trackedCaptureFiles` below is the one that
 * actually decides what gets linked, and a symlink was already refused at
 * commit time (deliverable 1) so it can never appear there — but enumerating
 * through the same guard keeps the two call sites consistent rather than one
 * raw and one guarded.
 */
function scanCaptureSide(trackedDemoDir: string, side: 'before' | 'after'): Map<string, CaptureSideMedia> {
  const byLabel = new Map<string, CaptureSideMedia>();
  const names = guardedReadDir(trackedDemoDir, ['.capture', side]);
  if (!names) return byLabel;
  for (const name of names.sort()) {
    if (!SAFE_CAPTURE_NAME_RE.test(name)) continue; // never linked: see SAFE_CAPTURE_NAME_RE
    const lower = name.toLowerCase();
    if (lower.endsWith('.filmstrip.png')) {
      const label = name.slice(0, name.length - '.filmstrip.png'.length);
      byLabel.set(label, { ...byLabel.get(label), filmstrip: name, filmstripIsReal: true });
    } else if (lower.endsWith('.png')) {
      const label = name.slice(0, name.length - '.png'.length);
      const entry = byLabel.get(label) ?? {};
      if (!entry.filmstripIsReal) byLabel.set(label, { ...entry, filmstrip: name });
    } else if (lower.endsWith('.webm')) {
      const label = name.slice(0, name.length - '.webm'.length);
      byLabel.set(label, { ...byLabel.get(label), webm: name });
    }
  }
  return byLabel;
}

/**
 * The `.capture/**` paths ACTUALLY committed at `ref` — the single source of
 * truth for what `embedDemoInPr` may safely link/inline. Deliberately
 * re-derived from git rather than re-running deliverable 1's size bounds: a
 * file present on disk but missing from this set was refused or skipped at
 * commit time for ANY reason (oversize, symlink), and git is the one place
 * that fact is already recorded without duplicating that logic here. Best
 * effort: a `git ls-tree` failure (e.g. `ref` unresolvable) reads as "nothing
 * committed", which degrades to text-only links, never a thrown error.
 */
function trackedCaptureFiles(worktreePath: string, ref: string, relDir: string): Set<string> {
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', `${relDir}/.capture`], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * Compose the "Captured checkpoints" media block (forge-mfv5.2.5):
 * inline every committed `.filmstrip.png` (falling back to a plain `.png` of
 * the same label) under `.capture/after/` and, when present,
 * `.capture/before/`, plus a link to each committed `.webm`. Images use
 * `blob/<ref>/…?raw=true` — GitHub's renderer does not rewrite/sign this URL
 * (measured 2026-09-27 on a private repo — a signed-in viewer's own session
 * covers it, an anonymous viewer sees the caveat line below instead of a
 * broken image), so a plain `raw/<ref>/…` link is not substituted here.
 * A file present on disk but NOT in `trackedCaptureFiles` (deliverable 1
 * refused or skipped it — oversize, symlink) is named in one "Skipped" line
 * rather than linked to a 404.
 */
export function buildCaptureMediaBlock(
  worktreePath: string,
  ref: string,
  relDir: string,
  trackedDemoDir: string,
  ownerRepo: string,
  isPrivate: boolean,
): string[] {
  const bySide: Record<'before' | 'after', Map<string, CaptureSideMedia>> = {
    before: scanCaptureSide(trackedDemoDir, 'before'),
    after: scanCaptureSide(trackedDemoDir, 'after'),
  };
  const labels = [...new Set([...bySide.before.keys(), ...bySide.after.keys()])].sort();
  if (labels.length === 0) return [];

  const tracked = trackedCaptureFiles(worktreePath, ref, relDir);
  const blobBase = `https://github.com/${ownerRepo}/blob/${ref}`;
  const captureUrl = (side: 'before' | 'after', file: string): string =>
    `${blobBase}/${encodeRelPath(`${relDir}/.capture/${side}/${file}`)}`;

  const lines: string[] = ['', '### Captured checkpoints', ''];
  const skipped: string[] = [];
  let anyInlined = false;
  for (const label of labels) {
    lines.push(`**${label}**`, '');
    for (const side of ['before', 'after'] as const) {
      const filmstrip = bySide[side].get(label)?.filmstrip;
      if (!filmstrip) continue;
      const relPath = `${relDir}/.capture/${side}/${filmstrip}`;
      if (!tracked.has(relPath)) {
        skipped.push(relPath);
        continue;
      }
      lines.push(`![${label} — ${side}](${captureUrl(side, filmstrip)}?raw=true)`, '');
      anyInlined = true;
    }
    for (const side of ['before', 'after'] as const) {
      const webm = bySide[side].get(label)?.webm;
      if (!webm) continue;
      const relPath = `${relDir}/.capture/${side}/${webm}`;
      if (!tracked.has(relPath)) {
        skipped.push(relPath);
        continue;
      }
      lines.push(`[▶ ${label} — ${side} (webm)](${captureUrl(side, webm)})`, '');
    }
  }
  if (isPrivate && anyInlined) {
    lines.push(
      "_The inline image above needs the viewer's github.com session; the committed files are in **Files changed** and DEMO.md._",
      '',
    );
  }
  if (skipped.length > 0) {
    lines.push(`Skipped (not committed — over the media size bound): ${skipped.map((s) => `\`${s}\``).join(', ')}`, '');
  }
  return lines;
}
