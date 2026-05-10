export function distributeFlow(volume: number, weights: number[]): number[] {
  if (volume < 0) throw new Error('volume must be non-negative');
  if (weights.length === 0) throw new Error('weights must be non-empty');
  for (const w of weights) {
    if (!Number.isFinite(w)) throw new Error('weight must be finite');
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error('weights must have positive sum');
  return weights.map((w) => (volume * w) / total);
}
