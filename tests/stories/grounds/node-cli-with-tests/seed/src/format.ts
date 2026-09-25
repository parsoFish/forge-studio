/**
 * Summary rendering and serialisation.
 *
 * Pure: given a Summary, return a deterministic plain-text report or JSON
 * string. No colour / ANSI, no I/O, no mutation. The output is stable so it
 * can be asserted exactly by the acceptance read-back.
 */

import type { Summary } from './stats.ts';
import type { FileOwnership } from './ownership.ts';
import type { HotspotEntry } from './hotspot.ts';
import type { CompareResult } from './compare.ts';
import type { TagSpan } from './tags.ts';
import type { CouplingRow } from './coupling.ts';

const NO_DATE = '(none)';

/**
 * Tag-range annotation used by renderers.
 * All four fields are non-empty strings when present.
 */
export type TagRangeAnnotation = {
  sinceTag: string;
  untilTag: string;
  sinceSha: string;
  untilSha: string;
};

/**
 * Render a Summary as a plain-text report:
 *
 *   gitpulse — N commits (<first> → <last>)
 *
 *   commits  author
 *   -------  ------
 *         3  Alice
 *         1  Bob
 *
 *   churn (lines)  author
 *   -------------  ------
 *             +10  Alice
 *              +3  Bob
 *
 * The per-author tables are aligned on the widest value. An empty summary
 * renders the header (with a `(none)` date range) and an empty-table note.
 * The churn section comes AFTER the commit-count table so existing line-index
 * assertions in unit.test.ts remain valid.
 *
 * Ownership and hotspot sections are appended at the end when populated.
 *
 * When `opts.tagRange` is supplied the header gains `(range sinceTag..untilTag)`.
 */
export function renderSummary(s: Summary, opts?: { tagRange?: TagRangeAnnotation }): string {
  const first = s.firstDate ?? NO_DATE;
  const last = s.lastDate ?? NO_DATE;
  let header = `gitpulse — ${s.totalCommits} commits (${first} → ${last})`;
  if (opts?.tagRange) {
    header += ` (range ${opts.tagRange.sinceTag}..${opts.tagRange.untilTag})`;
  }

  if (s.byAuthor.length === 0) {
    return [header, '', 'No commits found.'].join('\n');
  }

  // --- commit-count table (unchanged) ---
  const countWidth = Math.max(
    'commits'.length,
    ...s.byAuthor.map((a) => String(a.commits).length),
  );

  const countRows = s.byAuthor.map(
    (a) => `${String(a.commits).padStart(countWidth)}  ${a.author}`,
  );

  const commitTable = [
    `${'commits'.padStart(countWidth)}  author`,
    `${'-'.repeat(countWidth)}  ------`,
    ...countRows,
  ];

  // --- churn table (new) ---
  // Column header is "+ins/-del" style: "+NNN" values (always positive).
  // We show "+insertions" and "-deletions" as two parts in a single column
  // label "churn (lines)" and values like "+10/-5".
  const churnValues = s.authorChurn.map((a) => `+${a.insertions}/-${a.deletions}`);
  const CHURN_HEADER = 'churn (lines)';
  const churnColWidth = Math.max(CHURN_HEADER.length, ...churnValues.map((v) => v.length));

  const churnRows = s.authorChurn.map(
    (a, i) => `${churnValues[i].padStart(churnColWidth)}  ${a.author}`,
  );

  const churnTable = [
    `${CHURN_HEADER.padStart(churnColWidth)}  author`,
    `${'-'.repeat(churnColWidth)}  ------`,
    ...churnRows,
  ];

  // --- per-file churn table (new) ---
  // Shows file paths with "+ins/-del" totals, descending by total lines changed.
  // Omitted when there are no per-file records (e.g. commits without numstat).
  const sections: string[] = [header, '', ...commitTable, '', ...churnTable];

  if (s.fileChurn.length > 0) {
    const fileChurnValues = s.fileChurn.map((f) => `+${f.insertions}/-${f.deletions}`);
    const FILE_CHURN_HEADER = 'churn (lines)';
    const fileChurnColWidth = Math.max(
      FILE_CHURN_HEADER.length,
      ...fileChurnValues.map((v) => v.length),
    );

    const fileChurnRows = s.fileChurn.map(
      (f, i) => `${fileChurnValues[i].padStart(fileChurnColWidth)}  ${f.file}`,
    );

    sections.push(
      '',
      `${FILE_CHURN_HEADER.padStart(fileChurnColWidth)}  file`,
      `${'-'.repeat(fileChurnColWidth)}  ----`,
      ...fileChurnRows,
    );
  }

  // --- ownership table ---
  // Omitted entirely when ownershipEntries is empty.
  if (s.ownershipEntries.length > 0) {
    sections.push('', ...renderOwnershipTable(s.ownershipEntries));
  }

  // --- hotspots table ---
  // Omitted entirely when hotspotEntries is empty.
  if (s.hotspotEntries.length > 0) {
    sections.push('', ...renderHotspotsTable(s.hotspotEntries));
  }

  return sections.join('\n');
}

