'use client';

/**
 * Agent builder page — /agents/[id]
 *
 * [id] param is the agent slug (or "new" for a new agent).
 * 3-column workbench: CatalogPalette | Agent definition | Preview+Readiness+Flows
 *
 * Load/save translation (schema reconciliation):
 *   Server AgentDefinition: composition.{skills,tools,mcps,guards} + body
 *   UI flat state: skills/tools/mcps/guards arrays + process (= body)
 *   On load: server composition.* → flat arrays; body → process
 *   On save: flat → PUT {composition:{...}, process, name, purpose, interactivity, brainAccess, runtime}
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { StudioNav } from '@/components/StudioNav';
import { NotFound } from '@/components/NotFound';
import { PageLoadError } from '@/components/PageLoadError';
import { fetchErrorPropsFrom } from '@/components/FetchErrorState';
import { useBridgeRecoveryWhenFailed } from '@/lib/use-bridge-status';
import { SaveStatus } from '@/components/SaveStatus';
import { useSaveState } from '@/lib/useSaveState';
import { CatalogPalette } from '@/components/studio/agent-builder/CatalogPalette';
import { DropZone } from '@/components/studio/agent-builder/DropZone';
import { RuntimePicker } from '@/components/studio/agent-builder/RuntimePicker';
import { ReadinessPanel } from '@/components/studio/agent-builder/ReadinessPanel';
import { YamlPreview } from '@/components/studio/agent-builder/YamlPreview';
import { UsedInFlows } from '@/components/studio/agent-builder/UsedInFlows';
import { RunPanel } from '@/components/studio/agent-builder/RunPanel';
import { StarterPicker } from '@/components/studio/agent-builder/StarterPicker';
import { ZoneWrap } from '@/components/studio/agent-builder/ZoneWrap';
import { ReadOnlyFields } from '@/components/studio/agent-builder/ReadOnlyFields';
import { InstructionsField } from '@/components/studio/agent-builder/InstructionsField';
import { MaterialsPicker } from '@/components/studio/agent-builder/MaterialsPicker';
import { HistoryLedger } from '@/components/studio/HistoryLedger';
import {
  fetchStudioAgentsWithMeta,
  fetchStudioCatalog,
  fetchStudioFlows,
  fetchStarters,
  fetchStudioProjects,
  fetchStandingTriggers,
  saveAgent,
  requestInstructionsDraft,
  type Agent,
  type AgentCapabilityDescriptor,
  type AgentRuntime,
  type Catalog,
  type Flow,
  type Project,
} from '@/lib/studio-client';
import type { StandingTrigger } from '@/lib/standing-triggers';
import { fetchConnections, type ConnectionWire } from '@/lib/connection-client';
import { unreadyBoundConnections, blockedRunMessage, type BoundConnectionRef } from '@/lib/connection-library-view';
import { fetchAgentHistory, type AgentHistoryResolution } from '@/lib/agent-ledger';
import {
  toggleMaterial,
  applyInstructionsDraft,
  clearInstructionsDraftFlag,
  editInstructionsText,
  addChip,
} from '@/lib/agent-builder-view';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Kind = 'skill' | 'tool' | 'mcp' | 'guard' | 'hook';

type AgentState = {
  slug: string;
  name: string;
  purpose: string;
  skills: string[];
  tools: string[];
  mcps: string[];
  guards: string[];
  // Library hook ids this agent carries (R3-03-F4) — distinct vocabulary
  // from guards; binding happens ONLY here in the Agent Builder.
  hooks: string[];
  process: string;
  interactivity: string;
  runtime: AgentRuntime;
  brainAccess: string;
  // R2-09 D1/D2/C4 — the closed upload-kind vocabulary this agent accepts
  // (MATERIAL_KINDS). Surfaced on the agent's kickoff screen; ENFORCEMENT
  // happens at R6-04-F2's upload seam, not here — this UI only declares.
  materials: string[];
  // read-only (SKILL.md-authored, not editable in M2)
  allowedTools: string[];
  disallowedTools: string[];
  phase: string;
  // R2-02-F4: server-computed F1 capability descriptor, carried through
  // as-is (never re-derived client-side) — undefined only for a genuinely
  // blank agent, before the first load/save round-trip. A starter-picked
  // agent DOES carry a capability (applyStarter → parseAgent(starter),
  // fed by the /api/studio/starters threading).
  capability?: AgentCapabilityDescriptor;
  // R6-04 WI-3: server-computed FACT, threaded through as-is (never
  // re-derived client-side) — see Agent.costCeilingEnforceable's own doc
  // comment in studio-client.ts for why it rides as its own top-level field
  // rather than inside `capability` (parseCapability's return shape is
  // pinned byte-for-byte by existing studio-client.test.ts assertions).
  costCeilingEnforceable: boolean;
  /** W7-B5 (agents-21): the agent's own declared default ceiling
   *  (SKILL budgets.maxBudgetUsd) — seeds the Run panel's field ahead of
   *  the run-level policy default. */
  declaredMaxBudgetUsd?: number;
};

