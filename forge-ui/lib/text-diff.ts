/**
 * W7-C2 (sessions-kinds-30) — `lineDiff`: a small, pure line-level diff
 * backing the AGENTS.md verdict screen's draft-vs-current view
 * (SessionArtifactPane's MarkdownDraftBody). Classic LCS over lines; the
 * result is a flat display sequence of {type: 'same'|'del'|'add', text}
 * rows — deletions before additions at each divergence, mirroring unified
 * diff reading order.
 *
 * Deliberately a DISPLAY AID, never a patch engine: no hunk headers, no
 * context trimming, no char-level refinement. Inputs beyond the size cap
 * return null (fail SOFT — the caller renders an honest "too large to
 * diff" note) rather than running an O(n*m) table that could hang the tab.
 */

export type DiffRowType = 'same' | 'del' | 'add';

export type DiffRow = {
  type: DiffRowType;
  text: string;
};

/** n*m ceiling for the LCS table — 4M cells ≈ a few ms and ~16-32MB
 *  transiently; AGENTS.md-scale files (hundreds of lines) sit far below. */
const MAX_LCS_CELLS = 4_000_000;

function toLines(text: string): string[] {
  // ''.split('\n') is [''] — a phantom empty line; the honest empty input
  // is zero lines (C2-DIFF-7).
  if (text.length === 0) return [];
  return text.split('\n');
}

/**
 * Line-level LCS diff of `oldText` → `newText`, or `null` when the inputs
 * exceed the size cap (see MAX_LCS_CELLS).
 */
export function lineDiff(oldText: string, newText: string): DiffRow[] | null {
  const oldLines = toLines(oldText);
  const newLines = toLines(newText);
  const n = oldLines.length;
  const m = newLines.length;
  if (n * m > MAX_LCS_CELLS) return null;

  // LCS length table — (n+1) x (m+1), rolled as a flat typed array.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        oldLines[i] === newLines[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }

  // Walk the table emitting rows. At each divergence, drain deletions
  // before additions (stable, unified-diff-like reading order).
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ type: 'same', text: oldLines[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      rows.push({ type: 'del', text: oldLines[i] });
      i++;
    } else {
      rows.push({ type: 'add', text: newLines[j] });
      j++;
    }
  }
  while (i < n) rows.push({ type: 'del', text: oldLines[i++] });
  while (j < m) rows.push({ type: 'add', text: newLines[j++] });
  return rows;
}