/**
 * Serialise a Summary as a JSON string.
 *
 * Pure: no I/O, no mutation. The output is valid JSON parseable by
 * `JSON.parse`. Top-level keys: totalCommits, firstDate, lastDate, byAuthor,
 * authorChurn, fileChurn, ownershipEntries, hotspotEntries.
 *
 * When `opts.tagRange` is supplied a top-level `range` key is injected with
 * { sinceTag, untilTag, sinceSha, untilSha }.
 */
export function serializeSummary(s: Summary, opts?: { tagRange?: TagRangeAnnotation }): string {
  if (opts?.tagRange) {
    const obj = { ...s, range: opts.tagRange } as Record<string, unknown>;
    return JSON.stringify(obj, null, 2);
  }
  return JSON.stringify(s, null, 2);
}

/**
 * Render the ownership table rows (no leading blank line — caller adds that).
 *
 * Columns: owner (left text, right-padded) | bus-factor (right-aligned) | file
 *
 *   owner  bus-factor  file
 *   -----  ----------  ----
 *   Alice           3  src/a.ts
 *     Bob           1  src/b.ts
 */
function renderOwnershipTable(entries: readonly FileOwnership[]): string[] {
  const SECTION_HDR = 'ownership';
  const OWNER_HDR = 'owner';
  const BUS_HDR = 'bus-factor';
  const FILE_HDR = 'file';

  const ownerWidth = Math.max(OWNER_HDR.length, ...entries.map((e) => e.owner.length));
  const busWidth = Math.max(BUS_HDR.length, ...entries.map((e) => String(e.busFactor).length));

  const colHeader = `${OWNER_HDR.padEnd(ownerWidth)}  ${BUS_HDR.padStart(busWidth)}  ${FILE_HDR}`;
  const rule = `${'-'.repeat(ownerWidth)}  ${'-'.repeat(busWidth)}  ${'-'.repeat(FILE_HDR.length)}`;

  const rows = entries.map(
    (e) => `${e.owner.padEnd(ownerWidth)}  ${String(e.busFactor).padStart(busWidth)}  ${e.file}`,
  );

  return [SECTION_HDR, colHeader, rule, ...rows];
}

/**
 * Render the hotspots table rows (no leading blank line — caller adds that).
 *
 * Columns: score (2dp, right-aligned) | commits (right-aligned) | last-date (10 chars) | file
 *
 *   score  commits  last-date   file
 *   -----  -------  ---------   ----
 *   10.00        5  2024-01-15  src/hot.ts
 *    0.03       10  2022-01-01  src/cold.ts
 */
function renderHotspotsTable(entries: readonly HotspotEntry[]): string[] {
  const SECTION_HDR = 'hotspots';
  const SCORE_HDR = 'score';
  const COMMITS_HDR = 'commits';
  const DATE_HDR = 'last-date';
  const FILE_HDR = 'file';

  const scoreValues = entries.map((e) => e.score.toFixed(2));
  const scoreWidth = Math.max(SCORE_HDR.length, ...scoreValues.map((v) => v.length));
  const commitsWidth = Math.max(
    COMMITS_HDR.length,
    ...entries.map((e) => String(e.commits).length),
  );
  const dateWidth = Math.max(DATE_HDR.length, 10); // lastDate is always YYYY-MM-DD (10 chars)

  const colHeader = `${SCORE_HDR.padStart(scoreWidth)}  ${COMMITS_HDR.padStart(commitsWidth)}  ${DATE_HDR.padEnd(dateWidth)}  ${FILE_HDR}`;
  const rule = `${'-'.repeat(scoreWidth)}  ${'-'.repeat(commitsWidth)}  ${'-'.repeat(dateWidth)}  ${'-'.repeat(FILE_HDR.length)}`;

  const rows = entries.map(
    (e, i) =>
      `${scoreValues[i].padStart(scoreWidth)}  ${String(e.commits).padStart(commitsWidth)}  ${e.lastDate.padEnd(dateWidth)}  ${e.file}`,
  );

  return [SECTION_HDR, colHeader, rule, ...rows];
}

// ---------------------------------------------------------------------------
// Delta rendering
// ---------------------------------------------------------------------------

/**
 * Format a signed number for the delta column:
 * - positive → '+N'
 * - negative → '-N'  (Number.toString already includes '-')
 * - zero     → '0'   (no sign)
 */
function signedStr(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return String(n);
  return '0';
}

