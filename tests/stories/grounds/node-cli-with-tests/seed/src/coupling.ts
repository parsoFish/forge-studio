/**
 * Coupling analytics module.
 *
 * Computes file co-change coupling from a list of commits.
 * Pure, zero-I/O — operates only on the Commit[] it is handed.
 */

import type { Commit } from './git.ts';

export interface CouplingRow {
  fileA: string;
  fileB: string;
  coChanges: number;
  couplingPct: number; // 0–100, one decimal place precision in value
}

/**
 * Compute file coupling from a list of commits.
 *
 * Algorithm:
 * 1. Per-file commit count (single pass).
 * 2. Per-pair co-change count (single pass, unordered pairs from commits with ≥2 files).
 * 3. Pair key normalised as [min(a,b), max(a,b)] — prevents double-counting.
 * 4. couplingPct = coChanges / max(countA, countB) * 100, rounded to one decimal.
 * 5. Filter out pairs with coChanges < 1.
 * 6. Sort: coChanges desc, couplingPct desc, fileA asc, fileB asc.
 */
export function computeCoupling(commits: Commit[]): CouplingRow[] {
  // Step 1: per-file commit count
  const fileCount = new Map<string, number>();
  for (const commit of commits) {
    for (const f of commit.files) {
      fileCount.set(f.path, (fileCount.get(f.path) ?? 0) + 1);
    }
  }

  // Step 2 & 3: co-change counts with normalised pair keys
  const pairCount = new Map<string, number>();

  for (const commit of commits) {
    const files = commit.files.map(f => f.path);
    if (files.length < 2) continue;

    // Enumerate all unordered pairs
    for (let i = 0; i < files.length - 1; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const a = files[i];
        const b = files[j];
        const key = a < b ? `${a}\0${b}` : `${b}\0${a}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  // Step 4 & 5: build rows, filter zeros
  const rows: CouplingRow[] = [];
  for (const [key, coChanges] of pairCount) {
    if (coChanges < 1) continue;
    const [fileA, fileB] = key.split('\0');
    const countA = fileCount.get(fileA) ?? 0;
    const countB = fileCount.get(fileB) ?? 0;
    const maxCount = Math.max(countA, countB);
    const couplingPct = maxCount > 0
      ? Math.round((coChanges / maxCount) * 1000) / 10
      : 0;
    rows.push({ fileA, fileB, coChanges, couplingPct });
  }

  // Step 6: sort — coChanges desc, couplingPct desc, fileA asc, fileB asc
  rows.sort((a, b) => {
    if (b.coChanges !== a.coChanges) return b.coChanges - a.coChanges;
    if (b.couplingPct !== a.couplingPct) return b.couplingPct - a.couplingPct;
    if (a.fileA !== b.fileA) return a.fileA < b.fileA ? -1 : 1;
    return a.fileB < b.fileB ? -1 : 1;
  });

  return rows;
}
