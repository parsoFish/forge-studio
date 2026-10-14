'use client';

/**
 * forge-mfv5.1.32 — the demo means and the live-acceptance tier, edited on the project page and saved
 * with it. The demo-builder session adds the commands its captures drive to `demoMeans` when it locks.
 * Contract: fields `demo-means-commands|routes|api-paths|api-commands|ignore-keys|run`, `acceptance-match`,
 * `acceptance-requires-env`; `[data-declarations-error]` names a refusal.
 */
import { declarationsFromForm, type DeclarationsForm } from '@/lib/project-declarations';

const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--dim)' };
const box: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', resize: 'vertical' };
const FIELDS: Array<{ key: keyof DeclarationsForm; field: string; title: string; hint: string }> = [
  { key: 'commands', field: 'demo-means-commands', title: 'Demo commands', hint: 'one per line, a bare command (no shell)' },
  { key: 'routes', field: 'demo-means-routes', title: 'Demo routes', hint: 'in-app paths, one per line' },
  { key: 'apiPaths', field: 'demo-means-api-paths', title: 'API paths', hint: 'GETs on the tree’s own server' },
  { key: 'apiCommands', field: 'demo-means-api-commands', title: 'API commands', hint: 'the project’s CLI printing JSON' },
  { key: 'ignoreKeys', field: 'demo-means-ignore-keys', title: 'Ignored keys', hint: 'volatile JSON keys, any depth' },
  { key: 'run', field: 'demo-means-run', title: 'Run prefixes', hint: 'command = in-tree prefix, e.g. gw = python3 -m gitweave.cli' },
];

export function DeclarationsEditor({ value, onChange }: { value: DeclarationsForm; onChange: (next: DeclarationsForm) => void }) {
  const verdict = declarationsFromForm(value);
  const set = (key: keyof DeclarationsForm) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => onChange({ ...value, [key]: e.target.value });
  return (
    <section data-section="project-declarations" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xs)', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)' }}>Demo means · acceptance tier</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(var(--pane-md), 1fr))', gap: 'var(--space-3)' }}>
        {FIELDS.map((f) => (
          <label key={f.key} style={label}>
            {f.title} <span style={{ color: 'var(--faint)' }}>{f.hint}</span>
            <textarea data-field={f.field} rows={2} value={value[f.key]} onChange={set(f.key)} style={box} />
          </label>
        ))}
        <label style={label}>
          Acceptance match <span style={{ color: 'var(--faint)' }}>the substring that marks a live-acceptance gate</span>
          <input data-field="acceptance-match" value={value.match} onChange={set('match')} style={box} />
        </label>
        <label style={label}>
          Requires env <span style={{ color: 'var(--faint)' }}>one variable per line</span>
          <textarea data-field="acceptance-requires-env" rows={2} value={value.requiresEnv} onChange={set('requiresEnv')} style={box} />
        </label>
      </div>
      {!verdict.ok && <p role="alert" data-declarations-error style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--red)' }}>Refused — {verdict.reason}.</p>}
    </section>
  );
}
