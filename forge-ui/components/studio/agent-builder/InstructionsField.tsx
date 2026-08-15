'use client';

/**
 * InstructionsField — the agent's instruction-file textarea (A3), plus the
 * generation-assist affordance (R2-09 C3/D8/D9): a `Generate draft` button
 * that composes a deterministic charter from the CURRENT (possibly unsaved)
 * builder state via `requestInstructionsDraft`, and an "unconfirmed draft"
 * indicator that persists across further manual edits until the next
 * successful save or Discard.
 *
 * The draft is NEVER auto-saved here — applying it only marks the state
 * dirty; only the operator's own Save writes it. A failed draft request
 * surfaces as a toast (via `onError`), never a silently-unchanged textarea
 * and never a client-fabricated draft.
 */

type Props = {
  value: string;
  isDraft: boolean;
  pending: boolean;
  /**
   * W6-SW-3 (sweep C7#1): the instructions-draft route composes from the
   * saved agent (it 404s on an unknown slug), so "Generate draft" is
   * guaranteed to fail on a brand-new, not-yet-saved agent. Threaded from
   * the page's `state.slug` — false disables the button instead of letting
   * it fail every click.
   */
  canGenerate: boolean;
  onGenerate: () => void;
  onChange: (text: string) => void;
};

export function InstructionsField({ value, isDraft, pending, canGenerate, onGenerate, onChange }: Props) {
  const disabled = pending || !canGenerate;
  return (
    <div
      className="field-group"
      data-component="instructions-field"
      data-section="instructions"
      data-instructions-draft={isDraft ? 'true' : 'false'}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <label className="field-label" htmlFor="process-input" style={{ margin: 0 }}>Instructions</label>
        <button
          type="button"
          className="btn btn-ghost"
          data-action="generate-instructions"
          onClick={onGenerate}
          disabled={disabled}
          style={{ fontSize: 11, padding: '2px 8px' }}
          title={
            !canGenerate
              ? 'Save the agent once before generating an instructions draft.'
              : 'Compose a deterministic instructions draft from the current (possibly unsaved) purpose, composition, interactivity and brain-access fields.'
          }
        >
          {pending ? 'Generating…' : 'Generate draft'}
        </button>
      </div>
      {isDraft && (
        <p
          data-component="instructions-draft-badge"
          className="save-hint save-hint-dirty"
          style={{ margin: '2px 0 0', fontSize: 11 }}
        >
          Unconfirmed draft — edit freely below, then Save to keep it (or Discard to drop it).
        </p>
      )}
      <textarea
        id="process-input"
        className="input"
        rows={12}
        placeholder="What this agent does, step by step — what it reads, what it decides, and the artifact it produces."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
