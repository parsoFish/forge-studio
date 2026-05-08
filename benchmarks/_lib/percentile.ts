/**
 * Percentile helper. Universal across phase benchmarks — every phase reports
 * latency aggregates somehow. Linear interpolation between adjacent ranks.
 */

export function p95(values: number[]): number {
  return percentile(values, 95);
}

export function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}
