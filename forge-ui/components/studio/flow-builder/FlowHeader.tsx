'use client';

/**
 * FlowHeader — the header strip above the canvas in the BUILD tab.
 * Contains:
 *   - Flow selector (dropdown of all flows)
 *   - Editable flow name input
 *   - Goal textarea + data-goal-set warning when empty
 *   - Project + KB selects
 *   - Trigger chips + kind selector (all 7 shipped kinds — flow-complete,
 *     agent-complete, merged, pr-merged, issue-raised, cron, webhook —
 *     R2-04-F4/forge-zyc) with per-kind fields, target-flow picker shared by all
 *   - Save button → calls onSave() (parent PUT); handles 423 edit-lock
 *
 * Props receive the current header state; parent owns the state (FlowBuilder).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  fetchStudioKbs,
  buildTriggerDeclaration,
  isValidCronSchedule,
  SHIPPED_TRIGGER_KINDS,
  WEBHOOK_FAMILY_TRIGGER_KINDS,
  WEBHOOK_PROVIDERS_BY_KIND,
  WEBHOOK_EVENTS_BY_KIND,
  isSameTriggerIdentity,
} from '@/lib/studio-client';
import type { Flow, Kb, FlowTrigger, ShippedTriggerKind, WebhookEventName } from '@/lib/studio-client';
import { SaveStatus } from '@/components/SaveStatus';
import { useSaveState } from '@/lib/useSaveState';

export type FlowHeaderState = {
  name: string;
  goal: string;
  project: string;
  kb: string;
  triggers: FlowTrigger[];
};

type Props = {
  /** The flow id being edited */
  flowId: string;
  /** Current header state (controlled) */
  state: FlowHeaderState;
  /** Called when any header field changes */
  onChange: (next: FlowHeaderState) => void;
  /** Current saved version */
  version?: number;
  /** Triggered by Save; parent provides nodes/edges to include in the PUT body */
  onSave: () => Promise<{ ok: boolean; version?: number; error?: string }>;
  /** All flows (for the flow selector) */
  flows: Flow[];
  /** Called when the user selects a different flow from the dropdown */
  onFlowSelect: (id: string) => void;
  /** True when authoring a brand-new (unsaved) flow */
  isNew?: boolean;
};

