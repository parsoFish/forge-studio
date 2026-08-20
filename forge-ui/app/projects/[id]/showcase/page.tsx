'use client';

/**
 * Project demo showcase — /projects/[id]/showcase (R4-14).
 *
 * A read-only "best evidence" gallery: the project's newest merged|done
 * cycle's demo evidence, rendered through the SAME <DemoComparison> component
 * /artifact's `type=demo` view already uses (T1 ruling — reuse wholesale, no
 * fork). The gated "open showcase →" entry point lives on
 * `/projects/[id]` (app/projects/[id]/page.tsx), visible only when
 * `showShowcaseEntry` says this project has a terminal (merged|done) cycle.
 * That gate does NOT verify the cycle's demo.json is present (it would cost an
 * N-fetch), so the empty path IS reachable through the normal click-through
 * when a terminal cycle exists but its demo evidence was never captured — the
 * empty state distinguishes that case ("no captured demo evidence") from the
 * genuinely-no-terminal-cycle case ("no merged/done cycle yet").
 *
 * Load pipeline (declared-data-fails-open guard — R4-14 WI-2 brief):
 *   fetchCycles() (bridge-client) → loadShowcase({ cycles, projectId, fetchDemo })
 *   (lib/showcase-load.ts) → deriveShowcaseCycleId + fetchDemoModel internally
 *   → ShowcaseLoadResult { kind: 'empty' } | { kind: 'loaded'; cycleId; model }.
 * `model` can itself be `null` on the loaded path (a terminal cycle exists but
 * its demo.json never landed) — that is rendered as the SAME honest empty
 * state as `kind: 'empty'`, never a fabricated gallery.
 *
 * Three settled states, kept distinct (W7-FIX-A1, demo-showcase gate):
 *   - EMPTY  — the reads succeeded; no merged|done cycle / no captured demo
 *              (`fetchDemoModel` maps a 404 to null: the ABSENCE of an
 *              optional artifact is a real answer) → `showcase-empty`;
 *   - ERROR  — a bridge read THREW (unreachable / 5xx) → the shared
 *              `PageLoadError` with Retry (never the empty state, never
 *              NotFound: nothing is known);
 *   - NOT FOUND — the roster loaded and does not list this project id →
 *              the shared NotFound (W7-A4, projects-23).
 *
 * data-* contract:
 *   root: data-page="project-showcase" data-page-ready data-project-id
 *         data-fetch-status="loading"|"ok" (the ERROR state renders the shared
 *         PageLoadError root: data-fetch-status="error" data-load-error="true")
 *   data-section="showcase-stats" | "showcase-evidence" | "showcase-empty"
 * (mirrors the client-fetch + settled-`data-page-ready` idiom established by
 * app/projects/[id]/page.tsx and app/artifact/page.tsx).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { PageLoadError } from '@/components/PageLoadError';
import { fetchErrorPropsFrom } from '@/components/FetchErrorState';
import { useBridgeRecoveryWhenFailed } from '@/lib/use-bridge-status';
import { DemoComparison } from '@/components/DemoComparison';
import { fetchCycles, fetchDemoModel, type DemoModel } from '@/lib/bridge-client';
import { fetchStudioProjects } from '@/lib/studio-client';
import { loadShowcase, type ShowcaseLoadResult } from '@/lib/showcase-load';
import { deriveShowcaseStats, listShowcaseCycleIds, resolveShowcaseSelectValue, type ShowcaseStats } from '@/lib/project-showcase';

export default function ProjectShowcasePage({ params }: { params: { id: string } }) {
  const { id } = params;

  const [result, setResult] = useState<ShowcaseLoadResult | null>(null);
  // W7-B6 (projects-21): the cycle switcher — all showcase-eligible cycles,
  // newest first; '' = the derived newest pick.
  const [eligibleCycles, setEligibleCycles] = useState<string[]>([]);
  const [pickedCycleId, setPickedCycleId] = useState('');
  const [ready, setReady] = useState(false);
  // W7-A4 (projects-23): the showcase is a PROJECT surface — an id the roster
  // does not know renders the shared NotFound, not a plausible "No showcase
  // yet" for a project that does not exist. `null` = roster not consulted yet.
  const [projectKnown, setProjectKnown] = useState<boolean | null>(null);
  // W7-FIX-A1: a bridge read that THREW is an ERROR state — the shared
  // PageLoadError with Retry — never the honest empty state (that is for a
  // SUCCESSFUL read that found nothing). `loadKey` re-runs the load on Retry
  // + bridge recovery.
  const [loadError, setLoadError] = useState<{ error: string; status?: number } | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const reload = useCallback(() => setLoadKey((k) => k + 1), []);
  // Detail-page rule (W7-FIX-A1 review): recovery refills ONLY a failed load.
  useBridgeRecoveryWhenFailed(loadError !== null, reload);

  const load = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      const roster = await fetchStudioProjects();
      if (signal.cancelled) return;
      // The roster read fails CLOSED (W7-A1): a roster that came back is a
      // real answer, empty or not — the project is listed or it is not.
      const known = roster.some((p) => p.id === id);
      setProjectKnown(known);
      // A definitive NOT-FOUND is settled here: no cycles/demo read for an
      // id the roster ruled out (a later read failure must not turn a
      // not-found into a retryable error state — review round 2).
      if (!known) {
        setLoadError(null);
        return;
      }
      const snapshot = await fetchCycles();
      const cycles = [...(snapshot?.live ?? []), ...(snapshot?.recent ?? [])];
      const loaded = await loadShowcase({
        cycles,
        projectId: id,
        fetchDemo: fetchDemoModel,
        ...(pickedCycleId ? { requestedCycleId: pickedCycleId } : {}),
      });
      if (signal.cancelled) return;
      setEligibleCycles(listShowcaseCycleIds(cycles, id));
      setResult(loaded);
      setLoadError(null);
    } catch (err) {
      // A bridge read threw (unreachable / 5xx / malformed). NOT an empty
      // showcase — nothing is known. Rendered as PageLoadError below.
      if (signal.cancelled) return;
      setLoadError(fetchErrorPropsFrom(err));
    } finally {
      if (!signal.cancelled) setReady(true);
    }
  }, [id, pickedCycleId]);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => { signal.cancelled = true; };
    // loadKey: Retry / bridge recovery re-run the load (W7-FIX-A1)
  }, [load, loadKey]);

  const model: DemoModel | null = result?.kind === 'loaded' ? result.model : null;
  const cycleId: string | undefined = result?.kind === 'loaded' ? result.cycleId : undefined;
  const stats: ShowcaseStats | null = model ? deriveShowcaseStats(model) : null;
  // Honest empty: no eligible cycle at all (`kind: 'empty'`) OR a terminal
  // cycle exists but its demo.json never landed (`kind: 'loaded', model: null`)
  // — either way there is nothing real to render, never a fabricated gallery.
  const isEmpty = !model;
  // Distinguish a genuinely-absent terminal cycle from a terminal cycle whose
  // demo.json was never captured (both render empty, but honestly differently).
  const emptyReason: 'no-cycle' | 'no-demo' = result?.kind === 'loaded' ? 'no-demo' : 'no-cycle';

  if (ready && loadError) {
    return (
      <PageLoadError
        page="project-showcase"
        rootAttrs={{ 'data-project-id': id }}
        what={`the demo showcase for project "${id}"`}
        error={loadError.error}
        status={loadError.status}
        onRetry={reload}
        backHref={`/projects/${encodeURIComponent(id)}`}
        backLabel="Back to project"
      />
    );
  }
  if (ready && !loadError && projectKnown === false) {
    return <NotFound kind="project" id={id} backHref="/projects" backLabel="Projects" />;
  }

  return (
    <main
      data-page="project-showcase"
      data-page-ready={ready ? 'true' : 'false'}
      data-fetch-status={ready ? 'ok' : 'loading'}
      data-project-id={id}
      style={{ minHeight: '100vh', background: 'var(--bg)' }}
    >
      <StudioNav />

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '18px 28px 64px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12.5,
          color: 'var(--faint)',
          padding: '10px 0 0',
          fontFamily: 'var(--font-mono)',
        }}>
          <Link href="/" style={{ color: 'var(--dim)', textDecoration: 'none' }}>Forge Studio</Link>
          <span style={{ color: 'var(--line-2)' }}>/</span>
          <Link href={`/projects/${encodeURIComponent(id)}`} style={{ color: 'var(--dim)', textDecoration: 'none' }}>
            {id}
          </Link>
          <span style={{ color: 'var(--line-2)' }}>/</span>
          <span style={{ color: 'var(--c-project)' }}>SHOWCASE</span>
        </div>

        <div style={{ padding: '18px 0 20px', borderBottom: '1px solid var(--line)', marginBottom: 24 }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 26,
            fontWeight: 700,
            lineHeight: 1.2,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
            margin: '0 0 6px',
          }}>
            Demo showcase
          </h1>
          <p style={{ fontSize: 13, color: 'var(--dim)', margin: 0 }}>
            Best evidence from this project&apos;s most recent completed cycle.
          </p>
        </div>

        {/* W7-B6 (projects-21): the showcase is no longer a dead end — a
            cycle switcher over every eligible cycle plus links INTO the
            source cycle (run page + demo artifact; the PR link rides the
            stats strip when the model carries one). */}
        {ready && eligibleCycles.length > 0 && (
          <div
            data-section="showcase-cycle-nav"
            data-eligible-count={eligibleCycles.length}
            style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}
          >
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--faint)' }}>
              Cycle
              {/* Review F9: a pick that has left the eligible list must not
                  render a blank control while the links follow the fallback —
                  the value tracks what the page actually resolved. */}
              <select
                data-field="showcase-cycle"
                value={resolveShowcaseSelectValue(pickedCycleId, cycleId, eligibleCycles)}
                onChange={(e) => setPickedCycleId(e.target.value)}
                style={{
                  background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
                  color: 'var(--text)', fontSize: 12, padding: '5px 8px', outline: 'none', maxWidth: 380,
                }}
              >
                {eligibleCycles.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            {cycleId && (
              <>
                <Link
                  data-action="showcase-open-run"
                  href={`/flows/forge-develop/run/${encodeURIComponent(cycleId)}`}
                  style={{ fontSize: 12, color: 'var(--c-project)', textDecoration: 'none' }}
                >
                  run →
                </Link>
                <Link
                  data-action="showcase-open-artifact"
                  href={`/artifact?run=${encodeURIComponent(cycleId)}&type=demo`}
                  style={{ fontSize: 12, color: 'var(--c-project)', textDecoration: 'none' }}
                >
                  demo artifact →
                </Link>
              </>
            )}
          </div>
        )}

        {!ready ? (
          <div style={{ fontSize: 13, color: 'var(--faint)', padding: '40px 0' }}>Loading…</div>
        ) : isEmpty ? (
          <ShowcaseEmptyState projectId={id} reason={emptyReason} />
        ) : (
          <>
            {stats && <ShowcaseStatsStrip stats={stats} />}
            <div data-section="showcase-evidence">
              <DemoComparison model={model} cycleId={cycleId} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Stats strip — a small summary derived from the SAME DemoModel already
// fetched for the evidence gallery below (no second bridge round-trip).
// ---------------------------------------------------------------------------

function ShowcaseStatsStrip({ stats }: { stats: ShowcaseStats }) {
  const tileStyle: React.CSSProperties = {
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-sm)',
    padding: '10px 14px',
    background: 'var(--panel)',
    minWidth: 84,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10.5,
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '.08em',
    color: 'var(--faint)',
    marginBottom: 3,
  };
  const valueStyle: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
  };

  return (
    <div
      data-section="showcase-stats"
      style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 26 }}
    >
      {/* W7-B6 (projects-22): the tile renders ONLY when the model genuinely
          carries a testEvidence block — an absent block used to render as a
          hard "TESTS 0" next to 23 met ACs. */}
      {stats.testEvidenceCount !== null && (
        <div style={tileStyle} data-tile="tests">
          <div style={labelStyle}>Tests</div>
          <div style={valueStyle}>{stats.testEvidenceCount}</div>
        </div>
      )}
      <div style={tileStyle}>
        <div style={labelStyle}>AC met</div>
        <div style={{ ...valueStyle, color: 'var(--green)' }}>{stats.acVerdictCounts.met}</div>
      </div>
      <div style={tileStyle}>
        <div style={labelStyle}>AC partial</div>
        <div style={{ ...valueStyle, color: 'var(--amber)' }}>{stats.acVerdictCounts.partial}</div>
      </div>
      <div style={tileStyle}>
        <div style={labelStyle}>AC missed</div>
        <div style={{ ...valueStyle, color: 'var(--red)' }}>{stats.acVerdictCounts.missed}</div>
      </div>
      {stats.branch && (
        <div style={tileStyle}>
          <div style={labelStyle}>Branch</div>
          <div style={{ ...valueStyle, fontSize: 12.5 }}>{stats.branch}</div>
        </div>
      )}
      {stats.commitSha && (
        <div style={tileStyle}>
          <div style={labelStyle}>Commit</div>
          <div style={{ ...valueStyle, fontSize: 12.5 }}>{stats.commitSha.slice(0, 10)}</div>
        </div>
      )}
      {stats.prUrl && (
        <a
          href={stats.prUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            ...tileStyle,
            display: 'flex',
            alignItems: 'center',
            textDecoration: 'none',
            color: 'var(--c-project)',
            fontSize: 12.5,
            fontWeight: 600,
          }}
        >
          Pull request →
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — mirrors app/artifact/page.tsx's EmptyState (same hex glyph +
// layout convention); honest about WHY (no completed cycle yet), never a
// silently-blank gallery.
// ---------------------------------------------------------------------------

function ShowcaseEmptyState({ projectId, reason }: { projectId: string; reason: 'no-cycle' | 'no-demo' }) {
  return (
    <div
      data-section="showcase-empty"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 320,
        gap: 16,
        textAlign: 'center',
        padding: 40,
      }}
    >
      <div style={{
        width: 72,
        height: 80,
        clipPath: 'var(--hex-clip)',
        background: 'var(--panel-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 28,
      }}>
        ◇
      </div>
      <h2 style={{ fontSize: 18, color: 'var(--text)' }}>No showcase yet</h2>
      <p style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: 440, lineHeight: 1.6, margin: 0 }}>
        {reason === 'no-demo' ? (
          <>This project's most recent <strong>merged</strong>/<strong>done</strong> cycle has no
          captured demo evidence yet — the showcase fills in once a cycle records a demo.</>
        ) : (
          <>This project has no <strong>merged</strong> or <strong>done</strong> cycle yet — the
          showcase fills in once a cycle completes.</>
        )}
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* W7-B6 (projects-21): the no-demo empty state offers the way to
            CAPTURE one — the demo-builder kickoff for this project — instead
            of only a way back. */}
        {reason === 'no-demo' && (
          <Link
            data-action="showcase-capture-demo"
            className="btn btn-primary"
            href={`/sessions/demo/new?project=${encodeURIComponent(projectId)}`}
            style={{ textDecoration: 'none' }}
          >
            Build the demo →
          </Link>
        )}
        <Link
          href={`/projects/${encodeURIComponent(projectId)}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 13,
            color: 'var(--dim)',
            textDecoration: 'none',
          }}
        >
          ← Back to project
        </Link>
      </div>
    </div>
  );
}
