'use client';

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  fetchStudioKbs, fetchKb, fetchKbNode, resolveKbNode,
  fetchKbIngestActivity, fetchKbRuns,
} from '@/lib/studio-client';
import type { Kb, KbDetail, KbNodeArticle, KbIngestEvent } from '@/lib/studio-client';
import { resolveActiveKbId } from '@/lib/knowledge-id-resolution';
import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { KbGraph } from '@/components/studio/knowledge/KbGraph';
import { NodeArticle } from '@/components/studio/knowledge/NodeArticle';
import { ThemeList } from '@/components/studio/knowledge/ThemeList';
import { KbHealth } from '@/components/studio/knowledge/KbHealth';
import { GuidancePanel } from '@/components/studio/knowledge/GuidancePanel';
import { KbDrainPanel } from '@/components/studio/knowledge/KbDrainPanel';
import { KbActionGroup } from '@/components/studio/knowledge/KbActionGroup';
import { RecentRuns } from '@/components/RecentRuns';
import { toKbRunLedgerRows } from '@/lib/kb-runs';
import type { LedgerRow } from '@/lib/history-ledger';
import type { KbDrainDisplayState } from '@/lib/kb-drain-view';
import { KbSelector } from '@/components/studio/knowledge/KbSelector';
import { KnowledgeEmptyState } from '@/components/studio/knowledge/KnowledgeEmptyState';
import { FetchErrorState, fetchErrorPropsFrom } from '@/components/FetchErrorState';
import { useBridgeRecovery } from '@/lib/use-bridge-status';
import Link from 'next/link';

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
  // W7-B2 (knowledge-23): the create form lands here with the seeding
  // session it spawned — a banner tells the operator instead of the session
  // silently existing.
  const seedSessionParam = searchParams.get('seedSession') ?? '';
  const seedProjectParam = searchParams.get('seedProject') ?? '';

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
  // W6-IA-4 sweep finding C4#1: whether the FIRST fetchStudioKbs() call has
  // settled — independent of `ready` (which used to be set ONLY inside the
  // "load KB detail" effect below, an effect that never even RUNS when the
  // roster is genuinely empty, since it starts `if (!currentId) return;`
  // and no `currentId` is ever chosen from an empty list). A real empty
  // install must reach an honest ready state, not hang on "Loading…"
  // forever.
  const [kbListReady,  setKbListReady]  = useState(false);
  // W7-A1 (crosscut-01/-22): a failed roster read is an ERROR state, never
  // "No knowledge bases yet"; `loadKey` re-runs the load on Retry + bridge
  // recovery (no page-level poll).
  const [kbsError,     setKbsError]     = useState<{ message: string; status?: number } | null>(null);
  const [loadKey,      setLoadKey]      = useState(0);
  const reloadKbs = useCallback(() => setLoadKey((k) => k + 1), []);
  // W7-FIX-A1 (A1-07): the KB-DETAIL read is a second, independent read —
  // its failure is an ERROR state of its own (`kbDetailError`), folded into
  // the root `data-fetch-status` and rendered as the shared FetchErrorState
  // in the graph area (never the bare "No KB data available."). Retry drops
  // the cached (rejected) fetchKb promise and re-runs the detail effect via
  // `detailKey`; bridge recovery re-runs BOTH reads.
  const [kbDetailError, setKbDetailError] = useState<{ message: string; status?: number } | null>(null);
  const [detailKey,    setDetailKey]    = useState(0);
  const [currentId,    setCurrentId]    = useState<string>('');
  // W7-A4 (crosscut-03 / knowledge-04 / knowledge-30): a `?id=` the settled
  // roster does not contain, or a `?node=`/`?theme=` no KB owns, is a
  // NOT-FOUND — rendered as the shared NotFound, never silently swapped for
  // the first KB with the wrong id still in the address bar. `null` = no
  // such miss (the normal path).
  const [notFound, setNotFound] = useState<{ kind: 'knowledge base' | 'theme'; id: string } | null>(null);
  const [kbDetail,     setKbDetail]     = useState<KbDetail | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [article,      setArticle]      = useState<KbNodeArticle | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [ready,        setReady]        = useState(false);
  // W6-P4 review fix #3: true once `currentId` is FINAL (not an unconfirmed
  // optimistic ?id= guess still awaiting the roster — see
  // lib/knowledge-id-resolution.ts's `resolveActiveKbId`). The "Load KB
  // detail" effect below only transitions `ready` while this is true, so a
  // stale ?id= that later gets corrected produces exactly ONE ready=true
  // flip, never a transient true→false→true a poller could sample mid-fix.
  const [idConfirmed,  setIdConfirmed]  = useState(true);
  // Pending node to select once the KB detail is loaded
  const pendingNodeRef = useRef<string | null>(null);
  // RULING 1 — true iff the pending node came ONLY from ?theme= (never
  // ?node=), so the detail-load effect can restrict it to theme-layer nodes.
  const pendingIsThemeRef = useRef<boolean>(false);
  // W6-P4: caches the in-flight/completed fetchKb() call, keyed by id — lets
  // the network request start the INSTANT currentId is set (even an
  // unconfirmed optimistic guess), while the state-observable transition to
  // `ready=true` only happens once `idConfirmed` (the "Load KB detail"
  // effect below reuses this promise instead of re-fetching).
  const kbFetchCacheRef = useRef<{ id: string; promise: Promise<KbDetail | null> } | null>(null);
  const getOrStartKbFetch = useCallback((id: string): Promise<KbDetail | null> => {
    if (kbFetchCacheRef.current?.id !== id) {
      kbFetchCacheRef.current = { id, promise: fetchKb(id) };
    }
    return kbFetchCacheRef.current.promise;
  }, []);
  const retryKbDetail = useCallback(() => {
    // The cache holds the REJECTED promise for this id — a retry that
    // re-awaited it would be a no-op. Drop it, then re-run the detail effect.
    kbFetchCacheRef.current = null;
    setDetailKey((k) => k + 1);
  }, []);
  const reloadAll = useCallback(() => {
    reloadKbs();
    // Only a FAILED detail read is re-run on recovery — a healthy graph keeps
    // its selection (the detail effect resets selectedNode/article on re-run).
    if (kbDetailError) retryKbDetail();
  }, [reloadKbs, retryKbDetail, kbDetailError]);
  useBridgeRecovery(reloadAll);

  // track mounted signal to avoid setState on unmounted
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // ── W7-B2: drain-panel ↔ action-group wiring + KB run history ────────────
  // The drain panel reports its display state up (gates the action group
  // instantly); the action group bumps attachNonce after dispatching so the
  // panel re-attaches to the new run.
  const [drainState, setDrainState] = useState<KbDrainDisplayState>('idle');
  const [drainAttachNonce, setDrainAttachNonce] = useState(0);
  const [kbRunRows, setKbRunRows] = useState<LedgerRow[]>([]);
  const [kbRunsReady, setKbRunsReady] = useState(false);
  const [kbRunsError, setKbRunsError] = useState<{ message: string; status?: number } | null>(null);
  const [kbRunsKey, setKbRunsKey] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const refreshKbRuns = useCallback(() => setKbRunsKey((k) => k + 1), []);
  useEffect(() => {
    if (!currentId || tab !== 'health') return;
    let cancelled = false;
    setKbRunsReady(false);
    fetchKbRuns(currentId).then((r) => {
      if (cancelled) return;
      setKbRunsReady(true);
      setNowMs(Date.now());
      if (r.ok) {
        setKbRunRows(toKbRunLedgerRows(currentId, r.runs));
        setKbRunsError(null);
      } else {
        setKbRunRows([]);
        setKbRunsError(r.status !== undefined ? { message: r.error ?? 'read failed', status: r.status } : { message: r.error ?? 'read failed' });
      }
    }).catch(() => { if (!cancelled) setKbRunsReady(true); });
    return () => { cancelled = true; };
  }, [currentId, tab, kbRunsKey]);

  // ── Load KB list (on mount + Retry/bridge recovery via loadKey) ───────────
  useEffect(() => {
    const signal = { cancelled: false };
    fetchStudioKbs().then((kbs) => {
      if (signal.cancelled) return;
      setAllKbs(kbs);
      setKbsError(null);
    }).catch((err: unknown) => {
      // W7-A1: bridge offline / refused is a FAILURE, not an empty roster.
      if (signal.cancelled) return;
      const { error: message, status } = fetchErrorPropsFrom(err);
      setKbsError(status !== undefined ? { message, status } : { message });
    }).finally(() => {
      if (!signal.cancelled) setKbListReady(true);
    });
    return () => { signal.cancelled = true; };
  }, [loadKey]);

  // ── Resolve ?node=/?theme= → owning KB (W7-B2, knowledge-30) ─────────────
  // Deliberately its OWN effect, keyed on the URL params ALONE: the roster
  // load (allKbs / kbListReady) used to re-run the ONE combined selection
  // effect below mid-flight — its cleanup cancelled the first resolve-node
  // fetch and the re-run issued a second, identical one. The id-less resolve
  // needs nothing from the roster, so roster churn must never touch it.
  // ?node= takes priority; ?theme= is a thin alias onto the SAME machinery
  // when ?node= is absent — no parallel selection effect (RULING 1).
  useEffect(() => {
    const pendingParam = nodeParam || themeParam;
    // With ?id= present the roster-keyed effect below owns selection (the id
    // still goes through the roster check; the node is only QUEUED there).
    if (!pendingParam || idParam) return;
    // Store the slug so the detail-load effect can select it. This path is
    // pre-existing/unconditionally-trusted (unaffected by W6-P4) — always
    // confirmed the instant currentId is set here.
    pendingNodeRef.current = pendingParam;
    pendingIsThemeRef.current = !nodeParam && !!themeParam;
    setIdConfirmed(true);
    const signal = { cancelled: false };
    resolveKbNode(pendingParam).then((result) => {
      if (signal.cancelled) return;
      if (result?.kbId) {
        setNotFound(null);
        setCurrentId(result.kbId);
      } else {
        // W7-A4 (knowledge-30): no KB owns this node — say so; never fall
        // back to the first KB with nothing selected.
        pendingNodeRef.current = null;
        pendingIsThemeRef.current = false;
        setNotFound({ kind: 'theme', id: pendingParam });
        setReady(true);
      }
    }).catch(() => {
      if (signal.cancelled) return;
      pendingNodeRef.current = null;
      pendingIsThemeRef.current = false;
      setNotFound({ kind: 'theme', id: pendingParam });
      setReady(true);
    });
    return () => { signal.cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, nodeParam, themeParam]);

  // ── Resolve active KB id (from URL params → first KB) ────────────────────
  // Priority: ?node= (or its ?theme= alias) — handled by the effect ABOVE
  //           when no ?id= accompanies it.
  //           ?id= selects a KB directly (and queues any ?node= given too).
  //           Falls back to first KB in list.
  useEffect(() => {
    const pendingParam = nodeParam || themeParam;
    if (pendingParam) {
      // Node-only deep link: the resolve-node effect above owns this case.
      if (!idParam) return;
      // Both ?id= and ?node=/?theme= given: the id still goes through the
      // roster check (W7-FIX-A4 / W7A4-07 — the not-found path applies
      // whether or not a node is queued); a validated id just queues the
      // node selection.
      pendingNodeRef.current = pendingParam;
      pendingIsThemeRef.current = !nodeParam && !!themeParam;
      setIdConfirmed(true);
      const resolution = resolveActiveKbId(idParam, allKbs, kbListReady);
      if (resolution.source === 'fallback') {
        pendingNodeRef.current = null;
        pendingIsThemeRef.current = false;
        setNotFound({ kind: 'knowledge base', id: idParam });
        setReady(true);
        return;
      }
      setNotFound(null);
      setIdConfirmed(resolution.source !== 'url-optimistic');
      setCurrentId(idParam);
      return;
    }
    if (idParam) {
      // W6-P4 review fix #4: the DECISION is a pure function
      // (lib/knowledge-id-resolution.ts), unit-tested there. This effect
      // only wires it into state — `'url-optimistic'` is the ONE source
      // that isn't final yet (idConfirmed=false, review fix #3): the id is
      // trusted immediately (so kb-detail — and, on a ?tab=ingest-activity
      // deep link, IngestActivityPanel — can start fetching right away, the
      // whole point of this fast path), but `ready` won't observably flip
      // until it's confirmed (see the priming + "Load KB detail" effects
      // below).
      const resolution = resolveActiveKbId(idParam, allKbs, kbListReady);
      setIdConfirmed(resolution.source !== 'url-optimistic');
      // W7-A4 (crosscut-03 / knowledge-04): `source: 'fallback'` with a
      // non-empty ?id= means the settled roster does NOT contain that id —
      // the page renders NotFound for it instead of silently showing the
      // first KB under the wrong URL. (`'none'` = empty roster, handled below.)
      if (resolution.source === 'fallback') {
        setNotFound({ kind: 'knowledge base', id: idParam });
        setReady(true);
        return;
      }
      setNotFound(null);
      if (currentId !== resolution.id) setCurrentId(resolution.id);
      if (resolution.source === 'none') {
        // Mirrors the id-less empty-roster branch below — a stale ?id=
        // against a genuinely empty (settled) roster has no KB to load,
        // ever; the confirmed-gated "Load KB detail" effect never runs
        // without a currentId.
        setReady(true);
      }
      return;
    }
    setIdConfirmed(true);
    setNotFound(null); // bare /knowledge (the NotFound's own back link) clears any prior miss
    if (allKbs.length > 0 && !currentId) {
      setCurrentId(allKbs[0].id);
      return;
    }
    // W6-IA-4 sweep finding C4#1: a genuinely empty roster has no id to
    // select, ever — the "load KB detail" effect below (the only OTHER
    // place `ready` is set) never runs without one. Without this, the page
    // hung on `data-page-ready="false"` forever whenever zero KBs existed.
    if (kbListReady && allKbs.length === 0 && !currentId) {
      setReady(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam, nodeParam, themeParam, allKbs, kbListReady]);

  // ── W6-P4: prime the kb-detail fetch the INSTANT currentId is set ────────
  // Starts the network request right away, even for an unconfirmed
  // optimistic ?id= guess — this is what actually shaves the round trip.
  // Deliberately does NOT touch kbDetail/ready/selectedNode/article: those
  // stay the "Load KB detail" effect's job, gated on confirmation (fix #3).
  useEffect(() => {
    if (currentId) void getOrStartKbFetch(currentId);
  }, [currentId, getOrStartKbFetch]);

  // ── Load KB detail when id changes (AND is confirmed) ────────────────────
  useEffect(() => {
    if (!currentId || !idConfirmed) return;
    const signal = { cancelled: false };
    setReady(false);
    setKbDetail(null);
    // A previous KB's failed detail read is not THIS KB's state (review):
    // the new read starts clean; its own catch re-sets the error if it fails.
    setKbDetailError(null);
    setSelectedNode(null);
    setArticle(null);

    // Reuses the primed fetch above when present (near-instant — the
    // request already went out, possibly before confirmation) instead of
    // issuing a duplicate one.
    getOrStartKbFetch(currentId).then((detail) => {
      if (signal.cancelled) return;
      setKbDetail(detail);
      setKbDetailError(null);
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
    }).catch((err) => {
      // W7-FIX-A1 (A1-07): `fetchKb` throws on any non-404 failure — an
      // ERROR state (kbDetail stays null; the graph area renders the shared
      // FetchErrorState with Retry). Still settles: page-ready is reached.
      if (signal.cancelled) return;
      const { error: message, status } = fetchErrorPropsFrom(err);
      setKbDetailError(status !== undefined ? { message, status } : { message });
      setReady(true);
    });

    return () => { signal.cancelled = true; };
    // detailKey: Retry / bridge recovery re-run the detail read (W7-FIX-A1)
  }, [currentId, idConfirmed, getOrStartKbFetch, detailKey]);

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

  // W7-A4 (crosscut-27): the ONE shared not-found treatment; back = /knowledge
  // (the roster's own default selection, with a clean URL).
  if (notFound) {
    return <NotFound kind={notFound.kind} id={notFound.id} backHref="/knowledge" backLabel="Knowledge" />;
  }

  return (
    <main
      data-page="knowledge"
      {...(ready ? { 'data-page-ready': 'true' } : {})}
      data-fetch-status={kbsError || kbDetailError ? 'error' : kbListReady ? 'ok' : 'loading'}
      {...(kbDetail?.health ? { 'data-health-ready': 'true' } : {})}
      {...(selectedNode ? { 'data-selected-node': selectedNode } : {})}
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', overflow: 'hidden' }}
    >
      <StudioNav />

      {/* W7-B2 (knowledge-23): the just-created KB's seeding session, named
          instead of silently spawned. */}
      {seedSessionParam && (
        <div data-component="kb-seed-banner" style={{ padding: '8px 20px', background: 'rgba(74,222,128,.07)', borderBottom: '1px solid rgba(74,222,128,.25)', fontSize: 12.5, color: 'var(--c-kb)' }}>
          This knowledge base was created and a seeding session is running for it —{' '}
          <Link
            data-action="open-seed-session"
            href={`/sessions/project-brain/${encodeURIComponent(seedSessionParam)}${seedProjectParam ? `?project=${encodeURIComponent(seedProjectParam)}` : ''}`}
            style={{ color: 'var(--c-kb)', fontWeight: 600 }}
          >
            watch the seeding session →
          </Link>
        </div>
      )}

      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px',
        background: 'var(--bg-2)', borderBottom: '1px solid var(--line)',
        flexShrink: 0, flexWrap: 'wrap', rowGap: 10,
      }}>
        <KbSelector kbs={allKbs} currentId={currentId} />

        {/* W6-IA-4: the persistent "+ New KB" CTA — this is where the OLD
            Library landing page's own New-KB affordance moved to (Library
            no longer creates or lists knowledge bases). ALWAYS present,
            independent of the roster size — never gated behind the
            zero-state below, which carries its OWN distinct
            data-action="new-kb-empty-cta" (KnowledgeEmptyState.tsx) so the
            two never collide when both render at once. */}
        <Link href="/knowledge/new" className="btn btn-sm" data-action="new-kb" style={{ textDecoration: 'none' }}>
          + New KB
        </Link>

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

        {/* W7-B2 (knowledge-19/24): the maintenance buttons left this header —
            they are real agent work, not chrome, and live in the ONE gated
            action group on the Health tab now (KbActionGroup). */}

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
          body, re-anchored under this tab; node-click→article is unchanged.
          W6-IA-4 sweep finding C4#1: a genuinely empty roster now renders
          the honest KnowledgeEmptyState (name + CTA), never the generic
          "No KB data available." text a real-but-quiet KB graph also used
          to share. */}
      {tab === 'explore' && kbsError ? (
        <div style={{ padding: '24px 20px', maxWidth: 720 }}>
          <FetchErrorState what="knowledge bases" error={kbsError.message} status={kbsError.status} onRetry={reloadKbs} />
        </div>
      ) : tab === 'explore' && ready && allKbs.length === 0 ? (
        <KnowledgeEmptyState />
      ) : tab === 'explore' && (
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
            ) : kbDetailError ? (
              <div data-section="kb-detail-error" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <div style={{ width: '100%', maxWidth: 640 }}>
                  <FetchErrorState what={`knowledge base "${currentId}"`} error={kbDetailError.message} status={kbDetailError.status} onRetry={retryKbDetail} />
                </div>
              </div>
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

      {/* Health tab: drain-to-green + guidance + KB health, moved under this
          branch (F1 — not rendered unconditionally). W6-B13: KbDrainPanel
          replaces LintResolutionPanel — ONE button drives the KB to green
          server-side; the panel is a pure observer of that server state. */}
      {tab === 'health' && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* W7-B2: the ONE action group (knowledge-05/32) sits first; the
              drain panel below it is the pure observer of whatever run is
              active-or-latest. */}
          {currentId && (
            <KbActionGroup
              kbId={currentId}
              drainState={drainState}
              onDrainDispatched={() => setDrainAttachNonce((n) => n + 1)}
              onMaintained={() => { handlePinned(); refreshKbRuns(); }}
              onDeleted={() => {
                setCurrentId('');
                setKbDetail(null);
                fetchStudioKbs().then((ks) => setAllKbs(ks)).catch(() => {});
              }}
            />
          )}
          {currentId && (
            <KbDrainPanel
              kbId={currentId}
              attachNonce={drainAttachNonce}
              onDisplayStateChange={setDrainState}
              onChanged={() => { handlePinned(); refreshKbRuns(); }}
            />
          )}
          <GuidancePanel
            selectedArticle={article}
            kbId={currentId}
            onPinned={handlePinned}
            pendingGuidance={kbDetail?.guidance ?? []}
          />
          {kbDetail?.health && (
            <KbHealth health={kbDetail.health} />
          )}
          {/* W7-B2 (knowledge-20): every drain / consolidate / cleanup run
              this KB has ever had — the shared RecentRuns widget over
              GET /api/studio/kbs/:id/runs. */}
          {currentId && (
            <div id="kb-recent-runs">
              <RecentRuns
                section="kb-recent-runs"
                title="Recent runs for this KB"
                ready={kbRunsReady}
                rows={kbRunRows}
                nowMs={nowMs}
                error={kbRunsError}
                onRetry={refreshKbRuns}
              />
            </div>
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
  // W7-FIX-A1 (A1-07): a failed feed read is an ERROR state, distinguishable
  // from a genuinely empty feed (`data-fetch-status` + compact FetchErrorState
  // with Retry) — never "No ingest activity recorded yet." on an outage.
  const [ingestError, setIngestError] = useState<{ message: string; status?: number } | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!kbId) { setEvents([]); setIngestError(null); return; }
    setLoading(true);
    const signal = { cancelled: false };
    fetchKbIngestActivity(kbId).then((evs) => {
      if (signal.cancelled) return;
      setEvents(evs);
      setIngestError(null);
      setLoading(false);
    }).catch((err) => {
      if (signal.cancelled) return;
      const { error: message, status } = fetchErrorPropsFrom(err);
      setIngestError(status !== undefined ? { message, status } : { message });
      setLoading(false);
    });
    return () => { signal.cancelled = true; };
  }, [kbId, retryKey]);

  return (
    <div
      data-component="ingest-activity"
      data-ingest-event-count={events.length}
      data-fetch-status={ingestError ? 'error' : loading ? 'loading' : 'ok'}
      style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 }}
    >
      <div className="panel-head">INGEST ACTIVITY</div>
      {loading && <div style={{ color: 'var(--dim)', fontSize: 12.5, marginTop: 8 }}>Loading…</div>}
      {ingestError ? (
        <FetchErrorState what="ingest activity" error={ingestError.message} status={ingestError.status} onRetry={() => setRetryKey((k) => k + 1)} compact />
      ) : null}
      {!loading && !ingestError && events.length === 0 && (
        // W7-B2 (knowledge-21): the honest WHY + the action that would
        // populate this tab, instead of a bare empty line the operator can't
        // interpret (this feed is structurally empty until a reflection pass
        // ingests into a KB — ingest stays reflection-only by design).
        <div data-component="ingest-empty-explainer" style={{ color: 'var(--faint)', fontSize: 12.5, marginTop: 8, maxWidth: 640, lineHeight: 1.6 }}>
          No ingest activity recorded — ingest events are written only when a <strong>reflection pass</strong>{' '}
          (the phase that closes a development cycle) distils that cycle&apos;s learnings into this KB, and no
          retained cycle has run one against it yet. Complete a cycle on{' '}
          <Link href="/flows" style={{ color: 'var(--dim)' }}>a flow run</Link> and its reflection will appear here;
          day-to-day maintenance (drain / consolidate / cleanup) is tracked on the{' '}
          <Link href={`/knowledge?id=${encodeURIComponent(kbId)}&tab=health#kb-recent-runs`} style={{ color: 'var(--dim)' }}>Health tab&apos;s run history</Link> instead.
        </div>
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

// KbMaintenance (K3) → KbActionGroup (W7-B2): the maintenance strip became
// the ONE gated action group on the Health tab
// (components/studio/knowledge/KbActionGroup.tsx) — Drain to green ·
// Consolidate · Cleanup plan · Refresh this KB's index · Delete, mutually
// gated on the server's own per-KB active-job fact.
