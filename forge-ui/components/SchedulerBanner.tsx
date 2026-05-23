'use client';

import { useEffect, useState } from 'react';

import { fetchSchedulerStatus, startScheduler, type SchedulerStatus } from '@/lib/bridge-client';

/**
 * Banner that prompts the operator to start the scheduler if it's
 * stopped. Polls the bridge every 5s while visible; hides itself when
 * the daemon is running.
 */
export function SchedulerBanner() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      const s = await fetchSchedulerStatus();
      if (!cancelled) setStatus(s);
    };
    void poll();
    const id = setInterval(() => { void poll(); }, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!status) return null;
  if (status.running) return null;

  async function onStart(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const res = await startScheduler();
      if (!res.ok) setError(res.error ?? 'start failed');
    } finally {
      setStarting(false);
    }
  }

  return (
    <div
      data-component="scheduler-banner"
      data-scheduler-running="false"
      data-banner-state={starting ? 'starting' : error ? 'error' : 'idle'}
      style={{
        background: '#21262d',
        border: '1px solid #d29922',
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 13,
      }}
    >
      <span style={{ color: '#d29922' }}>●</span>
      <span style={{ flex: 1 }}>
        Scheduler is stopped. Queue work won't progress until you start it.
      </span>
      {error && <span style={{ color: '#f85149', fontSize: 11 }} data-banner-error>{error}</span>}
      <button
        onClick={() => void onStart()}
        disabled={starting}
        data-action="start-scheduler"
        style={{
          background: '#d29922',
          border: 'none',
          borderRadius: 6,
          padding: '6px 12px',
          fontSize: 12,
          color: '#0c1115',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        {starting ? 'starting…' : 'Start it'}
      </button>
    </div>
  );
}
