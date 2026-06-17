'use client';

/**
 * Agent builder page — /agents/[id]
 *
 * [id] param is the agent slug (or "new" for a new agent).
 * 3-column workbench: CatalogPalette | Agent definition | Preview+Readiness+Flows
 *
 * Load/save translation (schema reconciliation):
 *   Server AgentDefinition: composition.{skills,tools,mcps,hooks} + body
 *   UI flat state: skills/tools/mcps/hooks arrays + process (= body)
 *   On load: server composition.* → flat arrays; body → process
 *   On save: flat → PUT {composition:{...}, process, name, purpose, interactivity, brainAccess, runtime}
 */

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { StudioNav } from '@/components/StudioNav';
import { SaveStatus } from '@/components/SaveStatus';
import { useSaveState } from '@/lib/useSaveState';
import { CatalogPalette } from '@/components/studio/agent-builder/CatalogPalette';
import { DropZone } from '@/components/studio/agent-builder/DropZone';
import { RuntimePicker } from '@/components/studio/agent-builder/RuntimePicker';
import { ReadinessPanel } from '@/components/studio/agent-builder/ReadinessPanel';
import { YamlPreview } from '@/components/studio/agent-builder/YamlPreview';
import { UsedInFlows } from '@/components/studio/agent-builder/UsedInFlows';
import {
  fetchStudioAgents,
  fetchStudioCatalog,
  fetchStudioFlows,
  fetchStarters,
  saveAgent,
  type Agent,
  type AgentRuntime,
  type Catalog,
  type Flow,
} from '@/lib/studio-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Kind = 'skill' | 'tool' | 'mcp' | 'hook';

type AgentState = {
  slug: string;
  name: string;
  purpose: string;
  skills: string[];
  tools: string[];
  mcps: string[];
  hooks: string[];
  process: string;
  interactivity: string;
  runtime: AgentRuntime;
  brainAccess: string;
  // read-only (SKILL.md-authored, not editable in M2)
  allowedTools: string[];
  disallowedTools: string[];
  phase: string;
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
  hooks: [],
  process: '',
  interactivity: '',
  runtime: { ...DEFAULT_RUNTIME },
  brainAccess: 'none',
  allowedTools: [],
  disallowedTools: [],
  phase: '',
};

// A "Blank" agent still ships sensible defaults so it is creatable with near-zero
// input (UX spec §2 — defaults over choices): a default model + the event-log
// hook means a blank agent passes validation without opening Advanced.
const BLANK_STATE: AgentState = {
  ...EMPTY_STATE,
  hooks: ['event-log'],
  runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', range: [] },
  brainAccess: 'none',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    hooks:          (raw.hooks ?? []).slice(),
    process:        raw.process ?? '',
    interactivity:  raw.interactivity ?? '',
    runtime: {
      sdk:           rt.sdk           ?? 'sdk-claude',
      strategy:      rt.strategy      ?? 'fixed',
      model:         rt.model         ?? null,
      range:         (rt.range        ?? []).slice(),
    },
    brainAccess:    raw.brainAccess   ?? 'none',
    allowedTools:   ((raw as Record<string, unknown>).allowedTools  as string[] | undefined) ?? [],
    disallowedTools:((raw as Record<string, unknown>).disallowedTools as string[] | undefined) ?? [],
    phase:          raw.phase ?? '',
  };
}

function buildPutBody(state: AgentState): Record<string, unknown> {
  return {
    name:         state.name.trim(),
    purpose:      state.purpose,
    process:      state.process,       // server maps process → body
    interactivity: state.interactivity,
    brainAccess:  state.brainAccess,
    composition: {
      skills: state.skills,
      tools:  state.tools,
      mcps:   state.mcps,
      hooks:  state.hooks,
    },
    runtime: {
      sdk:          state.runtime.sdk,
      strategy:     state.runtime.strategy,
      model:        state.runtime.model ?? undefined,
      range:        state.runtime.range,
    },
  };
}

