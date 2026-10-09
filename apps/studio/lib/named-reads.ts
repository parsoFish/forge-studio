/**
 * forge-nk1y.9 — a page load made of several bridge reads, each NAMED, so the
 * page can say which one it is still waiting on and which one failed.
 *
 * `Promise.all` alone answers neither: a page whose fourth read stalls shows
 * nothing different from one whose bridge never answered at all, and a
 * rejection carries the bridge's message but not which read it came from.
 */

type Reads<T extends readonly unknown[]> = { readonly [K in keyof T]: readonly [name: string, read: Promise<T[K]>] };

export type NamedReadListeners = {
  /** The names still unsettled — first all of them, then again after each settles. */
  onPending: (names: readonly string[]) => void;
  /** The name of the FIRST read to reject (called once, before the rejection lands). */
  onFailed: (name: string) => void;
};

/**
 * Await every read, reporting progress by name. Resolves the values in order;
 * rejects with the first failing read's ORIGINAL error (so the shared bridge-error
 * classifier still sees its status), having named that read through `onFailed`.
 */
export function allNamedReads<T extends readonly unknown[]>(reads: Reads<T>, listeners: NamedReadListeners): Promise<T> {
  let pending: readonly string[] = reads.map(([name]) => name);
  let failed = false;
  listeners.onPending(pending);
  const settle = (name: string): void => {
    pending = pending.filter((n) => n !== name);
    listeners.onPending(pending);
  };
  return Promise.all(
    reads.map(([name, read]) =>
      read.then(
        (value) => { settle(name); return value; },
        (err: unknown) => {
          settle(name);
          if (!failed) { failed = true; listeners.onFailed(name); }
          throw err;
        },
      ),
    ),
  ) as unknown as Promise<T>;
}
