/**
 * RunView — the standalone run view (R6-04 WI-4 items 3+4) behind route
 * `/agents/[id]/run/[runId]`. A pure, props-driven presentational
 * component: the actual `app/agents/[id]/run/[runId]/page.tsx` is a thin
 * client shell that fetches `GET /api/agents/runs/:runId` (whose new
 * `lines` field, R6-04 WI-4 item 1, feeds this component directly) and
 * renders `<RunView .../>` with the resolved data — mirroring the RunPanel
 * precedent (`./RunPanel.tsx`) exactly. That client-side fetch wiring is
 * verified by `tsc` only (no jsdom / `@testing-library/react` in this repo
 * — see `../../../lib/run-panel-render.test.ts`'s header for the full
 * rationale); a real-browser journey beat (a later work item) proves it end
 * to end.
 *
 * Renders the shared `RunLog` (composed, never reimplemented), the run's
 * cost, materials and ceiling provenance READ-ONLY (no editable control —
 * that lives only on the pre-dispatch `RunPanel`, not on a view of a run
 * that already happened), and typed outputs as collapsed-by-default
 * `<details>` cards carrying the full artifact body.
 *
 * Materials render as REFERENCES only (path + kind) — NEVER contents, even
 * if a caller's data happens to carry a `contents`-shaped field alongside
 * path/kind (this component destructures only path/kind, so anything else
 * on the object is structurally unreachable here).
 *
 * `found: false` (no dispatch record exists for this runId) suppresses
 * EVERY other section — even if the caller also supplied non-empty lines/
 * materials/outputs/ceiling — degrading honestly rather than leaking
 * fabricated content through a not-found path.
 */

import { RunLog } from '@/components/studio/RunLog';
import type { RunLogLine } from '@/lib/run-log-line';

export type RunMaterialRef = { path: string; kind: string };

export type RunViewProps = {
  runId: string;
  /** false = no dispatch record exists for this runId. */
  found: boolean;
  /** Passthrough of `GET /api/agents/runs/:runId`'s `state`. */
  state: string;
  /** Passthrough of `costUsd`. */
  costUsd: number;
  lines: RunLogLine[];
  materials: RunMaterialRef[];
  /** undefined = no ceiling was ever set for this run. */
  ceilingUsd?: number;
  /** W7-B5 (agents-06 / forge-75j): the run's REAL output references (the
   *  end event's own `output_refs`, served on the wire) — replaces the old
   *  typed `RunOutput[]` section that was hard-wired to `[]` and could never
   *  show anything. */
  outputRefs: string[];
  /** W7-B5 (agents-19): the dispatch failure's own recorded reason —
   *  rendered verbatim as a banner. Absent when the run never failed. */
  errorText?: string;
  /**
   * Debt-T trigger plumbing: what started this run, mirroring
   * `FlowRunDetail.tsx`'s own `Run.trigger` provenance. Absent when the run
   * carries no derivable trigger — NEVER a fabricated default.
   */
  trigger?: {
    kind: string;
    source: string;
    scope: string | null;
  };
};

