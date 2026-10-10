'use client';

/**
 * The adversarial review on the verdict gate (forge-mfv5.1.31) — agent CLAIMS
 * the operator weighs, never a gate (R4-08-F3). The review artifact joins one
 * chunk per work item into `summary` and `why`/`what`/`how`; this pane re-cuts
 * it per work item so no field is one unbroken paragraph, scrolls inside a
 * pane token, and names the head the review judged — amber when it is not the
 * branch head (forge-mfv5.1.30). Findings carry no resolved state in the data,
 * so none is shown; resolution lives on the operator's comments.
 *
 * DOM: [data-section="review-findings"][data-findings-state][data-findings-count]
 * [data-review-stale], [data-finding-group], [data-finding][data-finding-severity]
 * [data-finding-category], [data-section="why-what-how"] > [data-www-group] >
 * [data-narrative="why|what|how"].
 */
import { useState } from 'react';

import type { ReviewFindingsDoc } from '@/components/ReviewFindingsPanel';
import { groupFindings, leadSentences, reviewHeadIsStale, splitByWorkItem } from '@/lib/gate-view';
import { InlineCode } from './InlineCode';
import { pane, paneHeader, paneTitle, meta, word, wiTag, miniBtn, SEVERITY_COLOUR } from './styles';

export type ReviewFindingsState = { doc: ReviewFindingsDoc | null; absent: boolean; error: boolean };

const WWW = ['why', 'what', 'how'] as const;
const SENTENCES_PER_BLOCK = 2;

