'use client';

import { FilePackage } from '@/components/studio/FilePackage';
import { DependencyDag, type DagItem } from '@/components/studio/DependencyDag';
import { roadmapDraftView, markdownDraftView } from '@/lib/session-artifact-view';
import type { SessionArtifactPayload } from '@/lib/session-client';

// ---------------------------------------------------------------------------
// SessionArtifactPane — the RIGHT-hand "living artifact" pane of the shared
// session shell (R2-10 PR2, WI-7). One module covering all three LIVE
// artifact kinds (roadmap-draft / markdown-draft / brain-structure) — mirrors
// session-artifact-view.ts's own "one module, not three files" precedent
// (they are tightly-related renderers for the SAME pane of the SAME page).
//
// Row/empty/state LOGIC is never re-implemented here: roadmap-draft and
// markdown-draft dispatch through the pure `roadmapDraftView`/`markdownDraftView`
// (lib/session-artifact-view.ts). brain-structure's `themeCount` is a direct
// passthrough field on the artifact (no derived logic to reuse), and its file
// tabs render through the SHARED `FilePackage` component — no second tab-strip
// is written here; `FilePackage` is handed the raw `files` and manages its own
// tab-selection state via the same `filePackageTabs`/`selectFile` primitives
// `lib/session-artifact-view.ts`'s (unused-by-this-component)
// `brainStructureView`/`selectBrainStructureFile` also wrap.
//
// The wrapper carries the mandated DOM-as-metrics contract
// (docs/forge-ui-dom-and-harness.md): `data-section="session-artifact"`,
// `data-artifact-kind`, `data-artifact-label` — `label` sourced straight from
// the artifact payload (R2-10 PR2's T2 Correction 1: the label lives once, in
// studio/session-kinds.yaml, threaded through the wire — never a second
// client-side kind→label lookup).
// ---------------------------------------------------------------------------

export function SessionArtifactPane({ artifact }: { artifact: SessionArtifactPayload }): JSX.Element {
  return (
    <div
      data-section="session-artifact"
      data-artifact-kind={artifact.kind}
      data-artifact-label={artifact.label}
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        background: 'var(--panel)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--line)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.05em',
          textTransform: 'uppercase',
          color: 'var(--faint)',
        }}
      >
        {artifact.label}
      </div>
      <div style={{ padding: 16, overflow: 'auto' }}>
        {artifact.kind === 'roadmap-draft' ? (
          <RoadmapDraftBody artifact={artifact} />
        ) : artifact.kind === 'markdown-draft' ? (
          <MarkdownDraftBody artifact={artifact} />
        ) : (
          <BrainStructureBody artifact={artifact} />
        )}
      </div>
    </div>
  );
}

function RoadmapDraftBody({ artifact }: { artifact: Extract<SessionArtifactPayload, { kind: 'roadmap-draft' }> }): JSX.Element {
  const view = roadmapDraftView(artifact);
  if (view.isEmpty) {
    return <EmptyNote text={view.emptyMessage ?? 'No roadmap rows yet.'} />;
  }
  // R4-15: DAG first, then the initiative table — the same layout R4-13-F1
  // specifies for the project-roadmap tab, which is why DependencyDag is a
  // shared component rather than a bespoke one here.
  const dagItems: DagItem[] = view.rows.map((row) => ({
    id: row.initiativeId,
    label: row.initiativeId,
    status: row.phase,
    dependsOn: row.dependsOn,
  }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DependencyDag items={dagItems} />
      <table data-component="roadmap-draft-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--faint)', fontSize: 11 }}>
            <th style={thStyle}>initiative</th>
            <th style={thStyle}>project</th>
            <th style={thStyle}>phase</th>
            <th style={thStyle}>origin</th>
            <th style={thStyle}>depends on</th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr
              key={row.initiativeId}
              data-roadmap-row={row.initiativeId}
              data-roadmap-depends-on={row.dependsOn.join(',')}
              style={{ borderTop: '1px solid var(--line)' }}
            >
              <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{row.initiativeId}</td>
              <td style={tdStyle}>{row.project}</td>
              <td style={tdStyle}>{row.phase}</td>
              <td style={tdStyle}>{row.origin}</td>
              <td style={tdStyle}>{row.dependsOn.length > 0 ? row.dependsOn.join(', ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownDraftBody({ artifact }: { artifact: Extract<SessionArtifactPayload, { kind: 'markdown-draft' }> }): JSX.Element {
  const view = markdownDraftView(artifact);
  if (view.state === 'no-draft') {
    return <EmptyNote data-markdown-draft-state="no-draft" text="No draft yet — the agent has not written AGENTS.draft.md." />;
  }
  if (view.state === 'empty-draft') {
    return <EmptyNote data-markdown-draft-state="empty-draft" text="The draft file exists but is currently empty." />;
  }
  return (
    <pre
      data-markdown-draft-state="has-content"
      style={{
        margin: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 12.5,
        lineHeight: 1.55,
        color: 'var(--text)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {view.body}
    </pre>
  );
}

function BrainStructureBody({ artifact }: { artifact: Extract<SessionArtifactPayload, { kind: 'brain-structure' }> }): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div data-brain-theme-count={artifact.themeCount} style={{ fontSize: 12.5, color: 'var(--dim)' }}>
        {artifact.themeCount} theme file{artifact.themeCount === 1 ? '' : 's'} seeded.
      </div>
      <FilePackage files={artifact.files} />
    </div>
  );
}

function EmptyNote({ text, ...rest }: { text: string } & Record<string, string>): JSX.Element {
  return (
    <div {...rest} style={{ fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic', padding: '6px 0' }}>
      {text}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '6px 10px 6px 0', fontWeight: 600 };
const tdStyle: React.CSSProperties = { padding: '7px 10px 7px 0', color: 'var(--text)', verticalAlign: 'top' };