function runtimeConfigured(rt: AgentRuntime): boolean {
  if (!rt.sdk) return false;
  return rt.strategy === 'fixed' ? !!rt.model : rt.range.length > 0;
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
  const [state,   setState]   = useState<AgentState>({ ...EMPTY_STATE });
  const [dirty,   setDirty]   = useState(false);
  const [ready,   setReady]   = useState(false);
  const [toasts,  setToasts]  = useState<Toast[]>([]);
  // For a new agent: the user first picks a starter (or "blank"); only then is
  // the builder revealed. Existing agents skip the picker (chosen = true).
  const [starterChosen, setStarterChosen] = useState(false);
  // Advanced config (capabilities, runtime, read-only) is collapsed by default
  // (UX spec §2 — progressive disclosure). Pre-filled from the chosen starter.
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
    setState((s) => {
      const arr = s[key] as string[];
      if (arr.includes(id)) return s;
      return { ...s, [key]: [...arr, id] };
    });
    markDirty();
  }

  function removeFromZone(kind: Kind, id: string) {
    const key = kind === 'mcp' ? 'mcps' : `${kind}s` as keyof AgentState;
    setState((s) => ({ ...s, [key]: (s[key] as string[]).filter((x) => x !== id) }));
    markDirty();
  }

  // ---- data loading ----
  useEffect(() => {
    const signal = { cancelled: false };

    async function load() {
      try {
        const [a, c, f, s] = await Promise.all([
          fetchStudioAgents(),
          fetchStudioCatalog(),
          fetchStudioFlows(),
          fetchStarters(),
        ]);
        if (signal.cancelled) return;
        setAgents(a);
        setCatalog(c);
        setFlows(f);
        setStarters(s);

        // load the agent for this slug
        if (!isNew) {
          const found = a.find((ag) => ag.id === slugParam);
          if (found) {
            setState(parseAgent(found));
            setStarterChosen(true); // existing agent → skip the picker
            loadedSlug.current = slugParam;
          } else {
            // unknown slug → redirect to /agents/new
            router.replace('/agents/new');
          }
        } else {
          setState({ ...EMPTY_STATE });
          setStarterChosen(false); // new agent → show the starter picker first
          setAdvancedOpen(false);
          loadedSlug.current = 'new';
        }
        setDirty(false);
      } finally {
        if (!signal.cancelled) setReady(true);
      }
    }

    void load();
    return () => { signal.cancelled = true; };
    // slugParam drives reload, router is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugParam]);

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
  }

  // ---- used ids (for palette dimming) ----
  const usedIds = [...state.skills, ...state.tools, ...state.mcps, ...state.hooks];

  // ---- readiness check inputs ----
  const readinessState = {
    purpose:           state.purpose,
    skills:            state.skills,
    hooks:             state.hooks,
    process:           state.process,
    interactivity:     state.interactivity,
    runtimeConfigured: runtimeConfigured(state.runtime),
  };

  // ---- render ----
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
        <CatalogPalette catalog={catalog} usedIds={usedIds} />

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
                  value={isNew ? '__new__' : state.slug}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__new__') handleSelectAgent('new');
                    else handleSelectAgent(v);
                  }}
                >
                  <option value="__new__">— new agent —</option>
                  {agents.map((ag) => (
                    <option key={ag.id} value={ag.id}>{ag.name}</option>
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

            {/* Process (required) */}
            <div className="field-group">
              <label className="field-label" htmlFor="process-input">Process</label>
              <textarea
                id="process-input"
                className="input"
                rows={4}
                placeholder="Describe the loop this agent runs — what it reads, what it decides, how it produces its output artifact."
                value={state.process}
                onChange={(e) => patchState({ process: e.target.value })}
              />
            </div>

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
                    {(['skill', 'tool', 'mcp', 'hook'] as Kind[]).map((kind) => (
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
                  disallowedTools={state.disallowedTools}
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
            hooks={state.hooks}
            process={state.process}
            interactivity={state.interactivity}
            runtime={state.runtime}
            brainAccess={state.brainAccess}
            catalog={catalog}
          />
          <ReadinessPanel state={readinessState} />
          <UsedInFlows agentSlug={state.slug} flows={flows} />
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

// ---------------------------------------------------------------------------
// StarterPicker — choose a curated starter (or start blank) for a new agent
// ---------------------------------------------------------------------------

function StarterPicker({
  starters,
  onPick,
  onBlank,
}: {
  starters: Agent[];
  onPick: (s: Agent) => void;
  onBlank: () => void;
}) {
  return (
    <div data-section="starter-picker" style={{ padding: '8px 2px' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
        Start from a starter
      </h2>
      <p style={{ fontSize: 13, color: 'var(--dim)', maxWidth: 520, lineHeight: 1.6, margin: '0 0 18px' }}>
        Pick a ready-made agent to begin. You can edit everything after — these just give you a
        clean, minimal starting point.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
        {starters.map((s) => (
          <button
            key={s.id}
            type="button"
            data-starter-option={s.id}
            onClick={() => onPick(s)}
            style={{
              textAlign: 'left',
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              padding: '16px 16px 14px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
              {s.name}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.5 }}>
              {s.purpose}
            </span>
          </button>
        ))}
        <button
          type="button"
          data-starter-option="blank"
          onClick={onBlank}
          style={{
            textAlign: 'left',
            background: 'transparent',
            border: '1px dashed var(--line)',
            borderRadius: 'var(--radius)',
            padding: '16px 16px 14px',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
            Blank agent
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--faint)', lineHeight: 1.5 }}>
            Start from scratch with sensible defaults.
          </span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ZoneWrap — label row + drop zone
// ---------------------------------------------------------------------------

const ZONE_META: Record<string, { dotKind: string; label: string; hint: string }> = {
  skill: { dotKind: 'skill', label: 'Skills',       hint: 'what it knows how to do' },
  tool:  { dotKind: 'tool',  label: 'Tools & CLIs', hint: 'external processes it can invoke' },
  mcp:   { dotKind: 'mcp',   label: 'MCP Servers',  hint: 'structured data + action access' },
  hook:  { dotKind: 'hook',  label: 'Hooks',         hint: 'guards, gates & observability' },
};

function ZoneWrap({ kind, children }: { kind: string; children: React.ReactNode }) {
  const meta = ZONE_META[kind];
  return (
    <div className="zone-wrap">
      <div className="zone-label-row">
        <span className="zone-kind-dot" data-kind={meta.dotKind} />
        <span className="field-label" style={{ margin: 0 }}>{meta.label}</span>
        <span className="zone-label-hint">{meta.hint}</span>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReadOnlyFields — SKILL.md-authored, not editable in M2
// ---------------------------------------------------------------------------

function ReadOnlyFields({
  phase,
  allowedTools,
  disallowedTools,
}: {
  phase: string;
  allowedTools: string[];
  disallowedTools: string[];
}) {
  if (!phase && allowedTools.length === 0 && disallowedTools.length === 0) return null;
  return (
    <div className="field-group" style={{ opacity: 0.6 }}>
      <div className="field-label" style={{ marginBottom: 8 }}>
        SKILL.md fields (read-only — edit in skills/&lt;slug&gt;/SKILL.md)
      </div>
      {phase && (
        <div style={{ marginBottom: 8 }}>
          <span className="field-label" style={{ fontSize: 10 }}>Phase</span>
          <div className="readonly-field">
            <span className="readonly-token">{phase}</span>
          </div>
        </div>
      )}
      {allowedTools.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <span className="field-label" style={{ fontSize: 10 }}>Allowed Tools</span>
          <div className="readonly-field">
            {allowedTools.map((t) => <span key={t} className="readonly-token">{t}</span>)}
          </div>
        </div>
      )}
      {disallowedTools.length > 0 && (
        <div>
          <span className="field-label" style={{ fontSize: 10 }}>Disallowed Tools</span>
          <div className="readonly-field">
            {disallowedTools.map((t) => <span key={t} className="readonly-token">{t}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
