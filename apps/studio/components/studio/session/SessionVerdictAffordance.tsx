'use client';

import { type SessionAffordance, type SessionArtifactPayload } from '@/lib/session-client';
import { disabledAttrs } from '@/lib/disabled-reason';
import { deriveApproveGate } from '@/lib/session-verdict-gate';
import { preferredGenerationFor, type GenerationSelection } from '@/lib/session-artifact-view';
import {
  AUTHORING_PACKAGE_SHAPES,
  authoringPackageKindOf,
  type AuthoringPackageKind,
} from '@/lib/authoring-package-shape';
import { ErrorLine, sectionStyle, labelStyle, inputStyle } from './session-panel-shared';

// ---------------------------------------------------------------------------
// SessionVerdictAffordance — the `verdict` affordance-kind renderer, split
// out of `SessionInteractivePanel.tsx` (bead forge-8vfn.8.3.4, pure transfer
// — behaviour identical to the branch this replaces).
//
// Rendered ONLY from `affordance.meta.verdicts` (W6-B6 post-merge review) —
// the server-derived, single source of "which verdict values are legal
// here"; the SAME write route validates a posted verdict against this SAME
// value, so there is no second, hand-kept per-kind table on either side.
//
// Approve additionally offers a generation picker (`handleDemoVerdict`
// accepts an optional `generation`) whenever the session's own artifact IS a
// real `generation-gallery` with at least one generation — driven by the
// wire artifact kind, never a `kind === 'demo'` compare. Approve's
// extra-fields gate is GENERIC, driven by `affordance.meta.requires`
// (studio/session-kinds.yaml's authored `requires:` list) — never a
// client-side "file-package needs an id" assumption. `kind` itself is NEVER
// sent in the body — the write route derives it server-side from the REAL
// staged files.
//
// **Generation selection is LIFTED (bead forge-8vfn.8.3.4).** This picker
// used to own a local `useState<string>('')`, independent of
// `GenerationGallery`'s OWN local selection state — so the two controls
// could disagree about which generation an approve would lock. Both are now
// driven by the SAME `selectedGeneration`/`onSelectGeneration` pair, owned
// by the session page (one `useState`, `lib/session-artifact-view.ts`'s
// `GenerationSelection` shape) and threaded to `GenerationGallery` the same
// way — `preferredGenerationFor` resolves it to a concrete number for THIS
// session (`sessionId`), falling back to "auto (latest)" exactly as before
// when nothing has been picked, or when the lifted value belongs to a
// different session.
// ---------------------------------------------------------------------------

/** Detects a drafted authoring package's shape purely by file PRESENCE —
 *  delegates to `authoringPackageKindOf` (lib/authoring-package-shape.ts).
 *  `'unknown'` covers "still drafting" (no marker file has landed yet). */
type DraftShape = AuthoringPackageKind | 'unknown';

function draftShapeOf(files: readonly { path: string }[]): DraftShape {
  return authoringPackageKindOf(files.map((f) => f.path));
}

/** The package-id field's label, derived from `AUTHORING_PACKAGE_SHAPES`'s
 *  own kind names so a future fourth shape gets an honest label for free. */
function packageIdFieldLabel(shape: DraftShape | null): string {
  const known = AUTHORING_PACKAGE_SHAPES.find((s) => s.kind === shape);
  const noun = known ? `${known.kind[0]!.toUpperCase()}${known.kind.slice(1)}` : 'Skill';
  return shape === 'template' ? `${noun} id (file name, without .md)` : `${noun} id (directory name)`;
}

/** The "still resolving" advisory naming every marker file this route looks
 *  for. Built FROM `AUTHORING_PACKAGE_SHAPES`, mirroring the server's own
 *  409 message. */
function shapeWaitingHint(): string {
  const names = AUTHORING_PACKAGE_SHAPES.map((s) => s.filename);
  return `Waiting for the draft to include a ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]} before this can be saved.`;
}

/** The sorted (newest-first) generation numbers a `generation-gallery`
 *  artifact carries, or `[]` for any other artifact kind. */
function generationOptions(artifact: SessionArtifactPayload | null): number[] {
  if (!artifact || artifact.kind !== 'generation-gallery') return [];
  return artifact.generations.map((g) => g.number).sort((a, b) => b - a);
}

