'use client';

import { disabledAttrs } from '@/lib/disabled-reason';

/**
 * A refused Save (forge-mfv5.1.12): the bridge would not push the default branch
 * while these contract files sit uncommitted. Row 6 (ruling T1 1977a) — the
 * operator can commit them to forge-studio and save again, from Studio.
 */
export function SaveRefusal({ files, busy, onAdopt }: { files: readonly string[]; busy: boolean; onAdopt: () => void }) {
  if (files.length === 0) return null;
  return (
    <div
      data-section="save-refused"
      data-save-refused-count={files.length}
      role="alert"
      style={{ margin: '8px 28px 0', padding: '10px 12px', border: '1px solid var(--amber)', borderRadius: 6, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <span>
        Not saved: these contract files are not committed, so saving would push the default branch without them.
      </span>
      <ul style={{ margin: 0, paddingLeft: 18, fontFamily: 'var(--font-mono)' }}>
        {files.map((f) => <li key={f} data-save-refused-file={f}>{f}</li>)}
      </ul>
      <button
        type="button"
        className="btn btn-sm"
        data-action="adopt-and-save"
        onClick={onAdopt}
        {...disabledAttrs(busy ? 'Saving…' : null)}
        style={{ alignSelf: 'flex-start' }}
      >
        {busy ? 'Saving…' : 'Commit these files and save'}
      </button>
    </div>
  );
}
