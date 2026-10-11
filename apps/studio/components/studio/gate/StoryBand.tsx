/**
 * The verdict gate's story (forge-mfv5.1.31): the demo planner's one-line
 * "what this enables", labelled as agent narrative and never evidence (D-45),
 * over six facts read from the run's own artifacts. When no narrative was
 * planned, the orchestrator's measured essence line stands in, unlabelled as
 * narrative because it is not one.
 */
import { pane, eyebrow, word } from './styles';

export type GateFacts = {
  gates: { pass: number; total: number; names: string };
  deltas: Record<string, number>;
  verdicts: Record<string, number>;
  severities: Record<string, number>;
  diff: { files: number; insertions: number; deletions: number } | null;
  diffStat: string;
  costUsd: number | null;
  headSha: string | undefined;
};

const n = (x: number | undefined): number => x ?? 0;
const fmt = (x: number): string => x.toLocaleString('en-US');

export function StoryBand({ narrative, essence, facts }: { narrative: string | undefined; essence: string; facts: GateFacts }): JSX.Element {
  const { gates, deltas, verdicts, severities, diff } = facts;
  const cells: Array<{ key: string; label: string; value: string; sub: string; colour: string }> = [
    { key: 'gates', label: 'Gates', value: gates.total ? `${gates.pass} / ${gates.total} pass` : 'none run', sub: gates.names, colour: gates.total && gates.pass === gates.total ? 'var(--green)' : gates.total ? 'var(--red)' : 'var(--dim)' },
    { key: 'checkpoints', label: 'Checkpoints', value: `${n(deltas.changed)} changed`, sub: `${n(deltas.unchanged)} unchanged · ${n(deltas.unknown)} unknown`, colour: 'var(--ember)' },
    { key: 'criteria', label: 'Criteria · reviewer', value: `${n(verdicts.met)} met`, sub: `${n(verdicts.partial)} partial · ${n(verdicts.missed)} missed`, colour: 'var(--green)' },
    { key: 'findings', label: 'Findings', value: `${n(severities.major)} major`, sub: `${n(severities.blocker)} blocker · ${n(severities.minor)} minor · ${n(severities.info)} info`, colour: n(severities.blocker) > 0 ? 'var(--red)' : 'var(--amber)' },
    { key: 'diff', label: 'Diff', value: diff ? `${fmt(diff.files)} files` : '—', sub: diff ? `+${fmt(diff.insertions)} −${fmt(diff.deletions)}` : facts.diffStat, colour: 'var(--text)' },
    { key: 'cost', label: 'Run cost', value: facts.costUsd !== null ? `$${facts.costUsd.toFixed(2)}` : 'not recorded', sub: facts.headSha ? `head ${facts.headSha.slice(0, 7)}` : '', colour: 'var(--text)' },
  ];
  return (
    <div style={{ ...pane, padding: 'var(--space-4) var(--space-5)', gap: 'var(--space-3)' }}>
      <div data-section="demo-narrative" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={eyebrow}>
          {narrative ? 'What this enables' : 'Summary'}
          {narrative && (
            <span data-narrative-label style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, textTransform: 'none', letterSpacing: 0, color: 'var(--violet)', border: '1px dashed var(--violet)', borderRadius: 'var(--radius-sm)', padding: '0 var(--space-2)' }}>
              agent narrative — not evidence
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', lineHeight: 1.45, color: 'var(--text)', overflowWrap: 'anywhere' }}>
          {narrative || essence}
        </p>
      </div>
      <dl data-section="gate-facts" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
        {cells.map((c, i) => (
          <div key={c.key} data-fact={c.key} style={{ background: 'var(--bg-2)', borderLeft: i === 0 ? 0 : '1px solid var(--line)', padding: 'var(--space-2) var(--space-3)', minWidth: 0 }}>
            <dt style={{ ...word, letterSpacing: '.08em', color: 'var(--faint)' }}>{c.label}</dt>
            <dd style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-lg)', color: c.colour }}>
              {c.value}
              <small style={{ display: 'block', fontFamily: 'var(--font-mono)', fontWeight: 400, fontSize: 'var(--text-xs)', color: 'var(--dim)', overflowWrap: 'anywhere' }}>{c.sub}</small>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