export function SessionVerdictAffordance({
  affordance,
  artifact,
  sessionId,
  selectedGeneration,
  onSelectGeneration,
  packageId,
  setPackageId,
  notesText,
  setNotesText,
  reviseOpen,
  setReviseOpen,
  reviseFeedback,
  setReviseFeedback,
  error,
  busy,
  submit,
}: {
  affordance: SessionAffordance;
  artifact: SessionArtifactPayload | null;
  /** This session's id — `preferredGenerationFor` resolves `selectedGeneration`
   *  against it, so a selection made in a different session never leaks in. */
  sessionId: string;
  /** The ONE lifted selection (bead forge-8vfn.8.3.4) — the SAME value
   *  `GenerationGallery` reads/writes. `null` means "nothing picked yet". */
  selectedGeneration: GenerationSelection;
  onSelectGeneration: (next: GenerationSelection) => void;
  packageId: string;
  setPackageId: (value: string) => void;
  notesText: string;
  setNotesText: (value: string) => void;
  reviseOpen: boolean;
  setReviseOpen: (updater: boolean | ((open: boolean) => boolean)) => void;
  reviseFeedback: string;
  setReviseFeedback: (value: string) => void;
  error?: string;
  busy: boolean;
  submit: (affordance: SessionAffordance, body: Record<string, unknown>) => Promise<void>;
}): JSX.Element {
  const packageArtifact = artifact !== null && artifact.kind === 'file-package' ? artifact : null;
  const packageShape = packageArtifact ? draftShapeOf(packageArtifact.files) : null;
  const generations = generationOptions(artifact);
  // `pickedGeneration` is `undefined` for "auto (latest)" — either nothing
  // has been picked yet, or the lifted selection belongs to a different
  // session (`preferredGenerationFor`'s own guard) — mirroring
  // `generationGalleryView`'s identical fallback so the two controls' idea
  // of "the current pick" can never diverge.
  const pickedGeneration = preferredGenerationFor(selectedGeneration, sessionId);
  // The resolved value for `data-selected-generation` — unlike the `<select>`
  // itself (which must show the literal "auto" option when nothing was
  // picked), this names the ACTUAL generation an approve would lock right
  // now, mirroring `GenerationGallery`'s own `data-selected-generation`
  // exactly so the two can be compared directly in a test or a story.
  const resolvedGeneration = pickedGeneration ?? (generations.length > 0 ? generations[0] : null);

  const verdicts = affordance.meta?.verdicts ?? [];
  const requiresFields = affordance.meta?.requires ?? [];
  const gate = deriveApproveGate({ requires: requiresFields, idValue: packageId, packageShape, busy });
  const idRequired = gate.idRequired;

  return (
    <div key={affordance.id} data-section="session-affordance" data-affordance-kind="verdict" style={sectionStyle}>
      {generations.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={labelStyle}>Generation to lock (optional — defaults to the latest)</div>
          <select
            value={pickedGeneration !== undefined ? String(pickedGeneration) : ''}
            onChange={(e) => {
              const raw = e.target.value;
              onSelectGeneration(raw === '' ? null : { sessionId, number: Number(raw) });
            }}
            data-field="session-generation-pick"
            data-selected-generation={resolvedGeneration ?? ''}
            style={inputStyle}
          >
            <option value="">auto (latest — #{generations[0]})</option>
            {generations.map((n) => (
              <option key={n} value={n}>
                generation #{n}
              </option>
            ))}
          </select>
        </div>
      )}
      {idRequired && (
        <div style={{ marginBottom: 10 }}>
          <div style={labelStyle}>{packageIdFieldLabel(packageShape)}</div>
          <input
            value={packageId}
            onChange={(e) => setPackageId(e.target.value)}
            placeholder="e.g. pr-diff-summary"
            data-field="session-package-id"
            style={inputStyle}
          />
          {gate.shapeBlocksApprove && (
            <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 4 }}>
              {shapeWaitingHint()}
            </div>
          )}
        </div>
      )}
      {/* W7-C2 (sessions-kinds-29) — the rationale field, one per verdict
          affordance, sent as the OPTIONAL `notes` body field with
          approve/reject/revise alike. */}
      <div style={{ marginBottom: 10 }}>
        <div style={labelStyle}>Notes (optional — recorded with your decision)</div>
        <textarea
          value={notesText}
          onChange={(e) => setNotesText(e.target.value)}
          placeholder="Why?"
          rows={2}
          data-field="session-verdict-notes"
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>
      {gate.hint !== null && (
        <div data-requires-hint style={{ fontSize: 11.5, color: 'var(--dim)', margin: '0 0 8px' }}>
          {gate.hint}
        </div>
      )}
      {error && <ErrorLine message={error} />}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {verdicts.includes('approve') && (
          <button
            type="button"
            className="btn btn-primary"
            data-action="verdict-approve"
            {...disabledAttrs(gate.disabledReason)}
            onClick={() =>
              void submit(affordance, {
                verdict: 'approve',
                ...(pickedGeneration !== undefined ? { generation: pickedGeneration } : {}),
                ...(notesText.trim().length > 0 ? { notes: notesText.trim() } : {}),
                ...gate.providedFields,
              })
            }
            style={{ opacity: gate.disabledReason !== null ? 0.5 : 1 }}
          >
            {busy ? 'Working…' : 'Approve'}
          </button>
        )}
        {verdicts.includes('revise') && (
          <button
            type="button"
            className="btn"
            data-action="verdict-revise"
            disabled={busy}
            onClick={() => setReviseOpen((open) => !open)}
            style={{ opacity: busy ? 0.5 : 1 }}
          >
            Request changes
          </button>
        )}
        {verdicts.includes('reject') && (
          <button
            type="button"
            className="btn"
            data-action="verdict-reject"
            disabled={busy}
            onClick={() => void submit(affordance, { verdict: 'reject', ...(notesText.trim().length > 0 ? { notes: notesText.trim() } : {}) })}
            style={{ opacity: busy ? 0.5 : 1 }}
          >
            {busy ? 'Working…' : 'Reject'}
          </button>
        )}
      </div>
      {verdicts.includes('revise') && reviseOpen && (
        <div data-section="session-revise" style={{ marginTop: 10 }}>
          <div style={labelStyle}>What should change?</div>
          <textarea
            value={reviseFeedback}
            onChange={(e) => setReviseFeedback(e.target.value)}
            placeholder="Describe the changes to apply in the next draft…"
            rows={3}
            data-field="session-revise-feedback"
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <button
            type="button"
            className="btn btn-primary"
            data-action="verdict-revise-send"
            {...disabledAttrs(busy ? 'Submitting…' : reviseFeedback.trim().length === 0 ? 'Describe what should change first' : null)}
            onClick={() =>
              void submit(affordance, {
                verdict: 'revise',
                feedback: reviseFeedback.trim(),
                ...(notesText.trim().length > 0 ? { notes: notesText.trim() } : {}),
              })
            }
            style={{ opacity: busy || reviseFeedback.trim().length === 0 ? 0.5 : 1 }}
          >
            {busy ? 'Sending…' : 'Send for revision'}
          </button>
        </div>
      )}
    </div>
  );
}