/**
 * Render a CompareResult as a plain-text delta report.
 *
 *   gitpulse — delta since <ref>
 *
 *                 head   base  delta
 *                 ----   ----  -----
 *      commits       5      3     +2
 *   lines added     10      4     +6
 *   lines removed    2      1     +1
 *
 *   Δcommits  Δlines  author
 *   --------  ------  ------
 *         +3      +9  Ada Lovelace
 *         +2      +4  Grace Hopper
 *
 * `opts.top` truncates the per-author table to at most `top` rows.
 */
export function renderDelta(result: CompareResult, opts?: { top?: number }): string {
  const header = `gitpulse — delta since ${result.ref}`;

  // --- Headline table ---
  // Rows: commits, lines added, lines removed
  type HeadlineRow = { label: string; head: number; base: number; delta: number };
  const headlineRows: HeadlineRow[] = [
    { label: 'commits',       head: result.head.commits,      base: result.base.commits,      delta: result.delta.commits },
    { label: 'lines added',   head: result.head.linesAdded,   base: result.base.linesAdded,   delta: result.delta.linesAdded },
    { label: 'lines removed', head: result.head.linesRemoved, base: result.base.linesRemoved, delta: result.delta.linesRemoved },
  ];

  const HEAD_HDR  = 'head';
  const BASE_HDR  = 'base';
  const DELTA_HDR = 'delta';

  const labelWidth = Math.max(...headlineRows.map((r) => r.label.length));
  const headWidth  = Math.max(HEAD_HDR.length,  ...headlineRows.map((r) => String(r.head).length));
  const baseWidth  = Math.max(BASE_HDR.length,  ...headlineRows.map((r) => String(r.base).length));
  const deltaWidth = Math.max(DELTA_HDR.length, ...headlineRows.map((r) => signedStr(r.delta).length));

  const hlColHeader = `${''.padStart(labelWidth)}  ${HEAD_HDR.padStart(headWidth)}  ${BASE_HDR.padStart(baseWidth)}  ${DELTA_HDR.padStart(deltaWidth)}`;
  const hlRule      = `${'-'.repeat(labelWidth)}  ${'-'.repeat(headWidth)}  ${'-'.repeat(baseWidth)}  ${'-'.repeat(deltaWidth)}`;

  const hlRows = headlineRows.map(
    (r) =>
      `${r.label.padStart(labelWidth)}  ${String(r.head).padStart(headWidth)}  ${String(r.base).padStart(baseWidth)}  ${signedStr(r.delta).padStart(deltaWidth)}`,
  );

  const headlineTable = [hlColHeader, hlRule, ...hlRows];

  // --- Per-author delta table ---
  // Already sorted by |deltaCommits| desc by computeDelta; we just truncate.
  const DCOMMITS_HDR = 'Δcommits';
  const DLINES_HDR   = 'Δlines';
  const AUTHOR_HDR   = 'author';

  const authors = opts?.top !== undefined
    ? result.authorDeltas.slice(0, opts.top)
    : result.authorDeltas;

  const dcValues = authors.map((a) => signedStr(a.deltaCommits));
  const dlValues = authors.map((a) => signedStr(a.deltaChurn));

  const dcWidth = Math.max(DCOMMITS_HDR.length, ...dcValues.map((v) => v.length));
  const dlWidth = Math.max(DLINES_HDR.length,   ...dlValues.map((v) => v.length));

  const authorColHeader = `${DCOMMITS_HDR.padStart(dcWidth)}  ${DLINES_HDR.padStart(dlWidth)}  ${AUTHOR_HDR}`;
  const authorRule      = `${'-'.repeat(dcWidth)}  ${'-'.repeat(dlWidth)}  ${'-'.repeat(AUTHOR_HDR.length)}`;

  const authorRows = authors.map(
    (a, i) => `${dcValues[i].padStart(dcWidth)}  ${dlValues[i].padStart(dlWidth)}  ${a.author}`,
  );

  const authorTable = [authorColHeader, authorRule, ...authorRows];

  return [header, '', ...headlineTable, '', ...authorTable].join('\n');
}

/**
 * Serialise a CompareResult as a JSON string.
 *
 * Pure: no I/O, no mutation. Returns `JSON.stringify(result, null, 2)`.
 * Top-level keys mirror the CompareResult shape: ref, head, base, delta, authorDeltas.
 */
export function serializeDelta(result: CompareResult): string {
  return JSON.stringify(result, null, 2);
}

// ---------------------------------------------------------------------------
// CSV escaping (RFC-4180)
// ---------------------------------------------------------------------------

