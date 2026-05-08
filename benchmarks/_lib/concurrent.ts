/**
 * Bounded-concurrency map helper. For benchmark runners — independent SDK
 * calls per case, no shared state, but we want to cap concurrency to avoid
 * tripping rate limits. Order-preserving: results[i] corresponds to items[i].
 *
 * Why not Promise.all + a queue lib: 20 lines of TS does the job and we don't
 * pull a dep for one harness concern.
 */

export async function mapConcurrent<TIn, TOut>(
  items: readonly TIn[],
  concurrency: number,
  worker: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (concurrency < 1) throw new Error(`mapConcurrent: concurrency must be >= 1, got ${concurrency}`);
  const results: TOut[] = new Array(items.length);
  let cursor = 0;

  async function consume(): Promise<void> {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const workers: Promise<void>[] = [];
  const n = Math.min(concurrency, items.length);
  for (let i = 0; i < n; i += 1) workers.push(consume());
  await Promise.all(workers);

  return results;
}