export function FindingsPane({
  state, headSha, workItemTitle,
}: {
  state: ReviewFindingsState;
  headSha: string | undefined;
  workItemTitle: (id: string) => string;
}): JSX.Element {
  const [tab, setTab] = useState<'findings' | 'why-what-how'>('findings');
  const { doc } = state;

  if (!doc) {
    const kind = state.error ? 'error' : 'absent';
    return (
      <div data-section="review-findings" data-findings-state={kind} style={pane}>
        <header style={paneHeader}><h2 style={paneTitle}>Adversarial review</h2></header>
        <p data-pane-body style={{ height: 'var(--pane-md)', margin: 0, padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: state.error ? 'var(--amber)' : 'var(--dim)' }}>
          {state.error
            ? 'The findings could not be loaded — reload to retry. This is a fetch failure, not evidence the review never ran.'
            : 'The review did not run for this cycle — no findings artifact was produced.'}
        </p>
      </div>
    );
  }

  const groups = groupFindings(doc);
  const count = doc.findings?.length ?? 0;
  const stale = reviewHeadIsStale(doc.headSha, headSha);
  const title = (id: string): string => workItemTitle(id) || (id === 'unattributed' || id === '' ? 'Not tied to a work item' : id);
  const wwwSlices = WWW.map((k) => ({ k, slices: splitByWorkItem(doc.whyWhatHow?.[k]) }));
  const wwwIds = [...new Set(wwwSlices.flatMap((x) => x.slices.map((s) => s.id)))];

  return (
    <div
      data-section="review-findings"
      data-findings-state="present"
      data-findings-count={count}
      data-review-stale={stale ? 'true' : 'false'}
      data-review-lenses={(doc.lenses ?? []).join(',')}
      style={pane}
    >
      <header style={paneHeader}>
        <h2 style={paneTitle}>Adversarial review</h2>
        <span style={{ ...meta, color: stale ? 'var(--amber)' : 'var(--dim)' }}>
          {count === 0 ? 'clean pass — no findings' : `${count} finding${count === 1 ? '' : 's'}`}
          {doc.headSha ? ` · reviewed ${doc.headSha.slice(0, 7)}` : ''}
          {stale && headSha ? ` ≠ head ${headSha.slice(0, 7)}` : ''}
        </span>
        <span role="tablist" style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-1)' }}>
          {(['findings', 'why-what-how'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              id={`findings-tab-${t}`}
              aria-controls={`findings-panel-${t}`}
              aria-selected={tab === t}
              data-action="findings-tab"
              data-tab={t}
              onClick={() => setTab(t)}
              style={{ ...miniBtn, background: tab === t ? 'var(--panel-3)' : 'none', color: tab === t ? 'var(--ember)' : 'var(--dim)', borderColor: tab === t ? 'var(--line-2)' : 'transparent' }}
            >
              {t === 'findings' ? 'Findings' : 'Why · what · how'}
            </button>
          ))}
        </span>
      </header>

      <div data-pane-body role="tabpanel" id="findings-panel-findings" aria-labelledby="findings-tab-findings" hidden={tab !== 'findings'} style={{ height: 'var(--pane-md)', overflowY: 'auto', overflowX: 'hidden' }}>
        {count === 0 && <p style={{ margin: 0, padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>{doc.summary || 'No findings under any lens.'}</p>}
        {groups.map((g) => (
          <div key={g.id} data-finding-group={g.id} style={{ padding: 'var(--space-2) var(--space-4)', borderBottom: '1px solid var(--line)' }}>
            <h3 style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              <span style={wiTag}>{g.id}</span>{title(g.id)}
            </h3>
            {g.summary && (
              <p title={g.summary} style={{ margin: 'var(--space-1) 0', fontSize: 'var(--text-sm)', color: 'var(--dim)', overflowWrap: 'anywhere', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                <InlineCode text={g.summary} />
              </p>
            )}
            {g.items.map((f, i) => (
              <div
                key={f.id ?? i}
                data-finding={f.id ?? `RF-${i + 1}`}
                data-finding-severity={f.severity ?? 'info'}
                data-finding-category={f.category ?? ''}
                title={f.detail}
                style={{ display: 'grid', gridTemplateColumns: 'calc(var(--space-6) * 2) minmax(0, 1fr)', gap: 'var(--space-2)', padding: 'var(--space-1) 0', fontSize: 'var(--text-sm)' }}
              >
                <span style={{ ...word, color: SEVERITY_COLOUR[f.severity ?? 'info'] }}>{f.severity ?? 'info'}</span>
                <span style={{ color: 'var(--text)', overflowWrap: 'anywhere' }}>
                  <InlineCode text={f.title ?? ''} />
                  {f.category && <span style={{ ...meta, color: 'var(--faint)', marginLeft: 'var(--space-2)' }}>{f.category}</span>}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div data-pane-body data-section="why-what-how" role="tabpanel" id="findings-panel-why-what-how" aria-labelledby="findings-tab-why-what-how" hidden={tab !== 'why-what-how'} style={{ height: 'var(--pane-md)', overflowY: 'auto', overflowX: 'hidden' }}>
        {wwwIds.map((id) => (
          <div key={id || 'all'} data-www-group={id} style={{ padding: 'var(--space-2) var(--space-4)', borderBottom: '1px solid var(--line)' }}>
            <h3 style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', margin: '0 0 var(--space-1)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              <span style={wiTag}>{id}</span>{title(id)}
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-3)' }}>
              {wwwSlices.map(({ k, slices }) => {
                const slice = slices.find((s) => s.id === id);
                const lead = slice ? leadSentences(slice.text, SENTENCES_PER_BLOCK) : null;
                return (
                  <div key={k} data-narrative={k} style={{ fontSize: 'var(--text-sm)', color: 'var(--dim)', overflowWrap: 'anywhere', minWidth: 0 }}>
                    <span style={{ ...word, display: 'block', color: 'var(--faint)' }}>{k}</span>
                    {lead ? (
                      <>
                        <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
                          {lead.sentences.map((s, i) => <li key={i}><InlineCode text={s} /></li>)}
                        </ul>
                        {lead.omitted > 0 && (
                          <details>
                            <summary style={{ ...meta, color: 'var(--faint)', cursor: 'pointer' }}>+ {lead.omitted} more</summary>
                            <InlineCode text={slice!.text} />
                          </details>
                        )}
                      </>
                    ) : '—'}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
