'use client';

import { useEffect, useState, Suspense } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { StudioArchitectShell } from '@/components/StudioArchitectShell';
import { NotFound } from '@/components/NotFound';
import { NewIdeaBox } from '@/components/NewIdeaBox';
import { routeReady } from '@/lib/route-readiness';
import { useProjectRoster } from '@/lib/use-project-roster';
import { startInstructions, startDemoBuilder, startProjectBrain, startAuthoring } from '@/lib/bridge-client';
import { fetchStudioProjects, fetchAgentCapability, fetchStudioKbs, fetchStudioSessions, fetchRun, startKbCleanup, startOnboardingSession, type AgentCapability, type Kb, type SessionIndexRow } from '@/lib/studio-client';
import { KickoffModelTierPicker, allowedTiersFromCapability } from '@/components/studio/session/KickoffModelTierPicker';
import { KickoffContextCard } from '@/components/studio/session/KickoffContextCard';
import { describeLifecycle } from '@/lib/session-lifecycle-client';
import { KB_SEEDING_ANCHOR_PREFIX, COMMUNITY_REGISTRY_ANCHOR } from '@/lib/session-shell-view';
import { reconcileProjectPrefill, reconcileSelectPrefill } from '@/lib/kickoff-form';
import { kickoffSpecFor, sessionKindTitle } from '@/lib/session-kind-meta';
import { defaultKickoffTier, sessionDirPreview, kickoffMainData } from '@/lib/kickoff-view';

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
// (`@forge/agents/studio/agent-registry.ts`'s `isStudioAgent`). Every kickoff-only
// system agent this page dispatches (instructions-creator, demo-builder,
// brain-maintenance, creation-agent, project-brain-builder) sets that flag,
// so the roster lookup never found any of them and the picker always fell
// back to the read-only 'fixed' chip — even for a real `strategy:range`
// SKILL.md.
//
// Kinds: instructions, demo, kb-cleanup (KB select, not project), authoring
// (the only one that takes a free-text prompt — its `/start` body REQUIRES
// one), project-brain, onboarding (W7-C1 — the retired onboard-project flow
// wrapper's replacement entry; project select only). `architect` is
// explicitly OUT — it keeps its own native entry, `/architect/new`
// (`NewIdeaBox`) — this page links to it rather than duplicating it
// (ADR-043 amendment §4: architect stays bespoke end to end, panel AND
// kickoff alike).
//
// W8-B5b WI-3: the `community-refresh` kind (W6-CR-3) — the ONLY kind ever to
// use `selector: 'none'` (the community registry is forge's own single,
// forge-wide file, not a per-project artifact) — is retired; the generic
// `selector === 'none'` branches below are kept as live generic mechanism for
// any future forge-wide, non-project kind, but currently have no real
// consumer (`kickoffSpecFor` never returns one).
// ---------------------------------------------------------------------------