const DEFAULT_RUNTIME: AgentRuntime = {
  sdk: 'sdk-claude',
  strategy: 'fixed',
  model: null,
  range: [],
};

const EMPTY_STATE: AgentState = {
  slug: '',
  name: '',
  purpose: '',
  skills: [],
  tools: [],
  mcps: [],
  guards: [],
  hooks: [],
  process: '',
  interactivity: '',
  runtime: { ...DEFAULT_RUNTIME },
  brainAccess: 'none',
  materials: [],
  allowedTools: [],
  disallowedTools: [],
  phase: '',
  costCeilingEnforceable: false,
};

// A "Blank" agent still ships sensible defaults so it is creatable with near-zero
// input (UX spec §2 — defaults over choices): a default model + the event-log
// guard means a blank agent passes validation without opening Advanced.
const BLANK_STATE: AgentState = {
  ...EMPTY_STATE,
  guards: ['event-log'],
  runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', range: [] },
  brainAccess: 'none',
  // A2: a sensible, editable starting point for interactivity — not a blank box.
  interactivity: 'Autonomous — runs to completion without human input.',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * R6-04 WI-3 — resolve an interactive agent's real session ENTRY point (a
 * route reachable from THIS page, i.e. one that does not itself require an
 * already-existing sessionId/cycleId — a kickoff has none yet). Measured
 * against the actual forge-ui route tree (2026-08-07), NOT assumed uniform:
 * of every "own session page" surface (`/architect/[sessionId]`,
 * `/instructions/[sessionId]`, `/project-brain/[sessionId]`,
 * `/demo/[sessionId]`, `/reflect/[cycleId]`, `/review/[cycleId]`,
 * `/sessions/[kind]/[sessionId]`), only `architect` also ships a static
 * "start new" page (`/architect/new`) that needs no pre-existing session id.
 * Every other one is reachable only via a session/cycle id minted by SOME
 * OTHER flow (onboarding start, a cycle's own lifecycle) — there is no
 * generic "start a new one from here" page for those today, so this table
 * has exactly one real entry. (`architect` itself is never actually
 * `capability.interactive: true` — R2-01-F2's `executionPathForSurface`
 * resolves it via the flow gate table, not this generic mechanism — so in
 * the CURRENT roster this table is not yet exercised in practice; it is
 * wired for the day a `surface: interactive` agent with `library !== false`
 * and a `runtime` block actually joins the dispatchable roster.)
 *
 * Deliberately NOT a "smart" per-agent-kind heuristic: a wrong guess here
 * would render a fabricated href to a route that doesn't exist (the exact
 * failure mode the task brief calls out, and a dead-paths gate finding).
 * Absent from this table (or any slug not present) ⇒ `null` ⇒ RunPanel
 * renders the explicit `data-component="session-entry-missing"` state.
 */
const SESSION_ENTRY_HREF_BY_SLUG: Readonly<Record<string, string>> = Object.freeze({
  architect: '/architect/new',
});

function sessionEntryHrefForAgent(slug: string): string | null {
  return SESSION_ENTRY_HREF_BY_SLUG[slug] ?? null;
}

function parseAgent(raw: Agent): AgentState {
  // Server uses composition.* + body; the client Agent type already mirrors
  // the flat shape (the GET /api/studio/agents endpoint denormalises it).
  const rt = raw.runtime ?? { ...DEFAULT_RUNTIME };
  return {
    slug:           raw.id ?? '',
    name:           raw.name ?? '',
    purpose:        raw.purpose ?? '',
    skills:         (raw.skills ?? []).slice(),
    tools:          (raw.tools ?? []).slice(),
    mcps:           (raw.mcps ?? []).slice(),
    guards:         (raw.guards ?? []).slice(),
    hooks:          (raw.hooks ?? []).slice(),
    process:        raw.process ?? '',
    interactivity:  raw.interactivity ?? '',
    runtime: {
      sdk:           rt.sdk           ?? 'sdk-claude',
      strategy:      rt.strategy      ?? 'fixed',
      model:         rt.model         ?? null,
      range:         (rt.range        ?? []).slice(),
      // R4-01-F2: loopStrategy is load-bearing declared dispatch (ADR-039) —
      // dropping it here made the picker misrender migrated agents and the
      // PUT round-trip depend on the server's existing-value fallback.
      loopStrategy:  rt.loopStrategy,
    },
    brainAccess:    raw.brainAccess   ?? 'none',
    // R2-09 C4: absent/malformed on the wire (parseMaterials's own
    // undefined) degrades to "nothing declared yet" in the EDITABLE state —
    // the toggle set needs a concrete array to render, and starting from
    // empty is the honest "no material accepted" starting point, never a
    // fabricated "accepts everything". Save always sends the concrete
    // (possibly still-empty) array back — see buildPutBody below.
    materials:      raw.materials ?? [],
    allowedTools:   ((raw as Record<string, unknown>).allowedTools  as string[] | undefined) ?? [],
    disallowedTools:((raw as Record<string, unknown>).disallowedTools as string[] | undefined) ?? [],
    phase:          raw.phase ?? '',
    capability:     raw.capability,
    costCeilingEnforceable: raw.costCeilingEnforceable === true,
    declaredMaxBudgetUsd: raw.declaredMaxBudgetUsd,
  };
}

