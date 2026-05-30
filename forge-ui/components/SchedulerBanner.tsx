'use client';

import { useEffect, useState } from 'react';

import {
  fetchSchedulerStatus,
  startScheduler,
  pauseScheduler,
  resumeScheduler,
  stopScheduler,
  type SchedulerStatus,
} from '@/lib/bridge-client';

/**
 * Scheduler control banner. Polls the bridge every 5s. When the daemon is
 * stopped it prompts the operator to start it; when running it exposes the
 * pause/resume toggle + stop — so the unattended loop can be driven entirely
 * from the dashboard rather than dropping to a terminal (the north-star
 * "primarily unattended, driven from the UI" goal).
 */
export function SchedulerBanner() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function poll(): Promise<void> {
    const s = await fetchSchedulerStatus();
    setStatus(s);
  }

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      const s = await fetchSchedulerStatus();
      if (!cancelled) setStatus(s);
    };
    void tick();
    const id = setInterval(() => { void tick(); }, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!status) return null;

  async function run(action: () => Promise<{ ok: boolean; error?: string }>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) setError(res.error ?? 'action failed');
      await poll();
    } finally {
      setBusy(false);
    }
  }

  const running = status.running;
  const paused = !!status.paused;
  const accent = !running ? '#d29922' : paused ? '#d29922' : '#2ea043';
  const bannerState = busy ? 'busy' : error ? 'error' : !running ? 'idle' : paused ? 'paused' : 'running';

  return (
    <div
      data-component="scheduler-banner"
      data-scheduler-running={running ? 'true' : 'false'}
      data-scheduler-paused={paused ? 'true' : 'false'}
      data-banner-state={bannerState}
      style={{
        background: '#21262d',
        border: `1px solid ${accent}`,
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
      }}
    >
      <span style={{ color: accent }}>●</span>
      <span style={{ flex: 1 }}>
        {!running
          ? "Scheduler is stopped. Queue work won't progress until you start it."
          : paused
            ? 'Scheduler paused — in-flight cycles finish, but no new work is claimed.'
            : 'Scheduler running — claiming pending work as it appears.'}
      </span>
      {error && <span style={{ color: '#f85149', fontSize: 11 }} data-banner-error>{error}</span>}

      {!running ? (
        <BannerButton action="start-scheduler" busy={busy} colour="#d29922" onClick={() => void run(startScheduler)}>
          {busy ? 'starting…' : 'Start it'}
        </BannerButton>
      ) : (
        <>
          {paused ? (
            <BannerButton action="resume-scheduler" busy={busy} colour="#2ea043" onClick={() => void run(resumeScheduler)}>
              {busy ? '…' : 'Resume'}
            </BannerButton>
          ) : (
            <BannerButton action="pause-scheduler" busy={busy} colour="#d29922" onClick={() => void run(pauseScheduler)}>
              {busy ? '…' : 'Pause'}
            </BannerButton>
          )}
          <BannerButton action="stop-scheduler" busy={busy} colour="#6e7681" onClick={() => void run(stopScheduler)}>
            {busy ? '…' : 'Stop'}
          </BannerButton>
        </>
      )}
    </div>
  );
}

function BannerButton({
  action,
  busy,
  colour,
  onClick,
  children,
}: {
  action: string;
  busy: boolean;
  colour: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      data-action={action}
      style={{
        background: colour,
        border: 'none',
        borderRadius: 6,
        padding: '6px 12px',
        fontSize: 12,
        color: '#0c1115',
        cursor: busy ? 'default' : 'pointer',
        fontWeight: 600,
        opacity: busy ? 0.7 : 1,
      }}
    >
      {children}
    </button>
  );
}
