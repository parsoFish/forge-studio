'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  fetchStudioKbs, fetchKb, fetchKbNode, resolveKbNode, runKbMaintenance, deleteKb,
  fetchKbIngestActivity,
} from '@/lib/studio-client';
import type { Kb, KbDetail, KbNodeArticle, KbIngestEvent } from '@/lib/studio-client';
import { runConsolidateToTerminal, consolidateResultLabel } from '@/lib/kb-consolidate';
import { StudioNav } from '@/components/StudioNav';
import { KbGraph } from '@/components/studio/knowledge/KbGraph';
import { NodeArticle } from '@/components/studio/knowledge/NodeArticle';
import { ThemeList } from '@/components/studio/knowledge/ThemeList';
import { KbHealth } from '@/components/studio/knowledge/KbHealth';
import { GuidancePanel } from '@/components/studio/knowledge/GuidancePanel';
import { LintResolutionPanel } from '@/components/studio/knowledge/LintResolutionPanel';
import { KbSelector } from '@/components/studio/knowledge/KbSelector';

// ── Tabs (R6-08 WI-3, RULING 5: URL-synced via ?tab=) ─────────────────────────

type TabId = 'explore' | 'health' | 'ingest-activity';

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    background: 'none', border: 'none', cursor: 'pointer',
    fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
    color: active ? 'var(--text)' : 'var(--faint)',
    padding: '10px 14px 8px',
    borderBottom: active ? '2px solid var(--c-kb)' : '2px solid transparent',
  };
}

// ── Scope badge class ─────────────────────────────────────────────────────────

const SCOPE_BADGE: Record<string, string> = {
  project: 'badge-project',
  flow:    'badge-flow',
  unique:  'badge-agent',
};

// ── Default export wraps inner in Suspense (required for useSearchParams) ─────

export default function KnowledgePage() {
  return (
    <Suspense fallback={
      <main data-page="knowledge" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <StudioNav />
        <div style={{ padding: 40, color: 'var(--dim)' }}>Loading…</div>
      </main>
    }>
      <KnowledgePageInner />
    </Suspense>
  );
}

// ── Inner page component ──────────────────────────────────────────────────────

function KnowledgePageInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const idParam      = searchParams.get('id') ?? '';
  const nodeParam    = searchParams.get('node') ?? '';
  // RULING 1 — ?theme= is a THIN ALIAS onto the existing ?node= selection
  // machinery below, restricted to theme-layer nodes (see pendingIsThemeRef).
  const themeParam   = searchParams.get('theme') ?? '';

  // RULING 5 — tab state is URL-synced via ?tab=, deep-linkable like ?node=/?id=.
  const tabParam: TabId =
    searchParams.get('tab') === 'health' || searchParams.get('tab') === 'ingest-activity'
      ? (searchParams.get('tab') as TabId)
      : 'explore';
  const tab = tabParam;
  const setTab = useCallback((next: TabId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.push(`/knowledge?${params.toString()}`);
  }, [searchParams, router]);

  const [allKbs,       setAllKbs]       = useState<Kb[]>([]);
  const [currentId,    setCurrentId]    = useState<string>('');
  const [kbDetail,     setKbDetail]     = useState<KbDetail | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [article,      setArticle]      = useState<KbNodeArticle | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [ready,        setReady]        = useState(false);
  // Pending node to select once the KB detail is loaded
  const pendingNodeRef = useRef<string | null>(null);
  // RULING 1 — true iff the pending node came ONLY from ?theme= (never
  // ?node=), so the detail-load effect can restrict it to theme-layer nodes.
  const pendingIsThemeRef = useRef<boolean>(false);

  // track mounted signal to avoid setState on unmounted
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── Load KB list once ─────────────────────────────────────────────────────
  useEffect(() => {
    const signal = { cancelled: false };
    fetchStudioKbs().then((kbs) => {
      if (signal.cancelled) return;
      setAllKbs(kbs);
    }).catch(() => {/* bridge offline — empty list is fine */});
    return () => { signal.cancelled = true; };
  }, []);

  // ── Resolve active KB id (from URL params → first KB) ────────────────────
  // Priority: ?node= (or its ?theme= alias, RULING 1) drives KB resolution
  //           via resolve-node endpoint.
  //           ?id= selects a KB directly.
  //           Falls back to first KB in list.
  useEffect(() => {
    // ?node= takes priority; ?theme= is a thin alias onto the SAME machinery
    // when ?node= is absent — no parallel selection effect (RULING 1).
    const pendingParam = nodeParam || themeParam;
    if (pendingParam) {
      // Resolve which KB owns this node, then set it as active. Store the
      // slug so the detail-load effect can select it.
      pendingNodeRef.current = pendingParam;
      pendingIsThemeRef.current = !nodeParam && !!themeParam;
      if (idParam) {
        // Both ?id= and ?node=/?theme= given: trust the id, just queue the node selection.
        setCurrentId(idParam);
        return;
      }
      // Only ?node=/?theme= given: call resolve-node to find the owning KB.
      const signal = { cancelled: false };
      resolveKbNode(pendingParam).then((result) => {
        if (signal.cancelled) return;
        if (result?.kbId) {
          setCurrentId(result.kbId);
        } else if (allKbs.length > 0) {
          // Node not found in any KB — fall back to first KB, clear pending node.
          pendingNodeRef.current = null;
          pendingIsThemeRef.current = false;
          setCurrentId(allKbs[0].id);
        }
      }).catch(() => {
        if (signal.cancelled) return;
        pendingNodeRef.current = null;
        pendingIsThemeRef.current = false;
        if (allKbs.length > 0) setCurrentId(allKbs[0].id);
      });
      return () => { signal.cancelled = true; };
    }
    // Only trust the URL id while it still exists — after deleting the open
    // KB the stale ?id= would otherwise resurrect a phantom selection that
    // renders like the first item being re-selected.
    if (idParam && allKbs.some((k) => k.id === idParam)) {
      setCurrentId(idParam);
      return;
    }
    if (allKbs.length > 0 && !currentId) {
      setCurrentId(allKbs[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, nodeParam, themeParam, allKbs]);

  // ── Load KB detail when id changes ────────────────────────────────────────
  useEffect(() => {
    if (!currentId) return;
    const signal = { cancelled: false };
    setReady(false);
    setKbDetail(null);
    setSelectedNode(null);
    setArticle(null);

    fetchKb(currentId).then((detail) => {
      if (signal.cancelled) return;
      setKbDetail(detail);
      setReady(true);
      // If a node was requested via ?node= (or its ?theme= alias), select it
      // now that the graph is loaded.
      const pending = pendingNodeRef.current;
      if (pending) {
        pendingNodeRef.current = null;
        const isThemeOnly = pendingIsThemeRef.current;
        pendingIsThemeRef.current = false;
        // Verify the node exists in this graph before selecting. RULING 1: a
        // ?theme=-sourced pending selection is restricted to theme-layer
        // nodes — the alias never selects an index/raw/guidance node.
        const pendingNode = detail?.graph?.nodes.find((n) => n.id === pending);
        const nodeExists = !!pendingNode && (!isThemeOnly || pendingNode.layer === 'theme');
        if (nodeExists) {
          setSelectedNode(pending);
          // Fetch its article immediately.
          fetchKbNode(currentId, pending).then((art) => {
            if (signal.cancelled) return;
            setArticle(art);
          }).catch(() => {/* non-fatal */});
        }
      }
    }).catch(() => {
      if (signal.cancelled) return;
      setReady(true);  // reach page-ready even on error
    });

    return () => { signal.cancelled = true; };
  }, [currentId]);

  // ── Node selection: fetch article ─────────────────────────────────────────
  const handleSelectNode = useCallback((nodeId: string) => {
    if (!currentId) return;
    setSelectedNode(nodeId);
    setArticle(null);
    setArticleLoading(true);

    const signal = { cancelled: false };
    fetchKbNode(currentId, nodeId).then((art) => {
      if (signal.cancelled) return;
      setArticle(art);
      setArticleLoading(false);
    }).catch(() => {
      if (!signal.cancelled) setArticleLoading(false);
    });

    return () => { signal.cancelled = true; };
  }, [currentId]);

  // ── Jump-to-node (from article chips or wiki-links) ───────────────────────
  const handleJump = useCallback((nodeId: string) => {
    handleSelectNode(nodeId);
  }, [handleSelectNode]);

  // ── Re-fetch the KB graph after a guidance pin ────────────────────────────
  const handlePinned = useCallback(() => {
    if (!currentId) return;
    fetchKb(currentId).then((detail) => {
      if (mountedRef.current) setKbDetail(detail);
    }).catch(() => {/* non-fatal — graph may be briefly stale */});
  }, [currentId]);

  // ── Current KB meta ───────────────────────────────────────────────────────
  const currentKb = kbDetail?.kb ?? allKbs.find((k) => k.id === currentId) ?? null;

  return (
    <main
      data-page="knowledge"
      {...(ready ? { 'data-page-ready': 'true' } : {})}
      {...(selectedNode ? { 'data-selected-node': selectedNode } : {})}
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', overflow: 'hidden' }}
    >
      <StudioNav />

      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px',
        background: 'var(--bg-2)', borderBottom: '1px solid var(--line)',
        flexShrink: 0, flexWrap: 'wrap', rowGap: 10,
      }}>
        <KbSelector kbs={allKbs} currentId={currentId} />

        {currentKb && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span id="kb-title" style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
                {currentKb.name}
              </span>
              <span id="kb-scope-badge" className={`badge ${SCOPE_BADGE[currentKb.binding.kind] ?? 'badge-dim'}`}>
                {currentKb.binding.kind}
              </span>
            </div>
            <div id="kb-desc" style={{ fontSize: 12.5, color: 'var(--dim)' }}>
              {currentKb.desc ?? ''}
            </div>
          </div>
        )}

        <div style={{ flexGrow: 1 }} />

        {/* K3: manual brain maintenance */}
        {currentId && (
          <KbMaintenance
            kbId={currentId}
            onMaintained={handlePinned}
            onDeleted={() => {
              setCurrentId('');
              setKbDetail(null);
              fetchStudioKbs().then((ks) => setAllKbs(ks)).catch(() => {});
            }}
          />
        )}

        {/* "maintained by agents" pill */}
        <div
          aria-label="Agent managed knowledge base"
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 12px 5px 10px',
            background: 'rgba(74,222,128,.07)', border: '1px solid rgba(74,222,128,.25)',
            borderRadius: 999, fontSize: 12, color: 'var(--c-kb)', userSelect: 'none',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--c-kb)', boxShadow: '0 0 8px rgba(74,222,128,.7)' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>maintained by agents</span>
        </div>
      </div>

      {/* Tab bar (R6-08 WI-3, RULING 5 — URL-synced via ?tab=) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: '0 20px',
        borderBottom: '1px solid var(--line)', background: 'var(--bg-2)', flexShrink: 0,
      }}>
        <button
          data-tab="explore"
          data-tab-active={tab === 'explore' ? 'true' : 'false'}
          onClick={() => setTab('explore')}
          style={tabButtonStyle(tab === 'explore')}
        >
          Explore
        </button>
        <button
          data-tab="health"
          data-tab-active={tab === 'health' ? 'true' : 'false'}
          onClick={() => setTab('health')}
          style={tabButtonStyle(tab === 'health')}
        >
          Health
        </button>
        <button
          data-tab="ingest-activity"
          data-tab-active={tab === 'ingest-activity' ? 'true' : 'false'}
          onClick={() => setTab('ingest-activity')}
          style={tabButtonStyle(tab === 'ingest-activity')}
        >
          Ingest Activity
        </button>
      </div>

      {/* Explore tab: graph (left) + reader rail (right) — the pre-existing
          body, re-anchored under this tab; node-click→article is unchanged. */}
      {tab === 'explore' && (
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

          {/* Graph area */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            {kbDetail ? (
              <KbGraph
                kbId={currentId}
                graph={kbDetail.graph}
                selectedNodeId={selectedNode}
                onSelectNode={handleSelectNode}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 14 }}>
                {ready ? 'No KB data available.' : 'Loading…'}
              </div>
            )}
          </div>

          {/* Right rail */}
          <div style={{
            width: 360, flexShrink: 0, display: 'flex', flexDirection: 'column',
            borderLeft: '1px solid var(--line)', overflowY: 'auto', background: 'var(--bg-2)',
          }}>
            <NodeArticle
              article={article}
              loading={articleLoading}
              onJump={handleJump}
            />
            <ThemeList
              nodes={kbDetail?.graph.nodes ?? []}
              selectedNodeId={selectedNode}
              onSelectNode={handleSelectNode}
            />
          </div>
        </div>
      )}

      {/* Health tab: lint resolution + guidance + KB health, moved under this
          branch (F1 — not rendered unconditionally). */}
      {tab === 'health' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {currentId && (
            <LintResolutionPanel kbId={currentId} onChanged={handlePinned} />
          )}
          <GuidancePanel
            selectedArticle={article}
            kbId={currentId}
            onPinned={handlePinned}
          />
          {kbDetail?.health && (
            <KbHealth health={kbDetail.health} />
          )}
        </div>
      )}

      {/* Ingest-activity tab: read-only reflect.kb-ingest feed (WI-2). */}
      {tab === 'ingest-activity' && (
        <IngestActivityPanel kbId={currentId} />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// IngestActivityPanel (R6-08 WI-2) — read-only reflect.kb-ingest feed.
// NO button, NO data-action anywhere in this component: nothing here can
// trigger an ingest (ingest stays reflection-only, operator decision 3).
// ---------------------------------------------------------------------------
function IngestActivityPanel({ kbId }: { kbId: string }) {
  const [events, setEvents] = useState<KbIngestEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!kbId) { setEvents([]); return; }
    setLoading(true);
    const signal = { cancelled: false };
    fetchKbIngestActivity(kbId).then((evs) => {
      if (signal.cancelled) return;
      setEvents(evs);
      setLoading(false);
    }).catch(() => { if (!signal.cancelled) setLoading(false); });
    return () => { signal.cancelled = true; };
  }, [kbId]);

  return (
    <div
      data-component="ingest-activity"
      data-ingest-event-count={events.length}
      style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 }}
    >
      <div className="panel-head">INGEST ACTIVITY</div>
      {loading && <div style={{ color: 'var(--dim)', fontSize: 12.5, marginTop: 8 }}>Loading…</div>}
      {!loading && events.length === 0 && (
        <div style={{ color: 'var(--faint)', fontSize: 12.5, marginTop: 8 }}>No ingest activity recorded yet.</div>
      )}
      {events.map((e, i) => (
        <div
          key={`${e.cycleId}-${i}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '7px 4px',
            borderBottom: '1px solid var(--line)', fontSize: 12.5, color: 'var(--dim)',
          }}
        >
          <span data-ingest-kb={e.kb} style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{e.kb}</span>
          <span data-ingest-fresh-themes={e.freshThemes}>{e.freshThemes} fresh theme{e.freshThemes !== 1 ? 's' : ''}</span>
          <span data-ingest-impl={e.impl} style={{ color: 'var(--faint)' }}>{e.impl}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{e.cycleId}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KbMaintenance (K3) — manual brain lint / index-refresh from the knowledge tab.
// (Ingest + agentic review run during cycle reflection; these are the
// deterministic, operator-triggerable ops.)
// ---------------------------------------------------------------------------
function KbMaintenance({ kbId, onMaintained, onDeleted }: { kbId: string; onMaintained?: () => void; onDeleted?: () => void }) {
  const [busy, setBusy] = useState<'lint' | 'index' | 'consolidate' | 'delete' | null>(null);
  const [result, setResult] = useState<string | null>(null);
  // R1-06 WI-3 MINOR 2: the observed terminal state of the LAST consolidate run
  // ('' until one completes) — the kb-maintain journey drives off this rather
  // than scraping the result text. Reset when a fresh consolidate starts.
  const [consolidateState, setConsolidateState] = useState<string>('');

  async function run(op: 'lint' | 'index' | 'consolidate') {
    setBusy(op);
    setResult(null);
    if (op === 'consolidate') {
      // Consolidate is async: dispatch, poll its runId to terminal, then refresh
      // the KB health so the operator sees a real completion + updated warnings
      // (not a static "session started"). onMaintained refetches KB detail.
      setConsolidateState('');
      const outcome = await runConsolidateToTerminal(kbId);
      setBusy(null);
      setResult(consolidateResultLabel(outcome));
      setConsolidateState(outcome.ok ? outcome.state : 'error');
      if (outcome.ok) onMaintained?.();
      setTimeout(() => setResult(null), 6000);
      return;
    }
    const r = await runKbMaintenance(kbId, op);
    setBusy(null);
    if (!r.ok) { setResult(r.error ?? 'failed'); return; }
    if (op === 'lint') {
      const findings = (r.data?.findings as unknown[] | undefined) ?? [];
      setResult(findings.length === 0 ? 'lint: clean ✓' : `lint: ${findings.length} finding(s)`);
    } else {
      setResult('index refreshed ✓');
    }
    setTimeout(() => setResult(null), 6000);
  }

  async function handleDelete() {
    if (!window.confirm(`Delete brain "${kbId}" and all its content? This cannot be undone.`)) return;
    setBusy('delete');
    setResult(null);
    const r = await deleteKb(kbId);
    setBusy(null);
    if (!r.ok) { setResult(r.error ?? 'delete failed'); return; }
    onDeleted?.();
  }

  const btn: React.CSSProperties = {
    fontSize: 11.5, padding: '4px 10px', background: 'var(--panel-2)', color: 'var(--text)',
    border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer',
  };
  return (
    <div
      data-component="kb-maintenance"
      {...(consolidateState ? { 'data-consolidate-state': consolidateState } : {})}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
    >
      <button data-action="kb-lint" style={btn} disabled={busy !== null} onClick={() => void run('lint')}>
        {busy === 'lint' ? 'Linting…' : 'Lint'}
      </button>
      <button data-action="kb-index" style={btn} disabled={busy !== null} onClick={() => void run('index')}>
        {busy === 'index' ? 'Refreshing…' : 'Refresh index'}
      </button>
      <button
        data-action="kb-maintain-session"
        style={btn}
        disabled={busy !== null}
        onClick={() => void run('consolidate')}
        title="Start a consolidate maintenance session"
      >
        {busy === 'consolidate' ? 'Consolidating…' : 'Consolidate'}
      </button>
      <button
        data-action="kb-delete"
        style={{ ...btn, color: 'var(--error, #f87171)', borderColor: 'var(--error, #f87171)' }}
        disabled={busy !== null}
        onClick={() => void handleDelete()}
        title="Delete this knowledge base"
      >
        {busy === 'delete' ? 'Deleting…' : 'Delete'}
      </button>
      {result && <span data-component="kb-maintenance-result" style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>{result}</span>}
    </div>
  );
}
