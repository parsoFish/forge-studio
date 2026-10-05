'use client';

/**
 * EmergencyHalt — the ONE global brake (D-03): a nav control plus a
 * full-width alert banner, both driven by the same `serve.halt` read.
 *
 *   [data-component="emergency-halt"][data-halt-state="off|on"]
 *     one button: off → `data-action="emergency-halt"` "Emergency halt";
 *                 on  → `data-action="release-halt"` "Release halt".
 *     No confirm step. A refused press shows its error inline.
 *   [data-component="emergency-halt-banner"][role="alert"][data-halt-active][data-halt-queued]
 *     present only while halted; text only — the page's single release
 *     control is the nav button.
 */
import { useState } from 'react';

import { pullEmergencyHalt, releaseEmergencyHalt, type ServeHalt } from '@/lib/bridge-client';
import { describeHalt } from '@/lib/halt-view';

export type EmergencyHaltControlViewProps = {
  halt: ServeHalt | null;
  busy?: boolean;
  error?: string | null;
  onPress: () => void;
};

export function EmergencyHaltControlView({ halt, busy = false, error = null, onPress }: EmergencyHaltControlViewProps): JSX.Element {
  const on = halt !== null;
  return (
    <div
      data-component="emergency-halt"
      data-halt-state={on ? 'on' : 'off'}
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}
    >
      <button
        type="button"
        data-action={on ? 'release-halt' : 'emergency-halt'}
        disabled={busy}
        onClick={onPress}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: '4px 10px',
          borderRadius: 6,
          cursor: busy ? 'default' : 'pointer',
          border: '1px solid var(--red)',
          color: on ? 'var(--bg)' : 'var(--red)',
          background: on ? 'var(--red)' : 'transparent',
        }}
      >
        {on ? 'Release halt' : 'Emergency halt'}
      </button>
      {error !== null && (
        <span data-halt-error role="alert" style={{ fontSize: 11.5, color: 'var(--red)' }}>{error}</span>
      )}
    </div>
  );
}

export function EmergencyHaltBanner({ halt }: { halt: ServeHalt | null }): JSX.Element | null {
  if (halt === null) return null;
  return (
    <div
      role="alert"
      data-component="emergency-halt-banner"
      data-halt-active={halt.active ?? undefined}
      data-halt-queued={halt.queued ?? undefined}
      style={{
        width: '100%',
        padding: '8px 20px',
        fontSize: 12.5,
        fontWeight: 600,
        color: 'var(--red)',
        background: 'var(--bg-2)',
        borderBottom: '2px solid var(--red)',
      }}
    >
      {describeHalt(halt)}
    </div>
  );
}

/** The nav control wired to the bridge. `refresh` re-reads serve status after a press. */
export function EmergencyHaltControl({ halt, refresh }: { halt: ServeHalt | null; refresh: () => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function press(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      if (halt === null) await pullEmergencyHalt();
      else await releaseEmergencyHalt();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
    await refresh();
  }

  return <EmergencyHaltControlView halt={halt} busy={busy} error={error} onPress={() => void press()} />;
}
