'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { StudioArchitectShell } from '@/components/StudioArchitectShell';
import { startInstructions, startDemoBuilder, startProjectBrain, startAuthoring, startCommunityRefresh } from '@/lib/bridge-client';
import { fetchStudioProjects, fetchAgentCapability, fetchStudioKbs, fetchStudioSessions, startKbCleanup, type AgentCapability, type Kb, type SessionIndexRow } from '@/lib/studio-client';
import { KickoffModelTierPicker, allowedTiersFromCapability } from '@/components/studio/session/KickoffModelTierPicker';
import { describeLifecycle } from '@/lib/session-lifecycle-client';
import { KB_SEEDING_ANCHOR_PREFIX, COMMUNITY_REGISTRY_ANCHOR } from '@/lib/session-shell-view';

// ---------------------------------------------------------------------------
// SessionKickoffPage — the ONE kickoff screen for every session kind (W6-B6,
// task item 3). Context card + project/KB select + prompt (when the kind
// takes one) + a model-tier picker (`KickoffModelTierPicker`) rendered from
// the agent's OWN `SKILL.md`-declared envelope
// (`agentCapabilityDescriptor.allowedTiers`, ADR-043 2026-08-15 amendment
// §3) → Start → the kind's existing `/start` route → `router.push` onto the
// shared session shell.
//
// W6-B6 fix (wave-6 final gate, journey demo-builder DB-4): the capability is
// fetched via `fetchAgentCapability(spec.agentSlug)` — the UNFILTERED
// per-slug route (`GET /api/studio/agents/:slug/capability`) — NEVER
// `fetchStudioAgents()`'s roster, which drops every `library:false` agent
// (orchestrator/studio/registry.ts's `isStudioAgent`). Every kickoff-only
// system agent this page dispatches (instructions-creator, demo-builder,
// brain-maintenance, creation-agent, project-brain-builder) sets that flag,
// so the roster lookup never found any of them and the picker always fell
// back to the read-only 'fixed' chip — even for a real `strategy:range`
// SKILL.md.
//
// Kinds: instructions, demo, kb-cleanup (KB select, not project), authoring
// (the only one that takes a free-text prompt — its `/start` body REQUIRES
// one), project-brain, community-refresh (W6-CR-3 — the ONLY kind with
// `selector: 'none'`: the community registry is forge's own single,
// forge-wide file, not a per-project artifact, so there is nothing for the
// operator to select — just Start + a model-tier picker). `architect` is
// explicitly OUT — it keeps its own native entry, `/architect/new`
// (`NewIdeaBox`) — this page links to it rather than duplicating it
// (ADR-043 amendment §4: architect stays bespoke end to end, panel AND
// kickoff alike).
// ---------------------------------------------------------------------------

type KickoffKindId = 'instructions' | 'demo' | 'kb-cleanup' | 'authoring' | 'project-brain' | 'community-refresh';

type KickoffKindSpec = {
  title: string;
  /** The skill slug this kind's agent runs — resolves the SKILL.md-declared
   *  model envelope via `fetchAgentCapability()` (the unfiltered per-slug
   *  route, W6-B6 fix — NOT `fetchStudioAgents()`'s roster, which drops
   *  every `library:false` kickoff-only agent). */
  agentSlug: string;
  artifactLabel: string;
  /** 'none' (W6-CR-3): no project/KB selector at all — the kind's `/start`
   *  route takes neither, and the context card renders the fixed session
   *  home directly rather than an operator-filled path. */
  selector: 'project' | 'kb' | 'none';
  /** Only 'authoring' takes a free-text prompt — its `/start` body requires
   *  one (every other kind's `/start` route needs no operator prose at
   *  kickoff; instructions/demo take their brief on a LATER turn, via their
   *  own bespoke panel's briefing step). */
  promptLabel?: string;
  promptPlaceholder?: string;
};