function buildPutBody(state: AgentState): Record<string, unknown> {
  return {
    name:         state.name.trim(),
    purpose:      state.purpose,
    process:      state.process,       // server maps process → body
    interactivity: state.interactivity,
    brainAccess:  state.brainAccess,
    materials:    state.materials,
    composition: {
      skills: state.skills,
      tools:  state.tools,
      mcps:   state.mcps,
      guards: state.guards,
      hooks:  state.hooks,
    },
    runtime: {
      sdk:          state.runtime.sdk,
      strategy:     state.runtime.strategy,
      model:        state.runtime.model ?? undefined,
      range:        state.runtime.range,
      loopStrategy: state.runtime.loopStrategy,
    },
  };
}

// ---------------------------------------------------------------------------
// Toast state (simple in-component toast list)
// ---------------------------------------------------------------------------

type Toast = { id: number; msg: string; kind: 'ok' | 'err' | 'info' };
let _toastId = 0;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentBuilderPage() {
  const params  = useParams();
  const router  = useRouter();
  const slugParam = (params?.id as string) ?? 'new';
  const isNew   = slugParam === 'new';

  const [agents,  setAgents]  = useState<Agent[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({});
  const [flows,   setFlows]   = useState<Flow[]>([]);
  const [starters, setStarters] = useState<Agent[]>([]);
  // R6-04 WI-3: the real managed-project list (drives RunPanel's project
  // `<select>`, replacing the old free-text input) and the run-level
  // default cost ceiling (GET /api/studio/agents' top-level sibling field,
  // never a literal in RunPanel.tsx).
  const [projects, setProjects] = useState<Project[]>([]);
  const [defaultCostCeilingUsd, setDefaultCostCeilingUsd] = useState(0);
  // R6-01 WI-4: every standing trigger declared across the flow roster
  // (GET /api/triggers), fetched ONCE and threaded to RunPanel whole. The
  // roster is agent-independent, so it rides in the same load() as flows /
  // projects / catalog rather than being re-fetched per agent; the filter to
  // "targets THIS agent" lives in StandingTriggers.tsx, never here.
  const [standingTriggers, setStandingTriggers] = useState<StandingTrigger[]>([]);
  const [state,   setState]   = useState<AgentState>({ ...EMPTY_STATE });
  const [dirty,   setDirty]   = useState(false);
  const [ready,   setReady]   = useState(false);
  // W7-A4 (crosscut-02 / agents-10): an unknown slug is a NOT-FOUND state, never
  // a silent redirect into the blank /agents/new builder. Since W7-A1 the
  // roster read fails CLOSED (`fetchStudioAgentsWithMeta` throws), so a
  // roster that came back — even empty — is a real answer: the slug is
  // either in it (`found`) or not (`not-found`).
  const [slugResolution, setSlugResolution] = useState<'pending' | 'found' | 'not-found'>('pending');
  // W7-FIX-A1 (A1-01): a FAILED roster/catalog read is a third operator fact
  // — neither "found" nor "not found". It renders the shared PageLoadError
  // (never a blank builder for a real agent, never NotFound); `loadKey`
  // re-runs the load on Retry + bridge recovery.
  const [loadError, setLoadError] = useState<{ error: string; status?: number } | null>(null);
  const [loadKey, setLoadKey] = useState(0);
  const reload = useCallback(() => setLoadKey((k) => k + 1), []);
  // Recovery refills ONLY a failed load — never re-loads over the operator's
  // unsaved builder edits (W7-FIX-A1 review: `load()` overwrites the form).
  useBridgeRecoveryWhenFailed(loadError !== null, reload);
  const [toasts,  setToasts]  = useState<Toast[]>([]);
  // R3-04-F3: real probe-derived connections library, fetched independently
  // of the agent load (it's the same catalog regardless of which agent is
  // open). `connectionsStatus` stays 'loading' until the real fetch
  // resolves — the readiness/run-block wiring below treats "not yet loaded"
  // as distinct from "loaded, zero bound connections" (declared-data-
  // fails-open: never fabricate readiness from data that hasn't arrived).
  const [connections, setConnections] = useState<ConnectionWire[]>([]);
  const [connectionsStatus, setConnectionsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // R6-06 WI-3: this agent's own run-history ledger — an independent fetch,
  // same idiom as the connections effect above (own useEffect, own cancelled
  // flag), but keyed on the ROUTE's slug (see the effect below) rather than
  // fired once, since the ledger is per-agent and must refetch on every
  // agent switch. `null` means "not yet resolved" — kept DISTINCT from all
  // three of fetchAgentHistory's own resolution kinds (found/not-found/
  // unresolved) so a still-in-flight fetch never renders as any of them.
  const [historyResolution, setHistoryResolution] = useState<AgentHistoryResolution | null>(null);
  // For a new agent: the user first picks a starter (or "blank"); only then is
  // the builder revealed. Existing agents skip the picker (chosen = true).
  const [starterChosen, setStarterChosen] = useState(false);
  // Advanced config (capabilities, runtime, read-only) is collapsed by default
  // (UX spec §2 — progressive disclosure). Pre-filled from the chosen starter.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // C3/D9: true from the moment a generated instructions draft is applied
  // until the next successful save or Discard — persists across further
  // manual edits to the (still draft-derived) text. Ephemeral client state,
  // never sent to the server.
  const [instructionsIsDraft, setInstructionsIsDraft] = useState(false);
  const [draftPending, setDraftPending] = useState(false);

  // track the last loaded slug so we know when slugParam changes
  const loadedSlug = useRef<string>('');

  // ---- helpers ----
  function pushToast(msg: string, kind: Toast['kind'] = 'info') {
    const id = ++_toastId;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  function markDirty() { setDirty(true); }

  function patchState(patch: Partial<AgentState>) {
    setState((s) => ({ ...s, ...patch }));
    markDirty();
  }

  // ---- starter picker ----
  function applyStarter(starter: Agent) {
    // Pre-fill the builder from a curated starter; the operator only needs to
    // tweak the name/process before saving. Slug clears so save derives a fresh
    // one from the (editable) name rather than colliding with the template id.
    setState({ ...parseAgent(starter), slug: '' });
    setStarterChosen(true);
    setAdvancedOpen(false);
    setDirty(true);
  }

  function applyBlank() {
    setState({ ...BLANK_STATE });
    setStarterChosen(true);
    setAdvancedOpen(false);
    setDirty(true);
  }

  // ---- composition helpers ----
  function addToZone(kind: Kind, id: string) {
    const key = kind === 'mcp' ? 'mcps' : `${kind}s` as keyof AgentState;
    // addChip (agent-builder-view.ts) is the single-sourced idempotent-add
    // rule — matches DropZone.tsx's drag-drop guard so click-to-add (C2) and
    // drag-and-drop can never disagree about whether a chip is already bound.
    setState((s) => ({ ...s, [key]: addChip(s[key] as string[], id) }));
    markDirty();
  }

  function removeFromZone(kind: Kind, id: string) {
    const key = kind === 'mcp' ? 'mcps' : `${kind}s` as keyof AgentState;
    setState((s) => ({ ...s, [key]: (s[key] as string[]).filter((x) => x !== id) }));
    markDirty();
  }

  // ---- materials (C4) ----
  function toggleMaterialInState(kind: string) {
    setState((s) => ({ ...s, materials: toggleMaterial(s.materials, kind) }));
    markDirty();
  }

  // ---- instructions draft assist (C3, D9: never auto-saved) ----
  async function handleGenerateInstructions() {
    // A brand-new, not-yet-saved agent has no SKILL.md on disk yet — the
    // instructions-draft route 404s on an unknown slug (it only composes
    // from the POST body, but still confirms the agent exists as a D9
    // safety check). Fail fast with an honest, actionable message rather
    // than firing a request known to fail.
    if (!state.slug) {
      pushToast('Save the agent once before generating an instructions draft.', 'err');
      return;
    }
    setDraftPending(true);
    try {
      const result = await requestInstructionsDraft(state.slug, buildPutBody(state));
      if (!result.ok) {
        pushToast(result.error, 'err');
        return;
      }
      const next = applyInstructionsDraft(
        { instructions: state.process, dirty, instructionsIsDraft },
        result.draft,
      );
      setState((s) => ({ ...s, process: next.instructions }));
      setDirty(next.dirty);
      setInstructionsIsDraft(next.instructionsIsDraft);
    } finally {
      setDraftPending(false);
    }
  }

  function handleInstructionsEdit(text: string) {
    const next = editInstructionsText({ instructions: state.process, dirty }, text);
    setState((s) => ({ ...s, process: next.instructions }));
    setDirty(next.dirty);
    // instructionsIsDraft deliberately untouched — a manual edit does not
    // clear the draft-provenance flag (see agent-builder-view.ts header).
  }

  // ---- data loading ----
  useEffect(() => {
    const signal = { cancelled: false };
    setSlugResolution('pending');

    async function load() {
      try {
        const [agentsMeta, c, f, s, p, tr] = await Promise.all([
          fetchStudioAgentsWithMeta(),
          fetchStudioCatalog(),
          fetchStudioFlows(),
          fetchStarters(),
          fetchStudioProjects(),
          fetchStandingTriggers(),
        ]);
        if (signal.cancelled) return;
        const a = agentsMeta.agents;
        setAgents(a);
        setCatalog(c);
        setFlows(f);
        setStarters(s);
        setProjects(p);
        setStandingTriggers(tr);
        setDefaultCostCeilingUsd(agentsMeta.defaultCostCeilingUsd);

        // load the agent for this slug
        if (!isNew) {
          const found = a.find((ag) => ag.id === slugParam);
          if (found) {
            setState(parseAgent(found));
            setStarterChosen(true); // existing agent → skip the picker
            loadedSlug.current = slugParam;
            setSlugResolution('found');
          } else {
            // W7-A4: unknown slug → the shared NotFound (rendered below), never
            // a redirect into the blank builder — the builder is reserved for
            // the literal `new` slug.
            setSlugResolution('not-found');
          }
        } else {
          setSlugResolution('found');
          setState({ ...EMPTY_STATE });
          setStarterChosen(false); // new agent → show the starter picker first
          setAdvancedOpen(false);
          loadedSlug.current = 'new';
        }
        setDirty(false);
        setLoadError(null);
      } catch (err) {
        // W7-FIX-A1 (A1-01): the roster/catalog read threw (fail-closed reads)
        // — an ERROR state, rendered as PageLoadError below. `slugResolution`
        // stays 'pending' (nothing was resolved), so neither the builder nor
        // NotFound can render off this failure.
        if (signal.cancelled) return;
        setLoadError(fetchErrorPropsFrom(err));
      } finally {
        if (!signal.cancelled) setReady(true);
      }
    }
    void load();
    return () => { signal.cancelled = true; };
    // slugParam drives reload (loadKey = Retry / bridge recovery), router is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugParam, loadKey]);

  // R3-04-F3: independent connections fetch (see state declaration above) —
  // the connections library doesn't depend on which agent is open, so this
  // is a separate, run-once effect rather than folded into the load() above.
  useEffect(() => {
    let cancelled = false;
    async function loadConnections() {
      const r = await fetchConnections();
      if (cancelled) return;
      if (!r.ok) {
        setConnectionsStatus('error');
        return;
      }
      setConnections(r.connections);
      setConnectionsStatus('ready');
    }
    void loadConnections();
    return () => { cancelled = true; };
  }, []);

  // R6-06 WI-3: independent per-agent history fetch, keyed on the route's own
  // `slugParam` (the same dependency the primary load() effect above uses) so
  // switching agents — via the selector or a direct route change — re-fetches
  // THIS agent's own history, never leaves the previous agent's rows showing.
  // A brand-new, not-yet-saved agent (`isNew`) has no persisted slug to have
  // history for, so this effect deliberately does not fire for it —
  // `historyResolution` stays `null` and the section is omitted entirely
  // (never a fabricated "not-found" against a slug that isn't real yet).
  useEffect(() => {
    let cancelled = false;
    setHistoryResolution(null);
    if (isNew) return () => { cancelled = true; };
    async function loadHistory() {
      const res = await fetchAgentHistory(slugParam);
      if (cancelled) return;
      setHistoryResolution(res);
    }
    void loadHistory();
    return () => { cancelled = true; };
  }, [slugParam, isNew]);

  // ---- agent selector change (with dirty guard) ----
  function handleSelectAgent(newSlug: string) {
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
    router.push(`/agents/${encodeURIComponent(newSlug)}`);
  }

  // ---- save (unified feedback via useSaveState / SaveStatus) ----
  const { saving, save: handleSave, ...saveFb } = useSaveState(async () => {
    if (!state.name.trim()) return { ok: false, error: 'Agent name is required.' };
    const slug = isNew
      ? state.name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      : state.slug;
    const result = await saveAgent(slug, buildPutBody(state));
    if (!result.ok) {
      // Surface detailed validation findings as toasts; the inline SaveStatus
      // shows the top-level error.
      if (result.findings && (result.findings as unknown[]).length > 0) {
        (result.findings as Array<{ message?: string }>).forEach((f) => {
          if (f.message) pushToast(f.message, 'err');
        });
      }
      return { ok: false, error: result.error ?? 'Save failed.' };
    }
    setDirty(false);
    // C3/D9: a successful save confirms whatever text is in the field —
    // draft-derived or not — so the "unconfirmed draft" flag clears here.
    setInstructionsIsDraft((prev) => clearInstructionsDraftFlag({ instructionsIsDraft: prev }).instructionsIsDraft);
    if (isNew) router.replace(`/agents/${encodeURIComponent(slug)}`);
    return { ok: true };
  });

  // ---- discard ----
  function handleDiscard() {
    const found = agents.find((ag) => ag.id === (isNew ? '' : state.slug));
    if (found) {
      setState(parseAgent(found));
    } else {
      setState({ ...EMPTY_STATE });
    }
    setDirty(false);
    // C3/D9: discarding replaces the instructions text with the last-loaded
    // (or blank) value, so any pending draft's provenance no longer applies.
    setInstructionsIsDraft((prev) => clearInstructionsDraftFlag({ instructionsIsDraft: prev }).instructionsIsDraft);
  }

  // ---- used ids (for palette dimming) ----
  const usedIds = [...state.skills, ...state.tools, ...state.mcps, ...state.guards, ...state.hooks];

  // ---- readiness check inputs ----
  // R2-02-F4: `capability` (the runtime-SDK + interactive facts) is the
  // server-computed F1 descriptor, threaded through verbatim — NOT
  // re-derived from `state.runtime` here (that client re-derivation was the
  // "hardcoded heuristic" the AC replaces). See forge-ui/lib/agent-readiness.ts.
  //
  // R3-04-F3: `connectionsUnready` — this agent's bound tools/mcps that are
  // NOT real probe-`available`, computed from the independently-fetched
  // connections library. Left undefined while that fetch hasn't resolved
  // (or failed) — omitted, never fabricated as ready (see the effect above
  // + agent-readiness.ts's module header for the declared-data-fails-open
  // rationale).
  const boundConnections: BoundConnectionRef[] = [
    ...state.tools.map((id) => ({ id, kind: 'tool' as const })),
    ...state.mcps.map((id) => ({ id, kind: 'mcp' as const })),
  ];
  // The connections check is appended ONLY for an agent that actually binds a
  // tool or MCP. An agent that binds none has nothing to be ready about, and a
  // seventh check that always passes is noise that would also silently redefine
  // the six-check contract every other agent surface (and the agents journey)
  // relies on. Absent while the fetch is unresolved, too — omitted, never
  // fabricated as ready; the Run control carries the "not known yet" block in
  // that window.
  const connectionsUnready =
    boundConnections.length > 0 && connectionsStatus === 'ready'
      ? unreadyBoundConnections(boundConnections, connections)
      : undefined;
  // While the connections fetch is unresolved we do NOT know whether a bound
  // connection is ready — so an agent that binds one must not read as runnable
  // in that window. Saying "unknown" is honest; saying "ready" is an overclaim
  // that the bridge would then refuse with a 409 anyway (adversarial review
  // round 2, MINOR-3). An agent binding nothing is unaffected: there is nothing
  // to be unsure about.
  const runBlockMessage = connectionsUnready
    ? blockedRunMessage(connectionsUnready)
    : boundConnections.length > 0
      ? `connection readiness is not known yet — ${boundConnections.length} bound connection(s) have not been probed in this session`
      : '';

  const readinessState = {
    purpose:       state.purpose,
    skills:        state.skills,
    guards:        state.guards,
    process:       state.process,
    interactivity: state.interactivity,
    capability:    state.capability,
    connectionsUnready,
  };

  // R6-06 WI-3 — D2/D3: `found` and `not-found` both render through the
  // shared `HistoryLedger` (rows=[] for not-found is the component's own
  // honest `[data-component="history-ledger-empty"]`, never fabricated
  // rows). `unresolved` (a failed/unreachable fetch) is a DIFFERENT operator
  // fact — rendered separately below, never collapsed into this same empty
  // ledger (that collapse is the filed defect class this WI must not
  // reproduce).
  const historyRows = historyResolution?.kind === 'found' ? historyResolution.rows : [];

  // ---- render ----
  // W7-A4 (crosscut-02 / agents-10 / crosscut-27): unknown slug → the ONE
  // shared not-found treatment with a way back to the roster.
  // W7-FIX-A1 (A1-01): the read FAILED — the agent may well exist. Neither
  // the builder (blank) nor NotFound; the shared page-level error with Retry.
  // Applies to `new` too: the builder's palette is the catalog read.
  if (ready && loadError) {
    return (
      <PageLoadError
        page="agents"
        rootAttrs={{ 'data-agent-id': isNew ? '' : slugParam }}
        what={isNew ? 'the agent builder catalog' : `agent "${slugParam}"`}
        error={loadError.error}
        status={loadError.status}
        onRetry={reload}
        backHref="/agents"
        backLabel="Agents"
      />
    );
  }
  if (ready && !isNew && slugResolution === 'not-found') {
    return <NotFound kind="agent" id={slugParam} backHref="/agents" backLabel="Agents" />;
  }

  return (
    <div
      data-page="agents"
      data-page-ready={ready ? 'true' : 'false'}
      data-agent-id={state.slug}
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg)' }}
    >
      <StudioNav />

      <div className="workbench">

        {/* ══ LEFT: Component Library ══ */}
        <CatalogPalette catalog={catalog} usedIds={usedIds} onAddToZone={addToZone} />

        {/* ══ CENTER: Agent Definition ══ */}
        <main
          className="col-center"
          id="col-center"
          data-agent-id={state.slug}
          data-dirty={dirty ? 'true' : 'false'}
        >

          {/* Agent header */}
          <div className="agent-header">
            <div className="row">
              {/* Agent selector */}
              <div className="agent-select-wrap">
                <select
                  title="Switch agent"
                  data-agent-select
                  value={isNew ? '__new__' : state.slug}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__new__') handleSelectAgent('new');
                    else handleSelectAgent(v);
                  }}
                >
                  <option value="__new__" data-agent-option="new">— new agent —</option>
                  {agents.map((ag) => (
                    <option key={ag.id} value={ag.id} data-agent-option={ag.id}>{ag.name}</option>
                  ))}
                </select>
              </div>

              {/* Name + hex glyph */}
              <div className="agent-name-wrap">
                <div className="hex-glyph" aria-hidden />
                <input
                  className="agent-name-input"
                  type="text"
                  placeholder="Agent name…"
                  spellCheck={false}
                  value={state.name}
                  onChange={(e) => patchState({ name: e.target.value })}
                />
                <span className="dirty-badge" aria-live="polite">unsaved</span>
              </div>
            </div>
          </div>

          {/* New agent → pick a starter first (or start blank) */}
          {isNew && !starterChosen ? (
            <StarterPicker starters={starters} onPick={applyStarter} onBlank={applyBlank} />
          ) : (
          <>
          {isNew && (
            <div className="new-agent-banner visible">
              Starter applied. Fill in the essentials below — name, purpose, process — then click{' '}
              <strong>Save agent</strong>. Everything else has a working default under{' '}
              <strong>Advanced</strong>.
            </div>
          )}

          <div className="agent-body">

            {/* Purpose (required) */}
            <div className="field-group">
              <label className="field-label" htmlFor="purpose-input">Purpose</label>
              <input
                id="purpose-input"
                className="input"
                type="text"
                placeholder="What does this agent exist to accomplish?"
                value={state.purpose}
                onChange={(e) => patchState({ purpose: e.target.value })}
              />
            </div>

            {/* Instructions (required) — the agent's instruction file (A3),
                plus the generation-assist affordance (C3). */}
            <InstructionsField
              value={state.process}
              isDraft={instructionsIsDraft}
              pending={draftPending}
              canGenerate={Boolean(state.slug)}
              onGenerate={() => void handleGenerateInstructions()}
              onChange={handleInstructionsEdit}
            />

            {/* Interactivity (required) */}
            <div className="field-group">
              <label className="field-label" htmlFor="interactivity-input">Human Interactivity</label>
              <textarea
                id="interactivity-input"
                className="input"
                rows={2}
                placeholder={`e.g. "Autonomous; a human verdict gate decides approve or send-back."`}
                value={state.interactivity}
                onChange={(e) => patchState({ interactivity: e.target.value })}
              />
            </div>

            {/* Allowed input materials (C4) — the closed upload-kind vocabulary
                this agent declares it accepts. Surfaced on the agent's kickoff
                screen; ENFORCEMENT happens at R6-04-F2's upload seam, not here. */}
            <MaterialsPicker materials={state.materials} onToggle={toggleMaterialInState} />

            {/* ── Advanced (progressive disclosure) ── */}
            <details
              data-section="advanced"
              data-advanced-open={advancedOpen ? 'true' : 'false'}
              open={advancedOpen}
              onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
              className="field-group"
              style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', padding: '12px 14px' }}
            >
              <summary data-action="toggle-advanced" style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--dim)' }}>
                Advanced — capabilities, runtime &amp; model
              </summary>

              <div style={{ marginTop: 14 }}>
                {/* Drop zones 2×2 */}
                <div>
                  <label className="field-label" style={{ marginBottom: 10 }}>
                    Capabilities &amp; Constraints
                  </label>
                  <div className="zones-grid">
                    {(['skill', 'tool', 'mcp', 'guard', 'hook'] as Kind[]).map((kind) => (
                      <ZoneWrap key={kind} kind={kind}>
                        <DropZone
                          kind={kind}
                          ids={kind === 'mcp' ? state.mcps : state[`${kind}s` as keyof AgentState] as string[]}
                          catalog={catalog}
                          onAdd={(id) => addToZone(kind, id)}
                          onRemove={(id) => removeFromZone(kind, id)}
                          onReject={(msg) => pushToast(msg, 'err')}
                        />
                      </ZoneWrap>
                    ))}
                  </div>
                </div>

                {/* Runtime (SDK + strategy + models + brain access) */}
                <RuntimePicker
                  runtime={state.runtime}
                  brainAccess={state.brainAccess}
                  catalog={catalog}
                  onRuntimeChange={(rt) => patchState({ runtime: rt })}
                  onBrainAccessChange={(v) => patchState({ brainAccess: v })}
                  onToast={(msg) => pushToast(msg)}
                />

                {/* Read-only fields (SKILL.md-authored) */}
                <ReadOnlyFields
                  phase={state.phase}
                  allowedTools={state.allowedTools}
                />
              </div>
            </details>

          </div>{/* /.agent-body */}

          {/* Save bar */}
          <div className="save-bar">
            <button
              className="btn btn-primary"
              id="btn-save"
              data-action="save-agent"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save agent'}
            </button>
            <button className="btn btn-ghost" id="btn-discard" onClick={handleDiscard}>
              Discard
            </button>
            <SaveStatus {...saveFb} saving={saving} />
            <span className="spacer" />
            {dirty
              ? <span className="save-hint save-hint-dirty">Unsaved changes</span>
              : <span className="save-hint muted">All changes saved</span>
            }
          </div>
          </>
          )}

        </main>{/* /#col-center */}

        {/* ══ RIGHT: Preview + Readiness + Flows ══ */}
        <aside className="col-right" id="col-right">
          <YamlPreview
            slug={state.slug}
            name={state.name}
            purpose={state.purpose}
            skills={state.skills}
            tools={state.tools}
            mcps={state.mcps}
            guards={state.guards}
            hooks={state.hooks}
            materials={state.materials}
            process={state.process}
            interactivity={state.interactivity}
            runtime={state.runtime}
            brainAccess={state.brainAccess}
            catalog={catalog}
          />
          <ReadinessPanel state={readinessState} />
          {/* W7-B5 (agents-21/36): defaultCostCeilingUsd — the agent's OWN
              declared ceiling wins the seed slot, the run-level policy
              default is the fallback; standaloneBlockedReason — a
              ralph-loop agent cannot run standalone (the bridge refuses
              the dispatch), say so up front instead of minting a run that
              always fails; unreadyConnectionIds — link the blocked
              connections straight to /connections/<id>. */}
          <RunPanel
            slug={state.slug}
            interactive={state.capability?.interactive === true}
            canRun={!isNew && !dirty && state.slug.length > 0}
            blockedMessage={runBlockMessage}
            projects={projects}
            declaredMaterialKinds={state.materials}
            defaultCostCeilingUsd={state.declaredMaxBudgetUsd ?? defaultCostCeilingUsd}
            costCeilingEnforceable={state.costCeilingEnforceable}
            standaloneBlockedReason={state.runtime.loopStrategy === 'ralph'
              ? 'This agent is a multi-iteration (ralph) loop — it runs inside the develop flow, never as a standalone dispatch. Start it through its flow instead.'
              : null}
            unreadyConnectionIds={(connectionsUnready ?? []).map((c) => c.id)}
            sessionEntryHref={sessionEntryHrefForAgent(state.slug)}
            standingTriggers={standingTriggers}
          />
          <UsedInFlows agentSlug={state.slug} flows={flows} />

          {/* R6-06 WI-3 — this agent's own run-history ledger, joined across
              all three execution paths (flow-node / standalone / session) by
              the server route (GET /api/agents/:slug/history). A new,
              not-yet-saved agent has no persisted slug to have history for,
              so the whole section is omitted rather than showing a
              fabricated state for a slug that doesn't exist yet. */}
          {!isNew && historyResolution === null && (
            <div
              data-component="history-ledger-loading"
              className="muted"
              style={{ padding: '10px 20px', fontSize: 12, borderTop: '1px solid var(--line)' }}
            >
              Loading run history…
            </div>
          )}
          {!isNew && historyResolution?.kind === 'unresolved' && (
            <div
              data-component="history-ledger-unresolved"
              className="muted"
              style={{ padding: '10px 20px', fontSize: 12, borderTop: '1px solid var(--line)' }}
            >
              Could not load run history — try again shortly.
            </div>
          )}
          {/* W7-B5 (agents-32): paged + status-filterable instead of 77
              rows crammed into a 220px scroller with a mixed, unfiltered
              vocabulary. */}
          {!isNew && (historyResolution?.kind === 'found' || historyResolution?.kind === 'not-found') && (
            <HistoryLedger rows={historyRows} nowMs={Date.now()} pageSize={15} filterable />
          )}
        </aside>

      </div>{/* /.workbench */}

      {/* Toast host */}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
