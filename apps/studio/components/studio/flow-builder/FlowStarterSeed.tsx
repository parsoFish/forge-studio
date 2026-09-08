'use client';

import { useCallback, useState } from 'react';
import { seedStarterAgents } from '@/lib/starters-client';
import { disabledAttrs } from '@/lib/disabled-reason';

// ---------------------------------------------------------------------------
// FlowStarterSeed — "seed the starter agents", and the report of what it wrote.
//
// Operator ruling 384 (shape settled by 459/474). Saving a flow used to
// materialise `dev`/`plan`/`review` silently, because the save folded their
// definitions into the agents map so `validateFlow`'s agent-ref check would
// pass. An operator who dragged a seeded canvas and pressed Save gained three
// agents in `skills/` they never authored. The save now writes NO roster agent
// and REFUSES a flow whose starters are unseeded, naming them; this control is
// the only thing that writes one, and only when it is pressed.
//
// WHY IT REPORTS THE UNION, NOT WHAT IT JUST WROTE. `data-seeded-starter-count`
// and `data-seeded-starters` answer "what does forge have", not "what did this
// click do". A second press writes nothing and must still be able to say the
// three exist — the bridge reports `seeded` and `existing` separately for
// exactly that, and this is where they are joined. Reporting only `seeded`
// would make an idempotent action look like a failed one.
//
// Its own file rather than more lines in `FlowHeader`: that file is 688 lines
// against an 800-line cap, and its sibling `FlowBuilderCanvas` is at 799 with
// no baseline. Contract: `docs/reference/studio-dom-contract.md`.
// ---------------------------------------------------------------------------

export function FlowStarterSeed() {
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const seed = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await seedStarterAgents();
    if (!r.ok) {
      // Named, never swallowed: a roster that silently did not materialise is
      // how the operator meets a refused save with no idea why.
      setError(r.error ?? 'could not seed the starter agents');
      setNames(null);
    } else {
      setNames([...new Set([...r.seeded, ...r.existing])].sort());
    }
    setBusy(false);
  }, []);

  return (
    <div
      data-component="flow-starter-seed"
      // Omitted, never zeroed, until a seed has actually answered — the same
      // discipline the ledger's cost attribute keeps. An absent attribute means
      // "nothing has been asked yet"; `0` would be a claim about the roster.
      {...(names === null ? {} : { 'data-seeded-starter-count': String(names.length), 'data-seeded-starters': names.join(',') })}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
    >
      <button
        data-action="seed-starter-agents"
        {...disabledAttrs(busy ? 'Seeding…' : null)}
        onClick={() => void seed()}
        className="btn"
      >
        {busy ? 'Seeding…' : 'Seed starter agents'}
      </button>
      {names !== null && (
        <span style={{ fontSize: 11.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
          {names.join(', ')}
        </span>
      )}
      {error !== null && (
        <span data-component="starter-seed-error" style={{ fontSize: 11.5, color: 'var(--red)' }}>
          {error}
        </span>
      )}
    </div>
  );
}
