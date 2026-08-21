'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StudioPage } from '@/components/StudioPage';
import { AuthoringLauncher } from '@/components/AuthoringLauncher';
import { createHook, HOOK_LIFECYCLE_EVENTS, type HookLifecycleEvent } from '@/lib/hook-client';
import { fetchStudioProjects } from '@/lib/studio-client';
import { disabledAttrs } from '@/lib/disabled-reason';

// ---------------------------------------------------------------------------
// Hook builder — /hooks/new (R3-03-F4). Mirrors /skills/new exactly. Author
// a new library hook: name, description, lifecycle event, optional matcher,
// the script body, and its declared permission manifest. Binding to an agent
// happens only in the Agent Builder (round-4 mockup rule) — this page never
// offers a "bind to agent" affordance.
// ---------------------------------------------------------------------------

export default function HookBuilderPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [on, setOn] = useState<HookLifecycleEvent>('PreToolUse');
  const [matcher, setMatcher] = useState('');
  const [scriptBody, setScriptBody] = useState('#!/usr/bin/env bash\n');
  const [permEnv, setPermEnv] = useState('');
  const [permRead, setPermRead] = useState('');
  const [permNetwork, setPermNetwork] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [knownProjects, setKnownProjects] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchStudioProjects()
      .then((projects) => { if (!cancelled) setKnownProjects(projects.map((p) => p.name).filter(Boolean).sort()); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const canSubmit = name.trim().length > 0 && description.trim().length > 0 && scriptBody.trim().length > 0;

  async function onSubmit() {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    const r = await createHook({
      name: name.trim(),
      description: description.trim(),
      on,
      ...(matcher.trim() ? { matcher: matcher.trim() } : {}),
      scriptBody,
      permissions: {
        env: permEnv.split(',').map((s) => s.trim()).filter(Boolean),
        read: permRead.split(',').map((s) => s.trim()).filter(Boolean),
        network: permNetwork,
      },
    });
    if (r.ok && r.id) {
      router.push(`/hooks/${encodeURIComponent(r.id)}`);
    } else {
      setError(r.error ?? 'could not create the hook');
      setSaving(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--dim)', display: 'block', marginBottom: 5 };
  const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontSize: 13, padding: '8px 11px', boxSizing: 'border-box' };

  return (
    <StudioPage
      dataPage="hook-builder"
      ready
      section="hook-new"
      maxWidth={620}
      padding="40px 28px 64px"
      title="New hook"
      lede={
        <>
          A hook is a script an agent runs on a lifecycle event. Every hook is scanned before it
          can run — declare exactly what it needs (env vars, paths, network) so the scan can tell
          declared access from undeclared access.
        </>
      }
    >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={labelStyle} htmlFor="hk-name">Name</label>
            <input id="hk-name" data-field="hook-name" style={inputStyle} value={name} placeholder="e.g. pre-pr-security-review"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="hk-desc">Description</label>
            <input id="hk-desc" data-field="hook-description" style={inputStyle} value={description}
              placeholder="One line — what this hook does + when it fires" onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="hk-on">Lifecycle event</label>
            <select id="hk-on" data-field="hook-on" style={inputStyle} value={on}
              onChange={(e) => setOn(e.target.value as HookLifecycleEvent)}>
              {HOOK_LIFECYCLE_EVENTS.map((ev) => (
                <option key={ev} value={ev}>{ev}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="hk-matcher">Matcher (optional)</label>
            <input id="hk-matcher" data-field="hook-matcher" style={inputStyle} value={matcher}
              placeholder="e.g. Bash(gh pr create)" onChange={(e) => setMatcher(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="hk-script">Script</label>
            <textarea id="hk-script" data-field="hook-script-body" rows={8} style={{ ...inputStyle, fontFamily: 'var(--font-mono, monospace)' }} value={scriptBody}
              onChange={(e) => setScriptBody(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Permissions</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label htmlFor="hk-perm-env" style={{ fontSize: 11, color: 'var(--faint)', display: 'block', marginBottom: 4 }}>env vars (comma-separated)</label>
                <input id="hk-perm-env" data-field="hook-permissions-env" style={inputStyle} value={permEnv}
                  placeholder="e.g. GH_TOKEN, MY_API_KEY" onChange={(e) => setPermEnv(e.target.value)} />
              </div>
              <div>
                <label htmlFor="hk-perm-read" style={{ fontSize: 11, color: 'var(--faint)', display: 'block', marginBottom: 4 }}>path prefixes (comma-separated)</label>
                <input id="hk-perm-read" data-field="hook-permissions-read" style={inputStyle} value={permRead}
                  placeholder="e.g. ./projects" onChange={(e) => setPermRead(e.target.value)} />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--dim)' }}>
                <input type="checkbox" data-field="hook-permissions-network" checked={permNetwork}
                  onChange={(e) => setPermNetwork(e.target.checked)} />
                network egress
              </label>
            </div>
          </div>
          {error && <div style={{ fontSize: 12.5, color: 'var(--red)' }}>{error}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn btn-primary" data-action="create-hook" onClick={() => void onSubmit()}
              {...disabledAttrs(saving ? 'Creating…' : !canSubmit ? 'Fill in the required fields first' : null)} style={{ opacity: canSubmit && !saving ? 1 : 0.5 }}>
              {saving ? 'Creating…' : 'Create hook →'}
            </button>
            {!canSubmit && <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>Name, description + script are required.</span>}
          </div>
          <AuthoringLauncher
            knownProjects={knownProjects}
            onStarted={(sessionId, project) =>
              router.push(`/sessions/authoring/${encodeURIComponent(sessionId)}?project=${encodeURIComponent(project)}`)
            }
          />
        </div>
    </StudioPage>
  );
}