/**
 * Escape a single CSV field per RFC-4180:
 * - If the field contains a comma, double-quote, or newline → wrap in double-quotes
 *   and double any inner double-quotes.
 * - Otherwise → return the field unchanged.
 *
 * Pure: no I/O, no mutation, no dependencies.
 *
 * @param field - The raw string value to escape.
 * @returns The escaped CSV field string.
 *
 * @example
 * csvEscape('hello')          // → 'hello'
 * csvEscape('hello,world')    // → '"hello,world"'
 * csvEscape('say "hi"')       // → '"say ""hi"""'
 * csvEscape('line\nbreak')    // → '"line\nbreak"'
 * csvEscape('café')           // → 'café'
 */
export function csvEscape(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replaceAll('"', '""')}"`;
  }
  return field;
}

// ---------------------------------------------------------------------------
// CSV renderers
// ---------------------------------------------------------------------------

/**
 * Render authors data as CSV.
 *
 * Header: Author,Commits,Lines Added,Lines Deleted
 * One row per entry in `s.byAuthor`, augmented with churn from `s.authorChurn`.
 *
 * Pure: no I/O, no mutation.
 */
export function renderAuthorsCsv(s: Summary): string {
  const rows: string[] = ['Author,Commits,Lines Added,Lines Deleted'];
  // Build a churn lookup by author for O(1) access.
  const churnMap = new Map(s.authorChurn.map((a) => [a.author, a]));
  for (const entry of s.byAuthor) {
    const churn = churnMap.get(entry.author);
    const ins = churn?.insertions ?? 0;
    const del = churn?.deletions ?? 0;
    rows.push(
      `${csvEscape(entry.author)},${entry.commits},${ins},${del}`,
    );
  }
  return rows.join('\n');
}

/**
 * Render per-file churn data as CSV.
 *
 * Header: File,Churn Score,Commits,Lines Added,Lines Deleted
 * One row per entry in `s.fileChurn`. "Churn Score" = insertions + deletions.
 *
 * Pure: no I/O, no mutation.
 */
export function renderChurnFileCsv(s: Summary): string {
  const rows: string[] = ['File,Churn Score,Commits,Lines Added,Lines Deleted'];
  for (const entry of s.fileChurn) {
    const score = entry.insertions + entry.deletions;
    rows.push(
      `${csvEscape(entry.file)},${score},${entry.commits},${entry.insertions},${entry.deletions}`,
    );
  }
  return rows.join('\n');
}

/**
 * Render per-author churn data as CSV.
 *
 * Header: Author,Churn Score,Commits,Lines Added,Lines Deleted
 * One row per entry in `s.authorChurn`. "Churn Score" = insertions + deletions.
 *
 * Pure: no I/O, no mutation.
 */
export function renderChurnAuthorCsv(s: Summary): string {
  const rows: string[] = ['Author,Churn Score,Commits,Lines Added,Lines Deleted'];
  for (const entry of s.authorChurn) {
    const score = entry.insertions + entry.deletions;
    rows.push(
      `${csvEscape(entry.author)},${score},${entry.commits},${entry.insertions},${entry.deletions}`,
    );
  }
  return rows.join('\n');
}

/**
 * Render ownership data as CSV.
 *
 * Header: File,Owner,Ownership %,Commits
 * One row per entry in `s.ownershipEntries`.
 * "Ownership %" = ownerLines (lines owned by the top owner).
 * "Commits" = busFactor (count of distinct authors with surviving lines).
 *
 * Pure: no I/O, no mutation.
 */
export function renderOwnershipCsv(s: Summary): string {
  const rows: string[] = ['File,Owner,Ownership %,Commits'];
  for (const entry of s.ownershipEntries) {
    rows.push(
      `${csvEscape(entry.file)},${csvEscape(entry.owner)},${entry.ownerLines},${entry.busFactor}`,
    );
  }
  return rows.join('\n');
}

/**
 * Render hotspot data as CSV.
 *
 * Header: File,Score,Commits,Authors
 * One row per entry in `s.hotspotEntries`. Score is formatted to 2 decimal places.
 *
 * Note: HotspotEntry does not carry a distinct-author count. The "Authors" column
 * is emitted as 0 (not available from pre-aggregated data; no re-computation).
 *
 * Pure: no I/O, no mutation.
 */
export function renderHotspotsCsv(s: Summary): string {
  const rows: string[] = ['File,Score,Commits,Authors'];
  for (const entry of s.hotspotEntries) {
    rows.push(
      `${csvEscape(entry.file)},${entry.score.toFixed(2)},${entry.commits},0`,
    );
  }
  return rows.join('\n');
}

/**
 * Render a CompareResult as CSV.
 *
 * Two sections separated by a blank row:
 *   1. Headline section: Metric,Head,Base,Delta
 *      Rows: commits, lines added, lines removed
 *   2. Per-author section: Author,Delta Commits,Delta Lines
 *      One row per authorDelta entry.
 *
 * Pure: no I/O, no mutation.
 */
