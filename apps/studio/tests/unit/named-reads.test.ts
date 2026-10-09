/** forge-nk1y.9 — `allNamedReads` reports what is still pending and names the read that failed. */
import { test, expect } from 'vitest';
import { allNamedReads } from '@/lib/named-reads';

test('reports every read pending, then each as it settles, and resolves the values in order', async () => {
  const seen: string[][] = [];
  let release!: (v: number) => void;
  const slow = new Promise<number>((r) => { release = r; });
  const all = allNamedReads([['a', Promise.resolve('x')], ['b', slow]] as const, { onPending: (n) => seen.push([...n]), onFailed: () => {} });
  await Promise.resolve(); await Promise.resolve();
  expect(seen).toEqual([['a', 'b'], ['b']]);
  release(2);
  expect(await all).toEqual(['x', 2]);
  expect(seen.at(-1)).toEqual([]);
});

test('names the FIRST failed read once and rejects with its original error', async () => {
  const cause = Object.assign(new Error('flows exploded'), { status: 500 });
  const failed: string[] = [];
  const err = await allNamedReads(
    [['the roster', Promise.resolve(1)], ['the flows', Promise.reject(cause)], ['the catalog', Promise.reject(new Error('later'))]] as const,
    { onPending: () => {}, onFailed: (n) => failed.push(n) },
  ).catch((e: unknown) => e);
  expect(err).toBe(cause);
  await Promise.resolve();
  expect(failed).toEqual(['the flows']);
});
