'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchStudioKbs, fetchKb, fetchKbNode, resolveKbNode, runKbMaintenance, deleteKb } from '@/lib/studio-client';
import type { Kb, KbDetail, KbNodeArticle } from '@/lib/studio-client';
import { StudioNav } from '@/components/StudioNav';
import { KbGraph } from '@/components/studio/knowledge/KbGraph';
import { NodeArticle } from '@/components/studio/knowledge/NodeArticle';
import { KbHealth } from '@/components/studio/knowledge/KbHealth';
import { GuidancePanel } from '@/components/studio/knowledge/GuidancePanel';
import { LintResolutionPanel } from '@/components/studio/knowledge/LintResolutionPanel';
import { KbSelector } from '@/components/studio/knowledge/KbSelector';

// ── Scope badge class ─────────────────────────────────────────────────────────

const SCOPE_BADGE: Record<string, string> = {
  project:           'badge-project',
  flow:              'badge-flow',
  'agent-integration': 'badge-agent',
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
  const searchParams = useSearchParams();
  const idParam      = searchParams.get('id') ?? '';
  const nodeParam    = searchParams.get('node') ?? '';

  const [allKbs,       setAllKbs]       = useState<Kb[]>([]);
  const [currentId,    setCurrentId]    = useState<string>('');
  const [kbDetail,     setKbDetail]     = useState<KbDetail | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [article,      setArticle]      = useState<KbNodeArticle | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [ready,        setReady]        = useState(false);
  // Pending node to select once the KB detail is loaded
  const pendingNodeRef = useRef<string | null>(null);

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
  // Priority: ?node= drives KB resolution via resolve-node endpoint.
  //           ?id= selects a KB directly.
  //           Falls back to first KB in list.
  useEffect(() => {
    if (nodeParam) {
      // ?node= given — resolve which KB owns this node, then set it as active.
      // Store the node slug so the detail-load effect can select it.
      pendingNodeRef.current = nodeParam;
      if (idParam) {
        // Both ?id= and ?node= given: trust the id, just queue the node selection.
        setCurrentId(idParam);
        return;
      }
      // Only ?node= given: call resolve-node to find the owning KB.
      const signal = { cancelled: false };
      resolveKbNode(nodeParam).then((result) => {
        if (signal.cancelled) return;
        if (result?.kbId) {
          setCurrentId(result.kbId);
        } else if (allKbs.length > 0) {
          // Node not found in any KB — fall back to first KB, clear pending node.
          pendingNodeRef.current = null;
          setCurrentId(allKbs[0].id);
        }
      }).catch(() => {
        if (signal.cancelled) return;
        pendingNodeRef.current = null;
        if (allKbs.length > 0) setCurrentId(allKbs[0].id);
      });
      return () => { signal.cancelled = true; };
    }
    if (idParam) {
      setCurrentId(idParam);
      return;
    }
    if (allKbs.length > 0 && !currentId) {
      setCurrentId(allKbs[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, nodeParam, allKbs]);

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
      // If a node was requested via ?node=, select it now that the graph is loaded.
      const pending = pendingNodeRef.current;
      if (pending) {
        pendingNodeRef.current = null;
        // Verify the node exists in this graph before selecting.
        const nodeExists = detail?.graph?.nodes.some((n) => n.id === pending) ?? false;
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
              <span id="kb-scope-badge" className={`badge ${SCOPE_BADGE[currentKb.scope] ?? 'badge-dim'}`}>
                {currentKb.scope}
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

      {/* Body: graph (left) + right rail */}
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
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// KbMaintenance (K3) — manual brain lint / index-refresh from the knowledge tab.
// (Ingest + agentic review run during cycle reflection; these are the
// deterministic, operator-triggerable ops.)
// ---------------------------------------------------------------------------
function KbMaintenance({ kbId, onDeleted }: { kbId: string; onDeleted?: () => void }) {
  const [busy, setBusy] = useState<'lint' | 'index' | 'delete' | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run(op: 'lint' | 'index') {
    setBusy(op);
    setResult(null);
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
    <div data-component="kb-maintenance" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button data-action="kb-lint" style={btn} disabled={busy !== null} onClick={() => void run('lint')}>
        {busy === 'lint' ? 'Linting…' : 'Lint'}
      </button>
      <button data-action="kb-index" style={btn} disabled={busy !== null} onClick={() => void run('index')}>
        {busy === 'index' ? 'Refreshing…' : 'Refresh index'}
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