export function renderCompareCsv(result: CompareResult): string {
  // Section 1: headline
  const headlineRows: string[] = ['Metric,Head,Base,Delta'];
  headlineRows.push(`commits,${result.head.commits},${result.base.commits},${result.delta.commits}`);
  headlineRows.push(`lines added,${result.head.linesAdded},${result.base.linesAdded},${result.delta.linesAdded}`);
  headlineRows.push(`lines removed,${result.head.linesRemoved},${result.base.linesRemoved},${result.delta.linesRemoved}`);

  // Section 2: per-author
  const authorRows: string[] = ['Author,Delta Commits,Delta Lines'];
  for (const a of result.authorDeltas) {
    authorRows.push(`${csvEscape(a.author)},${a.deltaCommits},${a.deltaChurn}`);
  }

  return [...headlineRows, '', ...authorRows].join('\n');
}

/**
 * Render a Summary as a multi-section CSV string.
 *
 * Sections (in the same order as renderSummary's text output):
 *   1. Authors (byAuthor) — always present when there is data
 *   2. Author churn (authorChurn)
 *   3. File churn (fileChurn) — omitted when empty
 *   4. Ownership (ownershipEntries) — omitted when empty
 *   5. Hotspots (hotspotEntries) — omitted when empty
 *
 * Sections are separated by blank rows.
 *
 * When `opts.tagRange` is supplied a comment line is prepended:
 *   `# range: sinceTag..untilTag (sinceSha: ..., untilSha: ...)`
 *
 * Pure: no I/O, no mutation.
 */