const KICKOFF_KINDS: Record<KickoffKindId, KickoffKindSpec> = {
  instructions: { title: 'Instructions session', agentSlug: 'instructions-creator', artifactLabel: 'AGENTS.md draft', selector: 'project' },
  demo: { title: 'Demo capability session', agentSlug: 'demo-builder', artifactLabel: 'Demo generations', selector: 'project' },
  'kb-cleanup': { title: 'KB cleanup session', agentSlug: 'brain-maintenance', artifactLabel: 'Cleanup plan', selector: 'kb' },
  authoring: { title: 'Authoring session', agentSlug: 'creation-agent', artifactLabel: 'Package', selector: 'project', promptLabel: 'Describe what to build', promptPlaceholder: 'Describe what it should do…' },
  'project-brain': { title: 'Brain creation session', agentSlug: 'project-brain-builder', artifactLabel: 'Seeded structure', selector: 'project' },
  'community-refresh': { title: 'Community refresh session', agentSlug: 'community-refresh', artifactLabel: 'Registry draft', selector: 'none' },
};

function isKickoffKind(kind: string): kind is KickoffKindId {
  return kind in KICKOFF_KINDS;
}

function SessionKickoffPageInner({ params }: { params: { kind: string } }): JSX.Element {
  const kind = decodeURIComponent(params.kind);
  const router = useRouter();
  const searchParams = useSearchParams();
  // W6-B10: the roadmap's "demo builder →" entrypoint (and any other
  // deep-link into this kickoff screen) can hand over a known project up
  // front — `resolveDemoEntryHref` (lib/demo-entry-view.ts) is the one
  // sender today, but the prefill is generic over every kind, not demo-only.
  // `initiative` rides along for context ONLY (shown in the context card,
  // never used to look anything up — sessions here are project-scoped).
  const prefillProject = searchParams.get('project') ?? '';
  const prefillInitiative = searchParams.get('initiative');
  // W7-B2 (knowledge-33): the KB screen's "Cleanup plan" button deep-links
  // here with its KB pre-selected — ONE kickoff surface, same options.
  const prefillKb = searchParams.get('kb') ?? '';

  const [knownProjects, setKnownProjects] = useState<string[]>([]);
  const [kbs, setKbs] = useState<Kb[]>([]);
  // W7-A2 (home-sessions-22, sessions-kinds-28) — every in-flight session
  // (the SAME `GET /api/studio/sessions?active=1` read /sessions and Home
  // use), so this screen can show the ones already open for the chosen
  // kind + target and require an explicit "start another".
  const [activeSessions, setActiveSessions] = useState<SessionIndexRow[]>([]);
  const [confirmingAnother, setConfirmingAnother] = useState(false);
  const [capability, setCapability] = useState<AgentCapability | null>(null);
  const [ready, setReady] = useState(false);

  const [project, setProject] = useState(prefillProject);
  const [kbId, setKbId] = useState(prefillKb);
  const [prompt, setPrompt] = useState('');
  const [modelTier, setModelTier] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = isKickoffKind(kind) ? KICKOFF_KINDS[kind] : null;

  useEffect(() => {
    if (!spec) {
      setReady(true);
      return;
    }
    let cancelled = false;
    setError(null);
    Promise.all([
      fetchStudioProjects(),
      // W6-B6 fix — the UNFILTERED per-slug capability route, resolved
      // directly against `spec.agentSlug`. NOT the roster `fetchStudioAgents()`
      // returns: that roster drops every `library:false` agent
      // (orchestrator/studio/registry.ts's `isStudioAgent`), which is every
      // kickoff-only system agent this page's KICKOFF_KINDS names — so the
      // roster lookup NEVER found them and the picker always fell back to the
      // read-only 'fixed' chip, even for a real strategy:range SKILL.md.
      fetchAgentCapability(spec.agentSlug),
      spec.selector === 'kb' ? fetchStudioKbs() : Promise.resolve([]),
      fetchStudioSessions(),
    ])
      .then(([projects, cap, kbList, sessions]) => {
        if (cancelled) return;
        setKnownProjects(projects.map((p) => p.name).filter(Boolean).sort());
        setCapability(cap);
        setKbs(kbList);
        setActiveSessions(sessions);
        // W7-B2 (knowledge-26): pre-select the range's FIRST allowed tier as
        // the default instead of leaving both radios unchecked (the started
        // session then records the tier that was actually sent, never a
        // literal "default" the operator can't interpret).
        const tiers = allowedTiersFromCapability(cap);
        if (tiers.length > 0) {
          setModelTier((prev) => (prev === '' ? tiers[0] : prev));
        }
      })
      .catch((err) => {
        // W6-B6 post-merge review (LOW): the prior `.catch(() => [])` on
        // each individual fetch hid a real load failure as an honest-looking
        // empty list — never surfaced. This top-level catch is the real
        // failure path; `data-kickoff-error` reuses the SAME error banner
        // the submit path already renders below.
        if (!cancelled) setError(`failed to load kickoff data: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Shared with KickoffModelTierPicker's own internal derivation — ONE rule
  // for "this agent has a real operator-choosable tier range", not two
  // independently-computed copies that could drift.
  const isRangeTier = allowedTiersFromCapability(capability).length > 0;

  const selectorFilled = spec?.selector === 'kb' ? kbId.trim().length > 0 : spec?.selector === 'none' ? true : project.trim().length > 0;
  const promptFilled = spec?.promptLabel ? prompt.trim().length > 0 : true;
  const canSubmit = Boolean(spec) && selectorFilled && promptFilled && !submitting;

  // W7-A2 — the in-flight sessions of THIS kind on the SAME target. The
  // target is the session's anchor project exactly as the bridge indexes it:
  // the project id; for a KB-anchored kind, the KB's OWN binding decides —
  // a `project`-bound KB nests its sessions under that real project, every
  // other binding under the `.kb-<id>` dot-anchor (`POST /api/studio/kbs/
  // :id/cleanup/start`, cli/ui-bridge.ts — mirrored here, never guessed
  // from the id alone); `.community-registry` for the selector-less
  // community refresh (the bridge's own COMMUNITY_REFRESH_PROJECT_ANCHOR
  // literal — see forge-ui/lib/session-shell-view.ts's parity-tested mirror).
  const selectedKb = spec?.selector === 'kb' ? kbs.find((k) => k.id === kbId.trim()) ?? null : null;
  const targetAnchor =
    spec?.selector === 'kb'
      ? (selectedKb === null ? null : selectedKb.binding.kind === 'project' ? selectedKb.binding.ref : `${KB_SEEDING_ANCHOR_PREFIX}${selectedKb.id}`)
    : spec?.selector === 'none' ? COMMUNITY_REGISTRY_ANCHOR
    : project.trim() || null;
  const existingSessions = targetAnchor !== null ? activeSessions.filter((r) => r.kind === kind && r.project === targetAnchor && !r.terminal) : [];
  const hasExisting = existingSessions.length > 0;
  // A changed target disarms a pending "start another" confirm — and
  // (W7A2-05) refreshes the in-flight snapshot the guard reads, so it is
  // never a mount-time picture of a target the operator only chose later.
  // A failed refresh keeps the last snapshot (the guard is advisory; the
  // submit path below re-reads live and surfaces its own failure).
  useEffect(() => {
    setConfirmingAnother(false);
    if (!ready || targetAnchor === null) return;
    let cancelled = false;
    fetchStudioSessions()
      .then((s) => { if (!cancelled) setActiveSessions(s); })
      .catch(() => { /* advisory guard: keep the last snapshot */ });
    return () => { cancelled = true; };
    // `ready` gates the first pass (the mount load already fetched sessions).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAnchor]);

  async function onSubmit(): Promise<void> {
    if (!spec || !canSubmit) return;
    // W7-A2 — duplicate guard: with a session of this kind already open on
    // this target, the FIRST click only arms the button ("Yes, start
    // another"); the second click really starts one. Never silent.
    // W7A2-05: the guard decides on a LIVE read, not the mount-time
    // snapshot — a session started in another tab since load still arms it.
    if (!confirmingAnother) {
      let live = activeSessions;
      try {
        live = await fetchStudioSessions();
        setActiveSessions(live);
      } catch (err) {
        setError(`failed to check for existing sessions: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      const liveExisting = targetAnchor !== null && live.some((r) => r.kind === kind && r.project === targetAnchor && !r.terminal);
      if (liveExisting) {
        setConfirmingAnother(true);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    const tier = isRangeTier && modelTier ? modelTier : undefined;
    try {
      let result: { ok: boolean; sessionId?: string; error?: string; project?: string };
      switch (kind) {
        case 'instructions':
          result = await startInstructions({ project: project.trim(), mode: 'init', modelTier: tier });
          break;
        case 'demo':
          result = await startDemoBuilder({ project: project.trim(), mode: 'create', modelTier: tier });
          break;
        case 'authoring':
          result = await startAuthoring({ project: project.trim(), prompt: prompt.trim(), modelTier: tier });
          break;
        case 'project-brain':
          result = await startProjectBrain({ project: project.trim(), modelTier: tier });
          break;
        case 'community-refresh':
          result = await startCommunityRefresh({ modelTier: tier });
          break;
        case 'kb-cleanup': {
          const r = await startKbCleanup(kbId.trim(), tier);
          result = r.ok ? { ok: true, sessionId: r.sessionId, project: r.project } : { ok: false, error: r.error };
          break;
        }
        default:
          result = { ok: false, error: `no kickoff route wired for kind "${kind}"` };
      }
      if (!result.ok || !result.sessionId) {
        setError(result.error ?? 'failed to start session');
        return;
      }
      const sessionProject = result.project ?? project.trim();
      router.push(`/sessions/${encodeURIComponent(kind)}/${encodeURIComponent(result.sessionId)}?project=${encodeURIComponent(sessionProject)}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (kind === 'architect') {
    return (
      <StudioArchitectShell dataPage="session-kickoff" ready={true} title="New planning session">
        <p style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: 560, lineHeight: 1.6 }}>
          Architect sessions start at its own native entry — this generic kickoff never duplicates it.
        </p>
        <Link href="/architect/new" className="btn btn-primary" style={{ display: 'inline-block', marginTop: 6 }}>
          Go to /architect/new →
        </Link>
      </StudioArchitectShell>
    );
  }

  if (!spec) {
    return (
      <StudioArchitectShell dataPage="session-kickoff" ready={true} title={kind}>
        <div data-section="kickoff-unknown-kind" style={{ fontSize: 13, color: 'var(--dim)' }}>
          Session kind &quot;{kind}&quot; has no kickoff entry.
        </div>
      </StudioArchitectShell>
    );
  }

  return (
    <StudioArchitectShell
      dataPage="session-kickoff"
      ready={ready}
      title={spec.title}
      mainData={{ 'data-kickoff-kind': kind }}
    >
      <div data-section="kickoff-context" style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={rowLabel}>Agent</div>
        <div style={rowValue}>
          {spec.agentSlug} <span style={mono}>· skills/{spec.agentSlug}/SKILL.md</span>
        </div>
        <div style={rowLabel}>Produces</div>
        <div style={rowValue}>{spec.artifactLabel}</div>
        <div style={rowLabel}>Session directory</div>
        <div style={{ ...rowValue, ...mono }}>
          {spec.selector === 'none'
            ? `projects/<forge-anchor>/_${kind}/<sessionId>`
            : `projects/${spec.selector === 'kb' ? '<kb-project>' : project.trim() || '<project>'}/_${kind}/<sessionId>`}
        </div>
        {prefillInitiative && (
          <div data-section="kickoff-initiative-context" style={{ fontSize: 11.5, color: 'var(--dim)' }}>
            Opened from initiative <span style={mono}>{prefillInitiative}</span> — sessions here are
            project-scoped, not tied to it; this is context only.
          </div>
        )}
      </div>

      {spec.selector !== 'none' && (
        <div data-section="kickoff-selector" style={{ ...cardStyle, marginBottom: 14 }}>
          {spec.selector === 'kb' ? (
            <>
              <div style={rowLabel}>Knowledge base</div>
              <select value={kbId} onChange={(e) => setKbId(e.target.value)} data-field="kickoff-kb" style={inputStyle}>
                <option value="">select a KB…</option>
                {kbs.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.id})
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <div style={rowLabel}>Project</div>
              <input
                list="forge-kickoff-known-projects"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="a project"
                data-field="kickoff-project"
                style={inputStyle}
              />
              <datalist id="forge-kickoff-known-projects">
                {knownProjects.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </>
          )}
        </div>
      )}

      {spec.promptLabel && (
        <div data-section="kickoff-prompt" style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={rowLabel}>{spec.promptLabel}</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={spec.promptPlaceholder}
            rows={3}
            data-field="kickoff-prompt"
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
      )}

      <KickoffModelTierPicker capability={capability} modelTier={modelTier} onChange={setModelTier} />

      {hasExisting && (
        <section
          data-section="kickoff-existing-sessions"
          data-existing-count={existingSessions.length}
          aria-label="Sessions already open on this target"
          style={{ ...cardStyle, marginBottom: 14, borderColor: 'var(--ember)' }}
        >
          <div style={rowLabel}>Already open on this target</div>
          <p style={{ fontSize: 12.5, color: 'var(--dim)', margin: '0 0 8px', lineHeight: 1.5 }}>
            {existingSessions.length === 1 ? 'A' : `${existingSessions.length}`} {kind} session{existingSessions.length === 1 ? ' is' : 's are'} already in flight for this target. Open it instead, or start another on purpose.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {existingSessions.map((r) => (
              <li key={`${r.kind}-${r.sessionId}`} data-existing-session data-session-state={r.state} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12.5 }}>
                <Link href={r.href} data-action="open-existing-session" style={{ color: 'var(--ember)', fontFamily: 'ui-monospace, Menlo, monospace', textDecoration: 'none' }}>
                  {r.sessionId} →
                </Link>
                <span style={{ color: 'var(--dim)', fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.phase}</span>
                <span style={{ color: 'var(--faint)' }}>{describeLifecycle(r.state, r.error, r.idleMs)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <div data-kickoff-error style={{ color: 'var(--red, #f87171)', fontSize: 12.5, marginBottom: 10 }}>
          {error}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        data-action="start-session"
        data-existing-count={existingSessions.length}
        data-confirming={hasExisting && confirmingAnother}
        disabled={!canSubmit}
        onClick={() => void onSubmit()}
        style={{ opacity: canSubmit ? 1 : 0.5 }}
      >
        {submitting ? 'Starting…' : hasExisting ? (confirmingAnother ? 'Yes, start another' : 'Start another session') : 'Start session'}
      </button>
      {hasExisting && confirmingAnother && !submitting && (
        <button
          type="button"
          data-action="start-session-abort"
          onClick={() => setConfirmingAnother(false)}
          style={{ marginLeft: 10, fontSize: 12.5, background: 'none', border: 'none', color: 'var(--faint)', cursor: 'pointer', textDecoration: 'underline' }}
        >
          keep the existing one
        </button>
      )}
    </StudioArchitectShell>
  );
}

// ---------------------------------------------------------------------------
// Exported page — wraps the inner component in Suspense (required by Next.js
// 14 when useSearchParams() is used anywhere in the render tree; mirrors
// app/artifact/page.tsx's ArtifactPageInner/ArtifactPage split).
// ---------------------------------------------------------------------------

export default function SessionKickoffPage(props: { params: { kind: string } }): JSX.Element {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 13 }}>
          Loading…
        </div>
      }
    >
      <SessionKickoffPageInner {...props} />
    </Suspense>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--bg-2)', maxWidth: 560,
};
const rowLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 };
const rowValue: React.CSSProperties = { fontSize: 13, color: 'var(--text)', marginBottom: 12 };
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--dim)' };
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', fontSize: 13,
};
