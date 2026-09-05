/**
 * factory-cli-wiring.ts — the CLI's half of the example-factory seam
 * (ADR 048 clause 2). `forge demo capture` / `forge demo render` / `forge gate
 * docs` are the example's verbs; nothing here is reachable from a bridge route.
 *
 * WHY THIS IS A SECOND FILE, and not a second seam. `factory-wiring.ts` is
 * resolved by the BRIDGE at boot, so every specifier it names joins the
 * bridge's static module graph — and `demo.ts` drags in the capture machinery
 * (`demo-capture.ts`, `demo-runtime.ts`: `execFileSync`, `mkdirSync`) while
 * `gates/docs-gate.ts` adds its own reads. Naming all three there put SEVENTEEN
 * new (file, sink) pairs into the bridge's graph for surfaces the bridge never
 * calls. `check-request-path-sinks` reported every one, and the honest answer
 * is to keep those specifiers out of that graph, not to widen its baseline.
 *
 * The invariant clause 2 is actually about — no package may import the example,
 * and the assembly names it in a FIXED, ENUMERATED set of modules that all
 * treat absence as a supported state — is unchanged, and
 * `scripts/factory-deletable.mjs` allows exactly these two files.
 */
import { NO_EXAMPLE_INSTALLED, isFactoryNotInstalled, requireInstalledFactory } from './factory-wiring.ts';

export { requireInstalledFactory };

export type FactoryDemo = {
  readonly captureCheckpoints: typeof import('@forge/factory/demo.ts')['captureCheckpoints'];
  readonly model: typeof import('@forge/factory/demo-model.ts');
};

/** The demo verbs, or `null` when no example is installed. */
export async function resolveFactoryDemo(): Promise<FactoryDemo | null> {
  try {
    const [demo, model] = await Promise.all([
      import('@forge/factory/demo.ts'),
      import('@forge/factory/demo-model.ts'),
    ]);
    return { captureCheckpoints: demo.captureCheckpoints, model };
  } catch (err) {
    if (!isFactoryNotInstalled(err)) throw err;
    return null;
  }
}

/** The demo verbs, or a loud usage-error exit naming the verb that asked. */
export async function requireFactoryDemo(verb: string): Promise<FactoryDemo> {
  const demo = await resolveFactoryDemo();
  if (demo === null) { console.error(`${verb}: ${NO_EXAMPLE_INSTALLED}`); process.exit(2); }
  return demo;
}

/** `forge gate docs`'s rules (spec §5 item 6), or `null` when no example is installed. */
export async function resolveDocsGate(): Promise<typeof import('@forge/factory/gates/docs-gate.ts')['runDocsGate'] | null> {
  try {
    return (await import('@forge/factory/gates/docs-gate.ts')).runDocsGate;
  } catch (err) {
    if (!isFactoryNotInstalled(err)) throw err;
    return null;
  }
}

/** The same, or a loud usage-error exit — a gate that greens because its rules were missing is the failure this guards. */
export async function requireDocsGate(verb: string): Promise<typeof import('@forge/factory/gates/docs-gate.ts')['runDocsGate']> {
  const gate = await resolveDocsGate();
  if (gate === null) { console.error(`${verb}: ${NO_EXAMPLE_INSTALLED}`); process.exit(2); }
  return gate;
}
