/**
 * knowledge-38 (forge-6gv.6.1): the `/knowledge?seedSession=<id>` banner's
 * pure copy derivation, plus the small hook that reads the session's real
 * phase — both pulled out of `app/knowledge/page.tsx` itself (which is
 * already an over-cap exemption; a ceiling, not a licence to grow further)
 * and so the copy rule is unit-testable without a DOM (this repo's forge-ui
 * vitest config is `environment: 'node'`, a standing decision).
 *
 * THE DEFECT THIS CLOSES. The banner used to render "…a seeding session is
 * running for it" off nothing but the `?seedSession=` query param's
 * PRESENCE — never a read of the session's actual phase. `startProjectBrain`
 * (bridge-client.ts's own doc comment: "phase=briefing") always mints a
 * fresh session sitting IDLE, waiting for the operator's brief — so the
 * claim was wrong on every single KB creation, not just occasionally.
 */
'use client';

import { useEffect, useState } from 'react';
import { fetchProjectBrainSessions, type ProjectBrainSession } from './bridge-client';

export type KbSeedBannerCopy = {
  /** Echoes the input `phase` verbatim — lets a caller derive its
   *  `data-seed-session-phase` attribute from this ONE return value instead
   *  of holding the phase separately too. */
  phase: ProjectBrainSession['phase'] | null;
  /** Whether the agent is genuinely doing something right now — drives
   *  `data-seed-session-running` on the page root. */
  running: boolean;
  text: string;
};

/**
 * `phase === null` means "not yet read, or the read failed" — NEVER
 * collapsed into "running" (a read failure is a fact about the READ, not a
 * fact that nothing is happening) and never collapsed into "idle" either;
 * it gets its own honest, non-committal copy.
 */
export function kbSeedBannerCopy(phase: ProjectBrainSession['phase'] | null): KbSeedBannerCopy {
  if (phase === null) {
    return { phase, running: false, text: 'This knowledge base was created and a seeding session was started for it —' };
  }
  switch (phase) {
    case 'briefing':
      return { phase, running: false, text: 'This knowledge base was created — its seeding session is waiting for your brief before analysis starts —' };
    case 'analyzing':
    case 'committing':
      return { phase, running: true, text: 'This knowledge base was created and a seeding session is running for it —' };
    case 'awaiting-review':
      return { phase, running: false, text: 'This knowledge base was created — its seeding session finished analysing and is waiting for your review —' };
    case 'committed':
    case 'abandoned':
      return { phase, running: false, text: 'This knowledge base was created — its seeding session has already finished —' };
  }
}

/**
 * Reads `seedSessionId`'s real phase once (re-run if the id itself changes)
 * — `null` while unread, and `null` again on a failed read (a fact about
 * the read, never a guessed phase; `kbSeedBannerCopy` renders both cases
 * identically, honestly). Inert (`''`/no id) never fetches at all — same
 * guard `useCycleEvents` uses for the same reason (no guaranteed-404 read
 * for a page with no seeding session to report on).
 */
export function useKbSeedSessionPhase(seedSessionId: string): ProjectBrainSession['phase'] | null {
  const [phase, setPhase] = useState<ProjectBrainSession['phase'] | null>(null);
  useEffect(() => {
    if (!seedSessionId) return;
    let cancelled = false;
    fetchProjectBrainSessions()
      .then((sessions) => {
        if (cancelled) return;
        const mine = sessions.find((s) => s.session_id === seedSessionId);
        setPhase(mine?.phase ?? null);
      })
      .catch(() => {
        if (!cancelled) setPhase(null);
      });
    return () => { cancelled = true; };
  }, [seedSessionId]);
  return phase;
}