export function FlowHeader({
  flowId,
  state,
  onChange,
  version,
  onSave,
  flows,
  onFlowSelect,
  isNew = false,
}: Props): JSX.Element {
  const [kbs, setKbs] = useState<Kb[]>([]);

  // Load KBs (the flow's optional knowledge base). Projects bind at run-launch (B2).
  useEffect(() => {
    const signal = { cancelled: false };
    void (async () => {
      const ks = await fetchStudioKbs();
      if (!signal.cancelled) setKbs(ks);
    })();
    return () => { signal.cancelled = true; };
  }, []);

  const goalSet = state.goal.trim().length > 0;

  // Unified save feedback (X1) — the hook maps a 423/in-flight error to `locked`.
  const { saving, save: handleSave, ...saveFb } = useSaveState(onSave);

  // R2-04-F4/forge-zyc: the operator chooses a trigger kind (data-field=
  // "trigger-kind", all 7 SHIPPED_TRIGGER_KINDS — flow-complete,
  // agent-complete, merged, pr-merged, issue-raised, cron, webhook; the
  // registry-reserved kinds manual/feed are never offered) and a target flow
  // (data-field="trigger-target", shared by every kind — this closes the
  // "merged trigger unauthorable" gap). Per-kind extra fields (schedule/
  // concurrency, webhook block, agent-complete's agent slug) layer on top.
  const [triggerKind, setTriggerKind] = useState<ShippedTriggerKind>(SHIPPED_TRIGGER_KINDS[0]);
  const [triggerTarget, setTriggerTarget] = useState('');
  const [cronSchedule, setCronSchedule] = useState('');
  const [cronConcurrency, setCronConcurrency] = useState<'allow' | 'forbid'>('forbid');
  const [webhookId, setWebhookId] = useState('');
  const [webhookProvider, setWebhookProvider] = useState<'github' | 'gitea' | 'gitlab'>('github');
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventName[]>([]);
  const [webhookSecretEnv, setWebhookSecretEnv] = useState('');
  const [webhookSources, setWebhookSources] = useState('');
  const [agentSlug, setAgentSlug] = useState('');

  // Client-side only (UX) — orchestrator/studio/validate.ts's trigger-cron
  // check (same croner engine) is authoritative on save.
  const cronScheduleInvalid =
    triggerKind === 'cron' && cronSchedule.trim().length > 0 && !isValidCronSchedule(cronSchedule);

  const pendingTrigger = buildTriggerDeclaration(triggerKind, {
    targetId: triggerTarget,
    schedule: cronSchedule,
    concurrency: cronConcurrency,
    webhookId,
    webhookProvider,
    webhookEvents,
    webhookSecretEnv,
    webhookSources,
    agentSlug,
  });
  const canAddTrigger = pendingTrigger !== null && !cronScheduleInvalid;

  const addTrigger = useCallback(() => {
    if (!pendingTrigger || !canAddTrigger) return;
    // zyc review finding 2: dedup by trigger IDENTITY, not raw (on,target) —
    // an agent-complete row's identity also carries `agent` (two rows may
    // legitimately share a target with a DIFFERENT source agent; the server
    // fires each independently, orchestrator/flow-trigger.ts's
    // fireAgentCompleteTriggers). Every other kind stays (on,target)-only —
    // isSameTriggerIdentity is the ONE shared definition this callback and
    // the target-flow dropdown filter below both use, so they can't drift
    // apart again.
    if (state.triggers.some((t) => isSameTriggerIdentity(t, pendingTrigger.on, pendingTrigger.target.ref, pendingTrigger.agent ?? ''))) return;
    onChange({ ...state, triggers: [...state.triggers, pendingTrigger] });
    setTriggerTarget('');
    if (triggerKind === 'cron') { setCronSchedule(''); setCronConcurrency('forbid'); }
    if (WEBHOOK_FAMILY_TRIGGER_KINDS.includes(triggerKind)) {
      setWebhookId(''); setWebhookProvider('github'); setWebhookEvents([]); setWebhookSecretEnv(''); setWebhookSources('');
    }
    if (triggerKind === 'agent-complete') { setAgentSlug(''); }
  }, [pendingTrigger, canAddTrigger, state, onChange, triggerKind]);

  const toggleWebhookEvent = useCallback((ev: WebhookEventName) => {
    setWebhookEvents((prev) => (prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]));
  }, []);

  const removeTrigger = useCallback((i: number) => {
    onChange({
      ...state,
      triggers: state.triggers.filter((_, idx) => idx !== i),
    });
  }, [state, onChange]);

  const flowName = (id: string) => flows.find((f) => f.id === id)?.name ?? id;

  // Chip label's kind phrase, e.g. "on merged →", "cron 0 3 * * * →",
  // "webhook myproj-push →" — the target-flow name is rendered separately.
  // `pr-merged`/`issue-raised`/`agent-complete` each get their own honest
  // phrase (TRIGGER_KINDS carries no display-text field, so the fallback is
  // the row's own `id`: "on pr-merged →" etc — never the generic "on
  // complete →", which would mislabel a GitHub-receipt kind as a completion
  // event, or make an agent-complete chip indistinguishable from a flow one).
  const triggerKindPhrase = (tr: FlowTrigger): string => {
    if (tr.on === 'cron') return `cron ${tr.schedule ?? ''} →`;
    if (tr.on === 'webhook') return `webhook ${tr.webhook?.id ?? ''} →`;
    if (tr.on === 'merged') return 'on merged →';
    if (tr.on === 'flow-complete') return 'on complete →';
    return `on ${tr.on} →`;
  };

  return (
    <div
      data-component="flow-header"
      data-goal-set={goalSet ? 'true' : 'false'}
      style={{
        background: 'var(--panel)',
        borderBottom: '1px solid var(--line)',
        padding: '14px 24px 10px',
        flexShrink: 0,
      }}
    >
      {/* Top row: flow selector + name + goal warning + save */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
        {/* Flow selector */}
        <select
          value={flowId}
          onChange={(e) => onFlowSelect(e.target.value)}
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text)',
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            padding: '6px 11px',
            outline: 'none',
            cursor: 'pointer',
            minWidth: 180,
          }}
          data-field="flow-selector"
        >
          {isNew && <option value="new">— new flow —</option>}
          {flows.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>

        {/* Editable flow name */}
        <input
          type="text"
          value={state.name}
          placeholder="Flow name…"
          onChange={(e) => onChange({ ...state, name: e.target.value })}
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text)',
            background: 'transparent',
            border: 'none',
            borderBottom: '2px solid transparent',
            padding: '2px 6px',
            outline: 'none',
            flex: 1,
            minWidth: 200,
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => { (e.target as HTMLInputElement).style.borderBottomColor = 'var(--ember)'; }}
          onBlur={(e) => { (e.target as HTMLInputElement).style.borderBottomColor = 'transparent'; }}
          data-field="flow-name"
        />

        {/* Goal warning badge */}
        {!goalSet && (
          <span
            data-banner="goal-warning"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11.5,
              color: 'var(--amber)',
              fontFamily: 'var(--font-mono)',
              padding: '2px 8px',
              border: '1px solid rgba(251,191,36,0.3)',
              borderRadius: 4,
              background: 'rgba(251,191,36,0.07)',
            }}
          >
            ⚠ no goal set
          </span>
        )}

        {/* Save status (unified) */}
        <SaveStatus saving={saving} {...saveFb} />

        {version !== undefined && (
          <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
            v{version}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Save button */}
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          data-action="save-flow"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 16px',
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 600,
            color: saving ? 'var(--dim)' : '#fff',
            background: saving
              ? 'var(--panel-3)'
              : 'linear-gradient(135deg, #c2410c 0%, #9a3412 100%)',
            border: `1px solid ${saving ? 'var(--line-2)' : 'var(--ember-hot)'}`,
            borderRadius: 'var(--radius-sm)',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save Flow'}
        </button>
      </div>

      {/* Goal row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          color: 'var(--dim)',
          paddingTop: 10,
          whiteSpace: 'nowrap',
        }}>
          Goal
        </span>
        <textarea
          value={state.goal}
          placeholder="What does this flow accomplish?"
          rows={1}
          onChange={(e) => onChange({ ...state, goal: e.target.value })}
          style={{
            flex: 1,
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            padding: '8px 11px',
            outline: 'none',
            resize: 'none',
            minHeight: 36,
            maxHeight: 80,
            transition: 'border-color 0.12s',
          }}
          onFocus={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--ember)'; }}
          onBlur={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--line)'; }}
          data-field="flow-goal"
        />
      </div>

      {/* Meta row: project, kb, triggers — advanced, collapsed by default
          (UX spec §2). A basic flow needs none of these. */}
      <details data-section="flow-advanced" style={{ paddingBottom: 4 }}>
        <summary data-action="toggle-flow-advanced" style={{ cursor: 'pointer', fontSize: 11.5, fontWeight: 600, color: 'var(--faint)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Advanced — project, knowledge base &amp; triggers
        </summary>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', paddingTop: 12 }}>
        {/* B2: a flow is generic — it binds to a project at run-launch (from the
            project tab's "Run a flow"), not here. The project picker was removed. */}
        {/* KB */}
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--faint)', marginLeft: 8 }}>Knowledge Base</span>
        <select
          value={state.kb}
          onChange={(e) => onChange({ ...state, kb: e.target.value })}
          style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 12.5, padding: '4px 8px', outline: 'none', cursor: 'pointer' }}
          data-field="kb-select"
        >
          <option value="">— none —</option>
          {kbs.map((k) => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </select>

        {/* Triggers (R2-04-F4/forge-zyc: kind selector + per-kind fields; the
            target-flow select is shared by every shipped kind). */}
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--faint)', marginLeft: 8 }}>Triggers</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {state.triggers.map((tr, i) => (
            <span
              key={`${tr.on}-${tr.target.ref}-${i}`}
              data-trigger-chip={tr.target.ref}
              data-trigger-kind={tr.on}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                background: 'rgba(183,140,255,0.1)',
                border: '1px solid rgba(183,140,255,0.35)',
                borderRadius: 999,
                fontSize: 12,
                color: 'var(--violet)',
              }}
            >
              <span style={{ color: 'var(--faint)', fontSize: 11 }}>{triggerKindPhrase(tr)}</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12 }}>{flowName(tr.target.ref)}</span>
              <button
                onClick={() => removeTrigger(i)}
                aria-label={`Remove trigger to ${flowName(tr.target.ref)}`}
                style={{ color: 'rgba(183,140,255,0.6)', cursor: 'pointer', fontSize: 13, background: 'none', border: 'none', padding: 0, lineHeight: 1 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--red)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'rgba(183,140,255,0.6)'; }}
              >
                ✕
              </button>
            </span>
          ))}

          {/* Kind selector — every SHIPPED kind, one <option> per entry
              (mirrors orchestrator/flow-trigger.ts's SHIPPED_TRIGGER_KIND_IDS,
              the SSOT; forge-ui cannot import orchestrator TS directly). */}
          <select
            value={triggerKind}
            onChange={(e) => {
              const nextKind = e.target.value as ShippedTriggerKind;
              setTriggerKind(nextKind);
              setTriggerTarget('');
              // zyc review finding 1: pr-merged/issue-raised are GitHub-only
              // and accept exactly one event id each
              // (WEBHOOK_PROVIDERS_BY_KIND / WEBHOOK_EVENTS_BY_KIND, mirrors
              // validate-triggers.ts) — clamp a value carried over from a
              // prior kind selection so state never sits on an option the
              // new kind's selects/checkboxes no longer render (a mismatched
              // -but-invisible stale value would otherwise reach
              // buildTriggerDeclaration unconstrained).
              if (WEBHOOK_FAMILY_TRIGGER_KINDS.includes(nextKind)) {
                const allowedProviders = WEBHOOK_PROVIDERS_BY_KIND[nextKind] ?? [];
                if (!allowedProviders.includes(webhookProvider)) {
                  setWebhookProvider((allowedProviders[0] ?? 'github') as 'github' | 'gitea' | 'gitlab');
                }
                const allowedEvents = WEBHOOK_EVENTS_BY_KIND[nextKind] ?? [];
                setWebhookEvents((prev) => prev.filter((ev) => allowedEvents.includes(ev)));
              }
            }}
            data-field="trigger-kind"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 12, padding: '3px 8px', outline: 'none', cursor: 'pointer' }}
          >
            {SHIPPED_TRIGGER_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>

          {/* Target flow — shared by every kind (a cron/webhook/agent-complete
              trigger fires a flow just like flow-complete/merged do; B3: the
              operator chooses WHICH flow, no longer hardcoded to the first). */}
          <select
            value={triggerTarget}
            onChange={(e) => setTriggerTarget(e.target.value)}
            data-field="trigger-target"
            style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 12, padding: '3px 8px', outline: 'none', cursor: 'pointer' }}
          >
            <option value="">trigger a flow…</option>
            {/* zyc review finding 2: same isSameTriggerIdentity the add-dedup
                above uses — an agent-complete row's identity also carries
                `agent`, so a target already used by one agent-complete row
                must NOT be hidden from the dropdown when authoring a SECOND
                row for a different agent. */}
            {flows.filter((f) => f.id !== flowId && !state.triggers.some((t) => isSameTriggerIdentity(t, triggerKind, f.id, agentSlug.trim()))).map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>

          {/* agent-complete — the source agent slug whose completion fires
              this trigger (orchestrator/studio/validate-triggers.ts's
              trigger-agent-complete check requires this be non-empty). */}
          {triggerKind === 'agent-complete' && (
            <input
              type="text"
              value={agentSlug}
              onChange={(e) => setAgentSlug(e.target.value)}
              placeholder="agent slug"
              data-field="trigger-agent-slug"
              style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '3px 8px', outline: 'none', width: 110 }}
            />
          )}

          {/* cron — schedule + overrun concurrency policy. */}
          {triggerKind === 'cron' && (
            <>
              <input
                type="text"
                value={cronSchedule}
                onChange={(e) => setCronSchedule(e.target.value)}
                placeholder="0 3 * * *"
                data-field="trigger-schedule"
                data-schedule-invalid={cronScheduleInvalid ? 'true' : 'false'}
                style={{ background: 'var(--bg-2)', border: `1px solid ${cronScheduleInvalid ? 'var(--red)' : 'var(--line)'}`, borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '3px 8px', outline: 'none', width: 110 }}
              />
              <select
                value={cronConcurrency}
                onChange={(e) => setCronConcurrency(e.target.value as 'allow' | 'forbid')}
                data-field="trigger-concurrency"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 12, padding: '3px 8px', outline: 'none', cursor: 'pointer' }}
              >
                <option value="forbid">forbid</option>
                <option value="allow">allow</option>
              </select>
            </>
          )}

          {/* webhook family (webhook / pr-merged / issue-raised) — receive/
              trust config; the endpoint is derived read-only display, not
              editable. zyc review finding 1: pr-merged/issue-raised reuse
              this SAME block (own `on:` value, ADR-027's amendment) — before
              this fix only `on: webhook` rendered it, so a pr-merged/
              issue-raised trigger had NO way to declare the webhook.id
              cli/bridge-hooks.ts's findWebhookTrigger needs to route a
              delivery, making it authorable-but-permanently-dead. Provider
              options + event checkboxes are constrained PER KIND
              (WEBHOOK_PROVIDERS_BY_KIND / WEBHOOK_EVENTS_BY_KIND, mirrors
              validate-triggers.ts) so an operator can never pick a
              provider/event combination that kind's server-side receiver can
              never resolve. */}
          {WEBHOOK_FAMILY_TRIGGER_KINDS.includes(triggerKind) && (
            <>
              <input
                type="text"
                value={webhookId}
                onChange={(e) => setWebhookId(e.target.value)}
                placeholder="hook id"
                data-field="webhook-id"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '3px 8px', outline: 'none', width: 100 }}
              />
              <select
                value={webhookProvider}
                onChange={(e) => setWebhookProvider(e.target.value as 'github' | 'gitea' | 'gitlab')}
                data-field="webhook-provider"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 12, padding: '3px 8px', outline: 'none', cursor: 'pointer' }}
              >
                {(WEBHOOK_PROVIDERS_BY_KIND[triggerKind] ?? []).map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              {(WEBHOOK_EVENTS_BY_KIND[triggerKind] ?? []).map((ev) => (
                <label key={ev} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--faint)' }}>
                  <input
                    type="checkbox"
                    checked={webhookEvents.includes(ev)}
                    onChange={() => toggleWebhookEvent(ev)}
                    data-field="webhook-events"
                    data-event-value={ev}
                  />
                  {ev}
                </label>
              ))}
              <input
                type="text"
                value={webhookSecretEnv}
                onChange={(e) => setWebhookSecretEnv(e.target.value)}
                placeholder="SECRET_ENV_NAME"
                data-field="webhook-secret-env"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '3px 8px', outline: 'none', width: 140 }}
              />
              <input
                type="text"
                value={webhookSources}
                onChange={(e) => setWebhookSources(e.target.value)}
                placeholder="owner/repo, owner/repo2"
                data-field="webhook-sources"
                style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, padding: '3px 8px', outline: 'none', width: 170 }}
              />
              {webhookId && (
                <span data-hook-url={`/api/hooks/${webhookId}`} style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
                  /api/hooks/{webhookId}
                </span>
              )}
            </>
          )}

          <button
            onClick={addTrigger}
            disabled={!canAddTrigger}
            style={{
              background: 'transparent',
              border: '1px solid transparent',
              color: canAddTrigger ? 'var(--dim)' : 'var(--faint)',
              fontFamily: 'var(--font-display)',
              fontSize: 12,
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: 'var(--radius-sm)',
              cursor: canAddTrigger ? 'pointer' : 'not-allowed',
            }}
            data-action="add-trigger"
          >
            + add
          </button>
        </div>
        </div>
      </details>
    </div>
  );
}
