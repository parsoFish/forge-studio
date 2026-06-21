'use client';

import { useEffect, useState } from 'react';
import { diff } from 'jsondiffpatch';

/**
 * S7 review evidence widgets:
 *  - BeforeAfterSlider: img-comparison-slider web component for before/after images.
 *  - JsonDiffView: jsondiffpatch-computed structural delta, rendered as safe text
 *    (we render the delta ourselves — never the XSS-prone HTML formatter).
 */

// The img-comparison-slider custom element (registered client-side on import).
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'img-comparison-slider': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}

export function BeforeAfterSlider({ before, after }: { before: string; after: string }): JSX.Element {
  const [ready, setReady] = useState(false);
  // Register the custom element in the browser only (it calls customElements.define).
  useEffect(() => {
    let live = true;
    import('img-comparison-slider').then(() => { if (live) setReady(true); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // Before registration the element renders its slotted images stacked — an
  // acceptable fallback. After upgrade it becomes the interactive slider.
  return (
    <div data-evidence="before-after-slider" data-slider-ready={ready ? 'true' : 'false'}
      style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid #21262d' }}>
      <img-comparison-slider style={{ '--divider-color': '#58a6ff' } as React.CSSProperties}>
        {/* eslint-disable @next/next/no-img-element */}
        <img slot="first" src={before} alt="before" style={{ width: '100%', display: 'block' }} />
        <img slot="second" src={after} alt="after" style={{ width: '100%', display: 'block' }} />
        {/* eslint-enable @next/next/no-img-element */}
      </img-comparison-slider>
    </div>
  );
}

/**
 * Compute and show a structural JSON diff with jsondiffpatch. `before`/`after`
 * are strings; when both parse as JSON we show the delta, otherwise we fall back
 * to a side-by-side text view. The delta is rendered as pretty JSON text in a
 * <pre> — no innerHTML, so the jsondiffpatch HTML-formatter XSS class can't apply.
 */
export function JsonDiffView({ before, after }: { before?: string; after?: string }): JSX.Element {
  const left = tryParse(before);
  const right = tryParse(after);

  if (left !== undefined && right !== undefined) {
    const delta = diff(left, right);
    return (
      <div data-evidence="json-diff">
        {delta === undefined ? (
          <div style={{ fontSize: 12, color: '#6e7681' }}>No structural change.</div>
        ) : (
          <pre style={preStyle}>{JSON.stringify(delta, null, 2)}</pre>
        )}
      </div>
    );
  }

  return (
    <div data-evidence="text-diff" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <DiffSide label="before" value={before} />
      <DiffSide label="after" value={after} />
    </div>
  );
}

function DiffSide({ label, value }: { label: string; value?: string }): JSX.Element {
  return (
    <div data-side={label}>
      <div style={{ fontSize: 10, color: '#6e7681', marginBottom: 3, textTransform: 'uppercase' }}>{label}</div>
      <pre style={preStyle}>{value ?? '—'}</pre>
    </div>
  );
}

function tryParse(s?: string): unknown {
  if (typeof s !== 'string' || s.trim() === '') return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}

const preStyle: React.CSSProperties = {
  margin: 0, overflow: 'auto', background: '#010409', border: '1px solid #21262d',
  borderRadius: 4, padding: 8, fontSize: 11, color: '#c9d1d9',
};
