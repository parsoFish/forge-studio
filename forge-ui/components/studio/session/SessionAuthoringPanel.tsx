'use client';

import { useMemo, useState } from 'react';

import { finalizeAuthoring } from '@/lib/bridge-client';
import type { SessionArtifactPayload, FilePackageFile } from '@/lib/session-client';

// ---------------------------------------------------------------------------
// SessionAuthoringPanel — the "authoring" kind's live interactive affordance.
// This kind's status.json carries no rich multi-phase state machine the
// panel itself needs to read, so it works ENTIRELY off the `file-package`
// artifact the generic session-shell route already derives
// (`viewState.artifact`, passed down from the session page) — no second
// fetch, no new GET route.
//
// The draft's SHAPE (skill vs hook, per skills/creation-agent/SKILL.md's own
// two package shapes) is detected purely by file PRESENCE — a `SKILL.md` at
// the package root means a skill draft, a `hook.yaml` means a hook draft —
// mirroring this whole module family's "derive from what's really there,
// never fabricate" convention. Neither present yet ⇒ "still drafting".
//
// Finalize (Save) is the ONE explicit save act (D5, `_wave5/unit-specs/
// R4-21-phase2.md` — never auto-saved): it POSTs `{project, sessionId, kind,
// id}` to `POST /api/studio/authoring/finalize`, which drives the session's
// own `committing` turn server-side and installs the LANDED package — this
// panel never sends package bytes or hook metadata itself (R4-21 phase 2,
// T3 correction A/C). The hook-specific form fields a phase-1 round of this
// panel rendered (name/description/lifecycle-event/matcher) are GONE: hook
// metadata now comes from the DRAFTED hook.yaml the operator already reviews
// in the artifact pane on the right, never from a parallel form that could
// diverge from what actually ships. Only the library id (`authoring-id`,
// D4 — an operator decision the drafted package cannot make for itself)
// survives for both shapes.
//
// `onFinalized(kind, id)` is called on success so the PAGE (not this
// component) navigates to `/skills/<id>` or `/hooks/<id>` — this panel does
// not call `useRouter()` itself (the App Router's `useRouter` throws
// "invariant expected app router to be mounted" under `renderToStaticMarkup`,
// the harness `SessionAuthoringPanel.test.ts` renders this component with;
// bubbling the navigation decision up to the page keeps this component
// render-testable in isolation, mirroring `SessionInstructionsPanel`'s own
// `onRefresh`-callback convention rather than `SessionProjectBrainPanel`'s
// in-component `useRouter` call). Palette-visibility / binding stay the
// operator's own SEPARATE, later act at that destination page — this panel
// never approves or binds anything itself.
// ---------------------------------------------------------------------------

type DraftShape = 'skill' | 'hook' | 'unknown';

function draftShapeOf(files: readonly FilePackageFile[]): DraftShape {
  if (files.some((f) => f.path === 'SKILL.md')) return 'skill';
  if (files.some((f) => f.path === 'hook.yaml')) return 'hook';
  return 'unknown';
}

export function SessionAuthoringPanel({
  sessionId,
  project = null,
  artifact,
  onFinalized,
}: {
  sessionId: string;
  /** The session's own project — threaded from the page (the same source
   *  `sessionId` already arrives from) since the wire contract now requires
   *  it on every finalize request (D5). Optional (defaults to `null`) so an
   *  isolated render (e.g. this component's own DOM regression suite, which
   *  does not fetch a page-level session summary) can omit it; `onSave` stays
   *  disabled until a real project is known. */
  project?: string | null;
  artifact: SessionArtifactPayload | null;
  /** Called with the saved library kind + id on a successful finalize — the
   *  PAGE navigates (`/skills/<id>` or `/hooks/<id>`); see this file's own
   *  header for why the navigation itself does not live here. */
  onFinalized?: (kind: 'skill' | 'hook', id: string) => void;
}): JSX.Element {
  const files = artifact && artifact.kind === 'file-package' ? artifact.files : [];
  const shape = useMemo(() => draftShapeOf(files), [files]);

  const [id, setId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = id.trim().length > 0 && Boolean(project);

  async function onSave(): Promise<void> {
    if (!canSave || saving || !project) return;
    setSaving(true);
    setError(null);
    const savedId = id.trim();
    const result = await finalizeAuthoring({ project, sessionId, kind: shape === 'hook' ? 'hook' : 'skill', id: savedId });
    if (result.ok && result.id && result.kind) {
      onFinalized?.(result.kind, result.id);
      return;
    }
    setError(result.error ?? 'could not save the draft');
    setSaving(false);
  }

  return (
    <div data-component="authoring-panel">
      <div
        data-section="authoring-status"
        data-authoring-shape={shape}
        style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '14px 18px', background: 'var(--panel)', fontSize: 13, color: 'var(--dim)', marginBottom: 14 }}
      >
        {shape === 'unknown'
          ? 'The creation agent is drafting — a package/SKILL.md or package/hook.yaml will appear here once it starts writing.'
          : shape === 'skill'
          ? `Drafting a SKILL package — ${files.length} file(s) so far. Review them in the pane on the right.`
          : `Drafting a HOOK package — ${files.length} file(s) so far. Review them in the pane on the right.`}
      </div>

      {shape !== 'unknown' && (
        <div data-section="authoring-finalize" style={{ display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--line)', borderRadius: 10, padding: '16px 18px', background: 'var(--panel)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            Save this draft
          </div>
          <FieldLabel htmlFor="authoring-id">{shape === 'skill' ? 'Skill id (directory name)' : 'Hook id (directory name)'}</FieldLabel>
          <input id="authoring-id" data-field="authoring-id" style={inputStyle} value={id} placeholder="e.g. pr-diff-summary"
            onChange={(e) => setId(e.target.value)} />

          {error && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{error}</div>}
          <div>
            <button className="btn btn-primary" data-action="finalize-authoring" onClick={() => void onSave()}
              disabled={!canSave || saving} style={{ opacity: canSave && !saving ? 1 : 0.5 }}>
              {saving ? 'Saving…' : `Save ${shape} →`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }): JSX.Element {
  return (
    <label style={{ fontFamily: 'var(--font-display)', fontSize: 11.5, fontWeight: 600, color: 'var(--dim)', display: 'block', marginTop: 2 }} htmlFor={htmlFor}>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
  color: 'var(--text)', fontSize: 13, padding: '7px 10px', outline: 'none', boxSizing: 'border-box',
};
