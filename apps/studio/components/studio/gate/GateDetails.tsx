/**
 * Everything secondary on the verdict gate, collapsed (D-46 §3 step 4): the
 * work items, the gate runs, usage and impact notes, the changed files.
 */
import type { DemoModel } from '@/lib/bridge-client';
import { eyebrow, wiTag } from './styles';

export function GateDetails({ model }: { model: DemoModel }): JSX.Element {
  const bullets = model.summary?.bullets ?? [];
  const tests = model.testEvidence ?? [];
  const files = model.filesChanged ?? [];
  const heading: React.CSSProperties = { margin: '0 0 var(--space-2)', fontFamily: 'var(--font-display)', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' };
  const list: React.CSSProperties = { margin: 0, paddingLeft: 'var(--space-5)', overflowWrap: 'anywhere' };
  return (
    <details data-section="demo-details" style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
      <summary style={{ cursor: 'pointer', padding: 'var(--space-3) var(--space-4)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--dim)' }}>
        Work items, gate runs and changed files
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 400, fontSize: 'var(--text-xs)', color: 'var(--faint)', marginLeft: 'var(--space-3)' }}>
          {bullets.length} work items · {tests.length} gate runs · {model.diffStat}
        </span>
      </summary>
      <div style={{ padding: '0 var(--space-4) var(--space-4)', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>
        <div data-section="demo-summary">
          <h3 style={heading}>Work items</h3>
          <ul style={list}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
          {/* demo.json is agent-authored data: only an http(s) URL becomes a link (a javascript: href would run on click). */}
          {model.summary?.prUrl && (
            <p style={{ margin: 'var(--space-2) 0 0', overflowWrap: 'anywhere' }}>
              {/^https?:\/\//i.test(model.summary.prUrl)
                ? <a href={model.summary.prUrl} target="_blank" rel="noreferrer">{model.summary.prUrl}</a>
                : model.summary.prUrl}
            </p>
          )}
          {(model.impact?.length ?? 0) > 0 && (
            <>
              <div style={{ ...eyebrow, margin: 'var(--space-3) 0 var(--space-1)' }}>Impact</div>
              <ul style={list}>{model.impact!.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </>
          )}
        </div>
        <div data-section="demo-test-evidence">
          <h3 style={heading}>Gate runs</h3>
          <ul style={list}>
            {tests.map((t, i) => (
              <li key={i}>
                <span style={{ color: t.result === 'pass' ? 'var(--green)' : t.result === 'fail' ? 'var(--red)' : 'var(--faint)', fontWeight: 600 }}>{t.result}</span>{' '}
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{t.name}</code>
              </li>
            ))}
          </ul>
          {model.usage_example && (
            <>
              <div style={{ ...eyebrow, margin: 'var(--space-3) 0 var(--space-1)' }}>Usage</div>
              <pre style={{ margin: 0, maxHeight: 'var(--pane-sm)', overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{model.usage_example}</pre>
            </>
          )}
        </div>
        <div>
          <h3 style={heading}>Changed files <span style={wiTag}>{model.baseRef ?? 'main'}..{model.changedRef?.slice(0, 7) ?? 'HEAD'}</span></h3>
          <ul style={{ ...list, maxHeight: 'var(--pane-lg)', overflowY: 'auto' }}>
            {files.map((f, i) => <li key={i}><code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--steel)' }}>{f.path}</code>{f.note ? ` — ${f.note}` : ''}</li>)}
          </ul>
        </div>
      </div>
    </details>
  );
}