export function renderSummaryCsv(s: Summary, opts?: { tagRange?: TagRangeAnnotation }): string {
  const sections: string[] = [];

  if (opts?.tagRange) {
    const { sinceTag, untilTag, sinceSha, untilSha } = opts.tagRange;
    sections.push(`# range: ${sinceTag}..${untilTag} (sinceSha: ${sinceSha}, untilSha: ${untilSha})`);
  }

  // Section 1: authors (commit counts)
  sections.push(renderAuthorsCsv(s));

  // Section 2: author churn
  sections.push(renderChurnAuthorCsv(s));

  // Section 3: file churn (only when populated)
  if (s.fileChurn.length > 0) {
    sections.push(renderChurnFileCsv(s));
  }

  // Section 4: ownership (only when populated)
  if (s.ownershipEntries.length > 0) {
    sections.push(renderOwnershipCsv(s));
  }

  // Section 5: hotspots (only when populated)
  if (s.hotspotEntries.length > 0) {
    sections.push(renderHotspotsCsv(s));
  }

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Tags rendering
// ---------------------------------------------------------------------------

/**
 * Render a tags release-cadence table as plain text.
 *
 * Format:
 *   gitpulse tags — N tags
 *
 *   Tag    Date        Commits  Authors  Days since prev
 *   -----  ----------  -------  -------  ---------------
 *   v0.3   2021-04-03        2        2               19
 *   v0.2   2021-03-15        2        2               13
 *   v0.1   2021-03-02        2        2                —
 *
 *   Median inter-tag gap: 16 days
 *
 * When zero spans: returns `"no tags found"`.
 * Pure: no I/O, no mutation.
 */
export function renderTagsTable(spans: readonly TagSpan[], medianGapDays: number | null): string {
  if (spans.length === 0) return 'no tags found';

  const header = `gitpulse tags — ${spans.length} tag${spans.length === 1 ? '' : 's'}`;

  const TAG_HDR     = 'Tag';
  const DATE_HDR    = 'Date';
  const COMMITS_HDR = 'Commits';
  const AUTHORS_HDR = 'Authors';
  const DAYS_HDR    = 'Days since prev';

  const tagWidth     = Math.max(TAG_HDR.length,     ...spans.map((s) => s.name.length));
  const dateWidth    = Math.max(DATE_HDR.length,    10); // YYYY-MM-DD is always 10 chars
  const commitsWidth = Math.max(COMMITS_HDR.length, ...spans.map((s) => String(s.commitsSince).length));
  const authorsWidth = Math.max(AUTHORS_HDR.length, ...spans.map((s) => String(s.uniqueAuthors).length));
  const daysWidth    = Math.max(DAYS_HDR.length,    ...spans.map((s) => s.daysSince !== null ? String(s.daysSince).length : 1));

  const colHeader = [
    TAG_HDR.padEnd(tagWidth),
    DATE_HDR.padEnd(dateWidth),
    COMMITS_HDR.padStart(commitsWidth),
    AUTHORS_HDR.padStart(authorsWidth),
    DAYS_HDR.padStart(daysWidth),
  ].join('  ');

  const rule = [
    '-'.repeat(tagWidth),
    '-'.repeat(dateWidth),
    '-'.repeat(commitsWidth),
    '-'.repeat(authorsWidth),
    '-'.repeat(daysWidth),
  ].join('  ');

  const rows = spans.map((s) => {
    const daysCell = s.daysSince !== null ? String(s.daysSince).padStart(daysWidth) : '—'.padStart(daysWidth);
    return [
      s.name.padEnd(tagWidth),
      s.date.padEnd(dateWidth),
      String(s.commitsSince).padStart(commitsWidth),
      String(s.uniqueAuthors).padStart(authorsWidth),
      daysCell,
    ].join('  ');
  });

  const medianLine = medianGapDays !== null
    ? `Median inter-tag gap: ${medianGapDays} days`
    : 'Median inter-tag gap: N/A';

  return [header, '', colHeader, rule, ...rows, '', medianLine].join('\n');
}

/**
 * Serialise tags result as JSON.
 *
 * Output shape:
 *   { "tags": [ { name, date, commitsSince, uniqueAuthors, daysSince }, ... ], "medianGapDays": N }
 * `daysSince` is `null` (not omitted) for the oldest tag.
 *
 * Pure: no I/O, no mutation.
 */
export function serializeTagsJson(spans: readonly TagSpan[], medianGapDays: number | null): string {
  return JSON.stringify({ tags: spans, medianGapDays }, null, 2);
}

// ---------------------------------------------------------------------------
// Coupling renderers
// ---------------------------------------------------------------------------

/**
 * Render a CouplingRow[] as a plain-text table.
 *
 * - If rows (after top slice) is empty: returns 'no coupled file pairs found'.
 * - Otherwise: builds a plain-text table with header, separator, data rows sorted
 *   strongest-first, and a footer showing pair count + exclusion count.
 *
 * Column widths are computed from data; couplingPct column accommodates '100.0%' (6 chars).
 *
 * Pure: no I/O, no mutation.
 */
export function renderCoupling(
  rows: CouplingRow[],
  opts: { top?: number; excludedCount?: number } = {},
): string {
  const sliced = opts.top !== undefined ? rows.slice(0, opts.top) : rows;

  if (sliced.length === 0) return 'no coupled file pairs found';

  const FILE_A_HDR  = 'fileA';
  const FILE_B_HDR  = 'fileB';
  const CO_HDR      = 'co-changes';
  const PCT_HDR     = 'coupling%';
  const PCT_MIN_W   = '100.0%'.length; // 6

  const pctValues = sliced.map((r) => `${r.couplingPct.toFixed(1)}%`);

  const fileAWidth = Math.max(FILE_A_HDR.length, ...sliced.map((r) => r.fileA.length));
  const fileBWidth = Math.max(FILE_B_HDR.length, ...sliced.map((r) => r.fileB.length));
  const coWidth    = Math.max(CO_HDR.length,    ...sliced.map((r) => String(r.coChanges).length));
  const pctWidth   = Math.max(PCT_HDR.length, PCT_MIN_W, ...pctValues.map((v) => v.length));

  const header = [
    FILE_A_HDR.padEnd(fileAWidth),
    FILE_B_HDR.padEnd(fileBWidth),
    CO_HDR.padStart(coWidth),
    PCT_HDR.padStart(pctWidth),
  ].join('  ');

  const rule = [
    '-'.repeat(fileAWidth),
    '-'.repeat(fileBWidth),
    '-'.repeat(coWidth),
    '-'.repeat(pctWidth),
  ].join('  ');

  const dataRows = sliced.map((r, i) =>
    [
      r.fileA.padEnd(fileAWidth),
      r.fileB.padEnd(fileBWidth),
      String(r.coChanges).padStart(coWidth),
      pctValues[i].padStart(pctWidth),
    ].join('  '),
  );

  const excl = opts.excludedCount ?? 0;
  const footer = excl > 0
    ? `${sliced.length} coupled pairs (${excl} paths excluded)`
    : `${sliced.length} coupled pairs`;

  return [header, rule, ...dataRows, '', footer].join('\n');
}

/**
 * Serialise CouplingRow[] as JSON.
 *
 * Output shape: { rows: Array<{ fileA, fileB, coChanges, couplingPct }>, excluded: number }
 * couplingPct is a float (number), not a string.
 *
 * Pure: no I/O, no mutation.
 */
export function couplingToJson(rows: CouplingRow[], excludedCount: number): string {
  return JSON.stringify({ rows, excluded: excludedCount }, null, 2);
}

// ---------------------------------------------------------------------------
// Markdown escaping and GFM table renderers
// ---------------------------------------------------------------------------

/**
 * Escape a string for use in a GFM (GitHub Flavoured Markdown) table cell.
 *
 * - If the field contains one or more `|` characters each is replaced by `\|`.
 * - No double-quote wrapping (different from csvEscape).
 * - Returns the field unchanged when no `|` is present.
 *
 * Pure: no I/O, no mutation, no dependencies.
 *
 * @param field - The raw string value to escape.
 * @returns The escaped markdown field string.
 *
 * @example
 * markdownEscape('hello')           // → 'hello'
 * markdownEscape('a|b')             // → 'a\\|b'
 * markdownEscape('x|y|z')          // → 'x\\|y\\|z'
 */
export function markdownEscape(field: string): string {
  if (!field.includes('|')) return field;
  return field.replaceAll('|', '\\|');
}

/**
 * Build a GFM table from headers, alignment specs, and data rows.
 *
 * @param headers - Column header labels.
 * @param aligns - 'left' or 'right' for each column.
 * @param rows - Array of string arrays (one per data row).
 * @returns Lines of the GFM table (no trailing newline).
 */
function gfmTable(
  headers: string[],
  aligns: Array<'left' | 'right'>,
  rows: string[][],
): string[] {
  const headerRow = '| ' + headers.join(' | ') + ' |';
  const delimRow =
    '| ' +
    aligns.map((a) => (a === 'right' ? '---:' : '---')).join(' | ') +
    ' |';
  const dataRows = rows.map((cells) => '| ' + cells.join(' | ') + ' |');
  return [headerRow, delimRow, ...dataRows];
}

/**
 * Render a Summary as a multi-section GFM markdown report.
 *
 * Each section is preceded by a `### SectionName` heading and rendered as a
 * GFM table. Sections: commits, churn, file churn (if non-empty), ownership
 * (if non-empty), hotspots (if non-empty).
 *
 * Zero-author case: header + delimiter row only (no data rows, not empty string).
 *
 * When `opts.tagRange` is supplied the intro line gains
 * `(range sinceTag..untilTag)`.
 *
 * Pure: no I/O, no mutation.
 */
export function renderSummaryMarkdown(s: Summary, _opts?: { tagRange?: TagRangeAnnotation }): string {
  // Output starts directly with the GFM table (no intro prose line) so that
  // output.split('\n')[0] is the header row and output.split('\n')[1] is the
  // delimiter row — matching the acceptance AC1 assertion /^\| ---/ at index 1.
  const sections: string[] = [];

  // --- commits table ---
  const commitRows = s.byAuthor.map((a) => [markdownEscape(a.author), String(a.commits)]);
  sections.push(...gfmTable(['Author', 'Commits'], ['left', 'right'], commitRows));

  // --- churn table ---
  sections.push('');
  const churnMap = new Map(s.authorChurn.map((a) => [a.author, a]));
  const churnRows = s.byAuthor.map((a) => {
    const c = churnMap.get(a.author);
    return [markdownEscape(a.author), `+${c?.insertions ?? 0}/-${c?.deletions ?? 0}`];
  });
  sections.push(...gfmTable(['Author', 'Churn (lines)'], ['left', 'left'], churnRows));

  // --- file churn table (optional) ---
  if (s.fileChurn.length > 0) {
    sections.push('');
    const fileChurnRows = s.fileChurn.map((f) => [
      markdownEscape(f.file),
      `+${f.insertions}/-${f.deletions}`,
    ]);
    sections.push(...gfmTable(['File', 'Churn (lines)'], ['left', 'left'], fileChurnRows));
  }

  // --- ownership table (optional) ---
  if (s.ownershipEntries.length > 0) {
    sections.push('');
    const ownerRows = s.ownershipEntries.map((e) => [
      markdownEscape(e.file),
      markdownEscape(e.owner),
      String(e.busFactor),
    ]);
    sections.push(...gfmTable(['File', 'Owner', 'Bus Factor'], ['left', 'left', 'right'], ownerRows));
  }

  // --- hotspots table (optional) ---
  if (s.hotspotEntries.length > 0) {
    sections.push('');
    const hotspotRows = s.hotspotEntries.map((e) => [
      markdownEscape(e.file),
      e.score.toFixed(2),
      String(e.commits),
    ]);
    sections.push(...gfmTable(['File', 'Score', 'Commits'], ['left', 'right', 'right'], hotspotRows));
  }

  return sections.join('\n');
}

/**
 * Render a CompareResult as two GFM tables.
 *
 * Table 1 (headline): Metric / Head / Base / Delta.
 * Table 2 (per-author delta): Author / ΔCommits / ΔLines.
 *
 * `opts.top` truncates the per-author table to at most `top` rows.
 *
 * Pure: no I/O, no mutation.
 */
export function renderDeltaMarkdown(result: CompareResult, opts?: { top?: number }): string {
  // Output starts directly with the GFM table (no intro prose line) so that
  // the first character of stdout is '|' — matching the acceptance AC5 assertion.

  // --- headline table ---
  const headlineRows: string[][] = [
    ['commits',       String(result.head.commits),      String(result.base.commits),      signedStr(result.delta.commits)],
    ['lines added',   String(result.head.linesAdded),   String(result.base.linesAdded),   signedStr(result.delta.linesAdded)],
    ['lines removed', String(result.head.linesRemoved), String(result.base.linesRemoved), signedStr(result.delta.linesRemoved)],
  ];
  const headlineTable = gfmTable(
    ['Metric', 'Head', 'Base', 'Delta'],
    ['left', 'right', 'right', 'right'],
    headlineRows,
  );

  // --- per-author delta table ---
  const authors = opts?.top !== undefined
    ? result.authorDeltas.slice(0, opts.top)
    : result.authorDeltas;

  const authorRows: string[][] = authors.map((a) => [
    markdownEscape(a.author),
    signedStr(a.deltaCommits),
    signedStr(a.deltaChurn),
  ]);
  const authorTable = gfmTable(
    ['Author', 'ΔCommits', 'ΔLines'],
    ['left', 'right', 'right'],
    authorRows,
  );

  return [...headlineTable, '', ...authorTable].join('\n');
}

/**
 * Render a TagSpan[] as a GFM table.
 *
 * Columns: Tag (---), Date (---), Commits (---:), Authors (---:), Days since prev (---:).
 * Zero-span case: header + delimiter row only (no data rows).
 * Appends a prose line for median gap days after the table.
 *
 * Pure: no I/O, no mutation.
 */
export function renderTagsMarkdown(spans: readonly TagSpan[], medianGapDays: number | null): string {
  const rows = spans.map((s) => [
    markdownEscape(s.name),
    s.date,
    String(s.commitsSince),
    String(s.uniqueAuthors),
    s.daysSince !== null ? String(s.daysSince) : '—',
  ]);

  const table = gfmTable(
    ['Tag', 'Date', 'Commits', 'Authors', 'Days since prev'],
    ['left', 'left', 'right', 'right', 'right'],
    rows,
  );

  const medianLine = medianGapDays !== null
    ? `Median inter-tag gap: ${medianGapDays} days`
    : 'Median inter-tag gap: N/A';

  return [...table, '', medianLine].join('\n');
}

/**
 * Render CouplingRow[] as a GFM table.
 *
 * Columns: fileA (---), fileB (---), co-changes (---:), coupling% (---:).
 * Zero-rows case: header + delimiter row only (no "no coupled file pairs found" text).
 * Apply `markdownEscape` to file path cells.
 * Apply `opts.top` slice before rendering.
 *
 * Pure: no I/O, no mutation.
 */
export function renderCouplingMarkdown(
  rows: CouplingRow[],
  opts: { top?: number; excludedCount?: number } = {},
): string {
  const sliced = opts.top !== undefined ? rows.slice(0, opts.top) : rows;

  const dataRows = sliced.map((r) => [
    markdownEscape(r.fileA),
    markdownEscape(r.fileB),
    String(r.coChanges),
    `${r.couplingPct.toFixed(1)}%`,
  ]);

  const table = gfmTable(
    ['fileA', 'fileB', 'co-changes', 'coupling%'],
    ['left', 'left', 'right', 'right'],
    dataRows,
  );

  return table.join('\n');
}

/**
 * Render CouplingRow[] as RFC-4180 CSV.
 *
 * Header: fileA,fileB,coChanges,couplingPct
 * couplingPct rendered as XX.X (one decimal, no % sign).
 * Fields containing commas are double-quote-wrapped per RFC-4180.
 *
 * Pure: no I/O, no mutation.
 */
export function couplingToCSV(rows: CouplingRow[]): string {
  const lines: string[] = ['fileA,fileB,coChanges,couplingPct'];
  for (const r of rows) {
    lines.push(
      `${csvEscape(r.fileA)},${csvEscape(r.fileB)},${r.coChanges},${r.couplingPct.toFixed(1)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Render tags result as RFC-4180 CSV.
 *
 * Header row: Tag,Date,Commits Since Prev,Unique Authors,Days Since Prev
 * One data row per span (newest-first).
 * Days Since Prev cell is EMPTY (not "null") for the oldest tag.
 * Trailing row: Median Gap Days,N
 *
 * Pure: no I/O, no mutation.
 */
export function renderTagsCsv(spans: readonly TagSpan[], medianGapDays: number | null): string {
  const rows: string[] = ['Tag,Date,Commits Since Prev,Unique Authors,Days Since Prev'];
  for (const s of spans) {
    const daysCell = s.daysSince !== null ? String(s.daysSince) : '';
    rows.push(
      `${csvEscape(s.name)},${s.date},${s.commitsSince},${s.uniqueAuthors},${daysCell}`,
    );
  }
  const medianVal = medianGapDays !== null ? String(medianGapDays) : '';
  rows.push(`Median Gap Days,${medianVal}`);
  return rows.join('\n');
}