// W7-B1 (home-sessions-19): the per-kind form specs moved to
// `lib/session-kind-meta.ts` (KICKOFF_SPECS + the hasOwn-guarded
// `kickoffSpecFor` accessor) — ONE module beside the kind titles and the
// shared kickoff list, parity-pinned against studio/session-kinds.yaml,
// ending this page's half of the two-list drift. (W7-B4's parallel
// extraction of the same table, lib/kickoff-kinds.ts, was consolidated INTO
// session-kind-meta at merge time — agents-22's session-entry derivation now
// reads sessionEntryHrefForAgent from there.)

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

  // W7-B6 (sessions-kinds-02): real roster IDS (+ display names) — the field
  // below is a SELECT over them, never free text a typo could submit.
  const [knownProjects, setKnownProjects] = useState<{ id: string; name: string }[]>([]);
  const [kbs, setKbs] = useState<Kb[]>([]);
  // W7-A2 (home-sessions-22, sessions-kinds-28) — every in-flight session
  // (the SAME `GET /api/studio/sessions?active=1` read /sessions and Home
  // use), so this screen can show the ones already open for the chosen
  // kind + target and require an explicit "start another".
  const [activeSessions, setActiveSessions] = useState<SessionIndexRow[]>([]);
  const [confirmingAnother, setConfirmingAnother] = useState(false);
  const [capability, setCapability] = useState<AgentCapability | null>(null);
  const [ready, setReady] = useState(false);

  // W7-B6 review F2: NEVER seed the select from the raw prefill — the field
  // is a select over roster ids, so an unvalidated prefill (a deleted
  // project, a pre-B6 NAME-based link) rendered a BLANK select while Start
  // stayed enabled and submitted the invisible stale value. The prefill is
  // reconciled against the loaded roster below (shared rule with NewIdeaBox:
  // lib/kickoff-form.ts) — a miss surfaces `data-unknown-project` instead.
  const [project, setProject] = useState('');
  const [unknownPrefill, setUnknownPrefill] = useState<string | null>(null);
  // W8-B3 (sessions-kinds-R03) — the `?kb=` prefill goes through the SAME
  // reconcile rule as `?project=` (lib/kickoff-form.ts). It used to be seeded
  // raw, so `/sessions/kb-cleanup/new?kb=not-a-real-kb` showed the select's
  // "select a KB…" placeholder while Start stayed enabled and POSTed the value
  // the operator could not see, straight into a 404. Start empty; the loader
  // below seeds it only when the roster really has that id.
  const [kbId, setKbId] = useState('');
  const [unknownKbPrefill, setUnknownKbPrefill] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [modelTier, setModelTier] = useState<string>('');
  // forge-8vfn.5.10 (sessions-owned site) — the id this page mints, published
  // on the page that minted it BEFORE it navigates away. Until this existed the
  // POST's result went straight into `router.push` and the id appeared nowhere
  // an observer could read: not to a story, not to a journey, not to an operator
  // whose navigation failed. Empty means "started nothing", which is why the
  // attribute is always rendered rather than conditionally added.
  const [mintedSessionId, setMintedSessionId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // W7-B3 (community-22): the "?initiative=" context card renders ONLY for a
  // run the bridge actually knows — arbitrary query text was echoed back as
  // if it were a real object. null = nothing to validate / not resolved.
  const [initiativeKnown, setInitiativeKnown] = useState<boolean | null>(null);

  // forge-8vfn.5.7: the architect branch below renders NewIdeaBox, whose
  // roster read IS this route's first fetch in that branch — so its
  // `data-page-ready` derives from the same state, never a literal `true`.
  const architectRoster = useProjectRoster();

  const spec = kickoffSpecFor(kind);

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
      // (`@forge/agents/studio/agent-registry.ts`'s `isStudioAgent`), which is every
      // kickoff-only system agent this page's KICKOFF_KINDS names — so the
      // roster lookup NEVER found them and the picker always fell back to the
      // read-only 'fixed' chip, even for a real strategy:range SKILL.md.
      fetchAgentCapability(spec.agentSlug),
      spec.selector === 'kb' ? fetchStudioKbs() : Promise.resolve([]),
      fetchStudioSessions(),
    ])
      .then(([projects, cap, kbList, sessions]) => {
        if (cancelled) return;
        const list = projects
          .map((p) => ({ id: p.id, name: p.name ?? p.id }))
          .sort((a, b) => a.id.localeCompare(b.id));
        setKnownProjects(list);
        // Review F2: the ?project= prefill seeds the select ONLY when it
        // names a real roster id; a miss becomes an honest notice.
        const reconciled = reconcileProjectPrefill(prefillProject, list.map((p) => p.id));
        if (reconciled.project) setProject(reconciled.project);
        setUnknownPrefill(reconciled.unknownPrefill);
        setCapability(cap);
        setKbs(kbList);
        // W8-B3 (sessions-kinds-R03) — same treatment, same rule, same notice
        // shape as the project prefill above.
        const reconciledKb = reconcileSelectPrefill(prefillKb, kbList.map((k) => k.id));
        if (reconciledKb.selected) setKbId(reconciledKb.selected);
        setUnknownKbPrefill(reconciledKb.unknownPrefill);
        setActiveSessions(sessions);
        // W7-B3 (community-12) / W7-B2 (knowledge-26): pre-select the tier the
        // agent will ACTUALLY run on when nothing is chosen — the cheapest of
        // the SKILL envelope, the SAME default the server applies (both lanes
        // converged on this; `defaultKickoffTier` is the tested, shared
        // helper). Never overrides a choice the operator already made.
        setModelTier((prev) => prev || defaultKickoffTier(allowedTiersFromCapability(cap)));
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

  // W7-B3 (community-22): resolve the "?initiative=" ref against the bridge
  // before rendering it as context — an unknown id is flagged as ignored,
  // never echoed back as a real object.
  useEffect(() => {
    if (!prefillInitiative) {
      setInitiativeKnown(null);
      return;
    }
    let cancelled = false;
    fetchRun(prefillInitiative)
      .then((run) => {
        if (!cancelled) setInitiativeKnown(run !== null);
      })
      .catch(() => {
        // A failed read is not "unknown initiative" — leave it unresolved
        // (no card, no ignored-flag) rather than asserting either way.
        if (!cancelled) setInitiativeKnown(null);
      });
    return () => {
      cancelled = true;
    };
  }, [prefillInitiative]);

  // Shared with KickoffModelTierPicker's own internal derivation — ONE rule
  // for "this agent has a real operator-choosable tier range", not two
  // independently-computed copies that could drift.
  const isRangeTier = allowedTiersFromCapability(capability).length > 0;

  const selectorFilled = spec?.selector === 'kb' ? kbId.trim().length > 0 : spec?.selector === 'none' ? true : project.trim().length > 0;
  // W7-B3 (community-08): a prompt field is only a Start-gate when the kind
  // REQUIRES it (authoring) — an optional prompt (`promptRequired: false`)
  // never blocks Start.
  const promptFilled = spec?.promptLabel && spec.promptRequired ? prompt.trim().length > 0 : true;
  const canSubmit = Boolean(spec) && selectorFilled && promptFilled && !submitting;
  // W7-B6 (crosscut-25): why Start is disabled, stated next to the button.
  const kickoffDisabledReason = submitting || canSubmit
    ? null
    : !selectorFilled
      ? spec?.selector === 'kb' ? 'select a knowledge base' : 'select a project'
      : !promptFilled
        ? `${spec?.promptLabel ?? 'a prompt'} is required`
        : null;

  // W7-A2 — the in-flight sessions of THIS kind on the SAME target. The
  // target is the session's anchor project exactly as the bridge indexes it:
  // the project id; for a KB-anchored kind, the KB's OWN binding decides —
  // a `project`-bound KB nests its sessions under that real project, every
  // other binding under the `.kb-<id>` dot-anchor (`POST /api/studio/kbs/
  // :id/cleanup/start`, apps/forge/ui-bridge.ts — mirrored here, never guessed
  // from the id alone); `COMMUNITY_REGISTRY_ANCHOR` (`.community-registry`)
  // remains the dot-anchor for any selector-less kind — the retired
  // community-refresh kind was its one real consumer (W8-B5b WI-3); the two
  // historical sessions filed under it, and `/community` itself, are still
  // real (see `pseudoProjectAnchorDestination`, session-shell-view.ts).
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
        case 'kb-cleanup': {
          const r = await startKbCleanup(kbId.trim(), tier);
          result = r.ok ? { ok: true, sessionId: r.sessionId, project: r.project } : { ok: false, error: r.error };
          break;
        }
        // W7-C1 (sessions-kinds-01/crosscut-14): the onboarding session's
        // generic kickoff — the onboard-project FLOW wrapper is retired, so
        // this page is onboarding's one direct entry. The route takes only
        // {project} (onboarding-agent is strategy:fixed — no tier on the
        // wire; the picker renders its read-only chip).
        case 'onboarding': {
          const r = await startOnboardingSession(project.trim());
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
      // `flushSync`, not a bare setState: `router.push` on the next line begins
      // navigating immediately, and React would not have committed the update
      // before it did — the attribute reached the DOM of the page being left as
      // the EMPTY STRING. S9 run 3 caught exactly that (`expected a value to
      // bind as <authoringSessionId>, got ""`) on a run that dispatched a real
      // agent. Committing synchronously is what makes the id observable on the
      // page that minted it, which is the whole point of publishing it.
      flushSync(() => setMintedSessionId(result.sessionId as string));
      router.push(`/sessions/${encodeURIComponent(kind)}/${encodeURIComponent(result.sessionId)}?project=${encodeURIComponent(sessionProject)}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (kind === 'architect') {
    // W7-B6 (sessions-kinds-03): the two architect entries CONVERGE on the
    // one form (`NewIdeaBox` — roster select + tier + ceiling); this page no
    // longer bounces the operator through a link to /architect/new.
    return (
      <StudioArchitectShell dataPage="session-kickoff" ready={routeReady(architectRoster.state)} title="New idea → architect" mainData={{ 'data-kickoff-kind': 'architect' }}>
        {/* W8-B3 (sessions-kinds-R07) — architect was the only one of the eight
            kickoffs with no way back: the other seven get `data-action=
            "kickoff-back"` from KickoffContextCard, but this branch returns
            early with its own shell and never reaches it. Same link, same DOM
            action name, so the escape hatch is now uniform across all eight. */}
        <Link
          href="/sessions"
          data-action="kickoff-back"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--dim)', textDecoration: 'none', marginBottom: 12 }}
        >
          ← back to sessions
        </Link>
        <p style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: 560, lineHeight: 1.6, margin: '0 0 16px' }}>
          Describe the idea; forge reads the project and the brain, asks only what it can&apos;t
          resolve itself, then drafts a plan for your approval. Same form as{' '}
          <Link href="/architect/new" style={{ color: 'var(--dim)' }}>/architect/new</Link>.
        </p>
        <div style={{ maxWidth: 560 }}>
          <NewIdeaBox key={prefillProject} roster={architectRoster} initialProject={prefillProject} />
        </div>
      </StudioArchitectShell>
    );
  }

  if (!spec) {
    // W8-B3 (crosscut-R08) — the shared NotFound, exactly what the sibling
    // route `/sessions/<bogus>/<sid>` already renders. This branch used to
    // return a full kickoff SHELL (`data-page="session-kickoff"`,
    // `data-page-ready="true"`, a breadcrumb and an h1 both naming the bogus
    // kind) whose entire body was one sentence, with zero buttons, no
    // `data-not-found-*` attributes and no way out but the top nav. Two
    // addresses one character apart answered "this does not exist" in two
    // different shapes, and only one of them let the operator leave.
    return (
      <NotFound
        kind="session kind"
        id={kind}
        backHref="/sessions"
        backLabel="Sessions"
        detail={`No session kind "${kind}" is registered, so there is nothing to start here.`}
      />
    );
  }

  return (
    <StudioArchitectShell
      dataPage="session-kickoff"
      ready={ready}
      title={sessionKindTitle(kind)}
      mainData={kickoffMainData(kind, mintedSessionId)}
    >
      {/* W7-B1 (sessions-kinds-05): plain-English orientation first, the
          on-disk provenance demoted to one line, and a way back out —
          see KickoffContextCard's own header. */}
      <div style={{ marginBottom: 14 }}>
        <KickoffContextCard
          kind={kind}
          spec={spec}
          // W7-B3 (community-12, historical — the pattern's one real
          // consumer, community-refresh, is retired): a selector-less kind
          // would get its REAL anchor here, never the literal `<forge-anchor>`
          // placeholder other kinds keep (kickoff-view.sessionDirPreview).
          sessionDirHint={sessionDirPreview(kind, spec.selector, project)}
          // W7-B3 (community-22): only a run the bridge actually knows renders
          // as context — an unknown ref shows the "ignored" notice below.
          initiative={initiativeKnown === true ? prefillInitiative : null}
        />
        {prefillInitiative && initiativeKnown === false && (
          <div data-section="kickoff-initiative-ignored" style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 8 }}>
            The <span style={monoInline}>?initiative=</span> reference in this URL matches no known run — ignored.
          </div>
        )}
        {spec.selector === 'none' && prefillProject && (
          <div data-section="kickoff-project-ignored" style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 8 }}>
            The <span style={monoInline}>?project=</span> parameter is ignored — this session kind is forge-wide,
            not project-scoped.
          </div>
        )}
      </div>

      {spec.selector !== 'none' && (
        <div data-section="kickoff-selector" style={{ ...cardStyle, marginBottom: 14 }}>
          {spec.selector === 'kb' ? (
            <>
              <div style={rowLabel}>Knowledge base</div>
              {/* W8-B3 (sessions-kinds-R03) — the honest notice the project
                  select already had: a prefill the roster does not know is
                  surfaced, never silently submitted. */}
              {unknownKbPrefill && (
                <div data-unknown-kb={unknownKbPrefill} style={{ color: 'var(--red, #f87171)', fontSize: 12, marginBottom: 8 }}>
                  Knowledge base &quot;{unknownKbPrefill}&quot; is not in the roster — pick a real one below.
                </div>
              )}
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
              {/* Review F2 — same honest notice as NewIdeaBox: a prefill the
                  roster does not know is surfaced, never silently submitted. */}
              {unknownPrefill && (
                <div data-unknown-project={unknownPrefill} style={{ color: 'var(--red, #f87171)', fontSize: 12, marginBottom: 8 }}>
                  Project &quot;{unknownPrefill}&quot; is not in the roster — pick a real project below (or onboard it first).
                </div>
              )}
              {/* W7-B6 (sessions-kinds-02): a SELECT over the roster ids the
                  page already fetched — free text minted phantom
                  projects/<typo>/ dirs (the server now 404s unknowns too). */}
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
                data-field="kickoff-project"
                style={inputStyle}
              >
                <option value="">select a project…</option>
                {knownProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name === p.id ? p.id : `${p.name} (${p.id})`}
                  </option>
                ))}
              </select>
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
        {...(kickoffDisabledReason ? { 'data-disabled-reason': kickoffDisabledReason, title: kickoffDisabledReason } : {})}
        style={{ opacity: canSubmit ? 1 : 0.5 }}
      >
        {submitting ? 'Starting…' : hasExisting ? (confirmingAnother ? 'Yes, start another' : 'Start another session') : 'Start session'}
      </button>
      {/* W7-B6 (crosscut-25): the disabled primary CTA explains itself, like
          the create surfaces that already did. */}
      {kickoffDisabledReason && (
        <span data-section="start-session-hint" style={{ marginLeft: 10, fontSize: 11.5, color: 'var(--faint)' }}>
          {kickoffDisabledReason}
        </span>
      )}
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
const monoInline: React.CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--dim)' };
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg)', color: 'var(--text)',
  border: '1px solid var(--line)', borderRadius: 6, padding: '8px 10px', fontSize: 13,
};