export function RunView({ runId, found, state, costUsd, lines, materials, ceilingUsd, outputRefs, errorText, trigger }: RunViewProps) {
  return (
    // W7-C3 (agents-35): <main>, not <div> — the run page had no <main>
    // landmark at all; every other route roots its [data-page] on one.
    <main
      data-page="agent-run"
      data-run-id={runId}
      data-run-state={state}
      data-run-cost={costUsd}
      data-run-found={found ? 'true' : 'false'}
      data-page-ready="true"
      style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 20 }}
    >
      {/* W7-C3 (crosscut-18): the page's ONE h1. */}
      <h1 style={{ margin: 0, fontSize: 15 }}>Agent run {runId}</h1>
      {!found ? (
        <RunNotFound runId={runId} />
      ) : (
        <>
          {/* W7-B5 (agents-19): the failure reason, verbatim, next to the
              run — never only the bare word "failed".
              Review round 1: keyed off the run's STATE, not off `errorText`
              alone. The cancel route SIGTERMs the child before writing its
              own marker, so a child that catches the signal and writes
              `agent-dispatch.failed` on the way out leaves BOTH markers in
              the log — `state` correctly derives the sticky `cancelled`,
              but the banner was still announcing "Run failed: …" (in a
              `role="alert"`) about a run the operator deliberately stopped.
              A cancelled run's error text is a consequence of the cancel,
              not a failure to report. */}
          {errorText && state !== 'cancelled' ? (
            <div
              data-component="run-error"
              role="alert"
              style={{ border: '1px solid var(--err, #b91c1c)', borderRadius: 'var(--radius)', padding: '8px 12px', fontSize: 12.5, color: 'var(--err, #b91c1c)' }}
            >
              Run failed: {errorText}
            </div>
          ) : null}
          <RunTrigger trigger={trigger} />

          <section data-section="run-log">
            <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Log</h3>
            <RunLog lines={lines} />
          </section>

          <RunMaterialsSection materials={materials} />
          <CeilingProvenance ceilingUsd={ceilingUsd} />
          <RunOutputsSection outputRefs={outputRefs} />
        </>
      )}
    </main>
  );
}

/** D9/`docs/forge-ui-dom-and-harness.md`: the reserved trigger-provenance
 *  vocabulary, verbatim — mirrors `FlowRunDetail.tsx`'s own `RunTrigger`.
 *  Returns null when the run carries no derivable trigger — never a
 *  placeholder block. */
function RunTrigger({ trigger }: { trigger?: { kind: string; source: string; scope: string | null } }) {
  if (!trigger) return null;
  return (
    <section
      data-section="run-trigger"
      data-trigger-kind={trigger.kind}
      data-trigger-source={trigger.source}
      data-trigger-scope={trigger.scope ?? ''}
      style={{ fontSize: 12, color: 'var(--dim)' }}
    >
      Triggered by <strong>{trigger.kind}</strong> ({trigger.source}){trigger.scope ? ` · scope ${trigger.scope}` : ''}
    </section>
  );
}

function RunNotFound({ runId }: { runId: string }) {
  return (
    <div data-component="run-not-found" className="muted" style={{ fontSize: 13 }}>
      No run found for id <code>{runId}</code>.
    </div>
  );
}

function RunMaterialsSection({ materials }: { materials: RunMaterialRef[] }) {
  return (
    <section data-section="run-materials" data-materials-count={materials.length}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Materials</h3>
      {materials.length === 0 ? (
        <div data-component="run-materials-empty" className="muted" style={{ fontSize: 12 }}>
          No materials were attached to this run.
        </div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
          {materials.map((m) => (
            <li key={m.path} data-material-ref={m.path} data-material-kind={m.kind}>
              {m.path} <span className="muted">({m.kind})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CeilingProvenance({ ceilingUsd }: { ceilingUsd?: number }) {
  const set = ceilingUsd !== undefined;
  return (
    <section data-component="ceiling-provenance" data-ceiling-set={set ? 'true' : 'false'}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Cost ceiling</h3>
      {set ? (
        <p data-ceiling-usd={ceilingUsd} style={{ margin: 0, fontSize: 12 }}>
          ${ceilingUsd!.toFixed(2)}
        </p>
      ) : (
        <p data-component="ceiling-not-recorded" className="muted" style={{ margin: 0, fontSize: 12 }}>
          No cost ceiling was recorded for this run.
        </p>
      )}
    </section>
  );
}

/** W7-B5 (agents-06 / forge-75j): real output REFERENCES (the end event's
 *  own `output_refs` — repo-relative paths the run reported writing). Shown
 *  as references, never fabricated contents. */
function RunOutputsSection({ outputRefs }: { outputRefs: string[] }) {
  return (
    <section data-section="run-outputs" data-outputs-count={outputRefs.length}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Outputs</h3>
      {outputRefs.length === 0 ? (
        <div data-component="run-outputs-empty" className="muted" style={{ fontSize: 12 }}>
          No outputs recorded for this run.
        </div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
          {outputRefs.map((ref) => (
            <li key={ref} data-output-ref={ref}>
              <code>{ref}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
