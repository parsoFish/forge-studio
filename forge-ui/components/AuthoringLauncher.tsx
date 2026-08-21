'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { startAuthoring } from '@/lib/bridge-client';
import { fetchAgentCapability, type AgentCapability } from '@/lib/studio-client';
import { KickoffModelTierPicker, allowedTiersFromCapability } from '@/components/studio/session/KickoffModelTierPicker';
import { defaultKickoffTier } from '@/lib/kickoff-view';

/**
 * R4-21 T3 (BLOCKER-2 fix) — the entry point into the creation-agent
 * authoring session. Mirrors `NewIdeaBox`'s shape exactly (project +
 * free-form description + submit → `onStarted(sessionId)`), the SAME pattern
 * every OTHER interactive-session launcher in this app uses, POSTing to the
 * SAME kind of per-kind `/start` route (`POST /api/studio/authoring/start`,
 * `startAuthoring` in `lib/bridge-client.ts`) rather than inventing a new
 * start mechanism. `project` here is scratch working-directory real estate
 * only — the generic session-shell's `<project>/_<kind>/<id>` convention
 * every kind's session dir uses — NOT what the drafted skill/hook belongs
 * to; skills and hooks are forge-wide, project-agnostic library artifacts,
 * so the copy below says so explicitly rather than implying ownership.
 *
 * Rendered from `/skills/new` and `/hooks/new` (D2 in the T3 report — the
 * closest existing precedent: a `/skills/new`/`/hooks/new` "build"
 * affordance, mirroring the mockup's `SESSIONS['build-skill']`/
 * `['build-hook']` launch point), as an alternative to those pages' own
 * manual forms — "describe it instead of filling in every field by hand".
 */
export function AuthoringLauncher({
  knownProjects = [],
  onStarted,
}: {
  knownProjects?: string[];
  /** `project` is passed alongside `sessionId` because the generic session
   *  shell (`/sessions/authoring/<sessionId>?project=<p>`) needs it in the
   *  URL — "authoring" has no per-kind summary fetch to resolve it from (the
   *  generic `SessionInteractivePanel` works entirely off the shell's own
   *  `file-package` artifact), so the caller must carry it through
   *  explicitly. */
  onStarted?: (sessionId: string, project: string) => void;
}) {
  const [project, setProject] = useState('');
  const [prompt, setPrompt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // W7-C2 (library-23) — the embedded launcher and the generic
  // /sessions/authoring/new kickoff page are two entry points into the SAME
  // POST /api/studio/authoring/start; the launcher used to silently omit
  // `modelTier`, so an operator starting from /skills/new never learned the
  // choice existed. Same picker, same capability fetch, same default rule
  // as the kickoff page — one contract, two doors.
  const [capability, setCapability] = useState<AgentCapability | null>(null);
  const [modelTier, setModelTier] = useState('');
  useEffect(() => {
    let cancelled = false;
    fetchAgentCapability('creation-agent')
      .then((cap) => {
        if (cancelled) return;
        setCapability(cap);
        setModelTier((prev) => prev || defaultKickoffTier(allowedTiersFromCapability(cap)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const isRangeTier = allowedTiersFromCapability(capability).length > 0;

  const canSubmit = project.trim().length > 0 && prompt.trim().length > 0 && !submitting;

  async function onSubmit(): Promise<void> {
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const trimmedProject = project.trim();
      const res = await startAuthoring({
        project: trimmedProject,
        prompt: prompt.trim(),
        ...(isRangeTier && modelTier ? { modelTier } : {}),
      });
      if (!res.ok) { setError(res.error ?? 'failed to start'); return; }
      setPrompt('');
      if (res.sessionId) onStarted?.(res.sessionId, trimmedProject);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div data-section="authoring-launcher" data-authoring-launcher-ready={canSubmit ? 'true' : 'false'} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--bg-2)' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
        Or describe it to the creation agent
      </div>
      <p style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.5, margin: '0 0 10px' }}>
        The creation agent drafts the whole package for you — you review and revise it, then save.
      </p>
      <input
        list="forge-authoring-known-projects"
        value={project}
        onChange={(e) => setProject(e.target.value)}
        placeholder="a project (session scratch space — not what this belongs to)"
        data-field="authoring-launcher-project"
        style={inputStyle}
      />
      <datalist id="forge-authoring-known-projects">
        {knownProjects.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe what it should do…"
        rows={3}
        data-field="authoring-launcher-prompt"
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />
      <KickoffModelTierPicker capability={capability} modelTier={modelTier} onChange={setModelTier} />
      {error && (
        <div data-authoring-launcher-error style={{ color: 'var(--red)', fontSize: 12, marginBottom: 8 }}>
          {error}
        </div>
      )}
      <button
        onClick={() => void onSubmit()}
        disabled={!canSubmit}
        data-action="start-authoring"
        className="btn btn-primary"
        style={{ opacity: canSubmit ? 1 : 0.5 }}
      >
        {submitting ? 'Starting…' : 'Start with the creation agent →'}
      </button>
      {/* W7-C2 (library-23) — the cross-link the two entry points never had:
          the generic kickoff page is the same session with the same options,
          discoverable from here instead of a parallel, unlinked door. */}
      <div style={{ marginTop: 8, fontSize: 11.5 }}>
        <Link href="/sessions/authoring/new" data-action="open-authoring-kickoff" style={{ color: 'var(--dim)' }}>
          Same thing as the authoring kickoff page →
        </Link>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  marginBottom: 10,
};
