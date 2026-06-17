'use client';

/**
 * AgentPalette — left sidebar for the BUILD tab.
 * Three sections:
 *   - Agents (from fetchStudioAgents) — draggable; drop onto canvas creates a flow node
 *   - Projects (from fetchStudioProjects) — draggable (reserved for future use)
 *   - Artifact Reference (fixed catalog list) — draggable chips for edge re-labelling
 *
 * HTML5 DnD: onDragStart sets data-transfer text/plain = JSON({kind, ref}).
 * The canvas wrapper reads this in its onDrop handler.
 */

import { useEffect, useState, useCallback } from 'react';
import { fetchStudioAgents } from '@/lib/studio-client';
import type { Agent } from '@/lib/studio-client';
import { ARTIFACTS } from './ArtifactPicker';

// Encode drag payload as JSON string in data-transfer
export function encodeDragPayload(kind: 'agent' | 'project' | 'artifact', ref: string): string {
  return JSON.stringify({ kind, ref });
}

export function decodeDragPayload(raw: string): { kind: 'agent' | 'project' | 'artifact'; ref: string } | null {
  try {
    const parsed = JSON.parse(raw) as { kind: string; ref: string };
    if (parsed.kind && parsed.ref) return parsed as { kind: 'agent' | 'project' | 'artifact'; ref: string };
    return null;
  } catch {
    return null;
  }
}

type DraggableChipProps = {
  kind: 'agent' | 'project' | 'artifact';
  ref_: string;
  label: string;
  sublabel?: string;
};

function DraggableChip({ kind, ref_, label, sublabel }: DraggableChipProps): JSX.Element {
  const dotColor =
    kind === 'agent'   ? 'var(--c-agent)' :
    kind === 'project' ? 'var(--c-project)' :
    'var(--c-artifact)';

  return (
    <div
      draggable
      data-palette-chip={kind}
      data-chip-ref={ref_}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', encodeDragPayload(kind, ref_));
        (e.currentTarget as HTMLElement).style.opacity = '0.4';
      }}
      onDragEnd={(e) => {
        (e.currentTarget as HTMLElement).style.opacity = '1';
      }}
      title={sublabel}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '5px 11px',
        background: 'var(--panel-2)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 12.5,
        color: 'var(--text)',
        cursor: 'grab',
        userSelect: 'none',
        transition: 'border-color 0.12s',
        width: '100%',
        boxSizing: 'border-box',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'var(--ember)';
        el.style.background = 'rgba(255,158,74,0.08)';
        el.style.boxShadow = '0 0 0 1px rgba(255,158,74,0.18)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.style.borderColor = 'var(--line-2)';
        el.style.background = 'var(--panel-2)';
        el.style.boxShadow = 'none';
      }}
    >
      <span style={{
        width: 7,
        height: 7,
        borderRadius: kind === 'artifact' ? 2 : '50%',
        background: dotColor,
        flexShrink: 0,
      }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {kind === 'artifact'
          ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{label}</span>
          : label}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{
      padding: '10px 12px',
      borderBottom: '1px solid var(--line)',
    }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase' as const,
        color: 'var(--faint)',
        marginBottom: 8,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {children}
      </div>
    </div>
  );
}

export function AgentPalette(): JSX.Element {
  const [agents, setAgents] = useState<Agent[]>([]);

  // B2: projects are NOT part of the build tab — a flow binds to a project at
  // run-launch (from the project tab's "Run a flow"), not on the canvas.
  const load = useCallback(async (signal: { cancelled: boolean }) => {
    const ags = await fetchStudioAgents();
    if (!signal.cancelled) setAgents(ags);
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => { signal.cancelled = true; };
  }, [load]);

  return (
    <div
      data-component="agent-palette"
      style={{
        width: 240,
        flexShrink: 0,
        background: 'var(--panel)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 14px',
        borderBottom: '1px solid var(--line)',
        fontFamily: 'var(--font-display)',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        color: 'var(--dim)',
        flexShrink: 0,
      }}>
        Palette
      </div>

      {/* Agents section */}
      <Section title="Agents">
        {agents.length === 0 ? (
          <span style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic' }}>Loading…</span>
        ) : (
          agents.map((ag) => (
            <DraggableChip
              key={ag.id}
              kind="agent"
              ref_={ag.id}
              label={ag.name}
              sublabel={ag.purpose}
            />
          ))
        )}
      </Section>

      {/* Artifact Reference section */}
      <Section title="Artifact Reference">
        <p style={{ fontSize: 11, color: 'var(--faint)', margin: '0 0 8px', lineHeight: 1.5 }}>
          Drag an artifact chip onto an edge to relabel it.
        </p>
        {ARTIFACTS.map((ar) => (
          <DraggableChip
            key={ar.id}
            kind="artifact"
            ref_={ar.id}
            label={ar.name}
            sublabel={ar.desc}
          />
        ))}
      </Section>
    </div>
  );
}
