'use client';

import { useEffect, useState } from 'react';
import { fetchSkillLibrary, type SkillLibraryEntry } from '@/lib/skill-client';
import { fetchHookLibrary, type HookLibraryEntry } from '@/lib/hook-client';
import { fetchConnections, type ConnectionWire } from '@/lib/connection-client';
import { fetchTemplateLibrary, type TemplateLibraryEntry } from '@/lib/template-client';
import { fetchCommunityIndex, type CommunityHubWithCount, type CommunityItem } from '@/lib/community-client';
import { LibraryHub, type ShelfStatus } from '@/components/studio/LibraryHub';

// ---------------------------------------------------------------------------
// Library page — the thin fetch-owning wrapper around the pure `LibraryHub`
// body (W6-IA-4). Mirrors `app/projects/page.tsx`'s own precedent exactly:
// `LibraryHub` renders `<StudioPage>` (which renders `<StudioNav>`)
// internally, so this wrapper does not render its own separate copy —
// `lib/library-hub-render.test.ts` mocks `next/navigation`'s `usePathname`
// the same way `lib/projects-index-render.test.ts` does for its own sibling
// `<StudioPage>`-embedding body. Every one of the five shelves runs its OWN
// INDEPENDENT fetch — reusing the EXACT SAME fetcher each shelf's own full
// library page
// already calls (`fetchSkillLibrary`/`fetchHookLibrary`/`fetchConnections`/
// `fetchTemplateLibrary`/`fetchCommunityIndex`) — so a slow or broken shelf
// never blocks the other four from rendering their own honest state (the
// same "each surface fails independently" discipline `/skills`'s own
// community-join fetch already establishes).
//
// Unlike the OLD Library landing page (which byte-duplicated Home's
// six-fetch loadAll/refreshRuns/subscribe() shape — sweep finding C1#5, now
// extracted into `lib/use-studio-home-data.ts`), this page needs NONE of
// those six reads: the five shelves read entirely different sources, and
// Library carries no live-refresh subscription of its own.
// ---------------------------------------------------------------------------

export default function LibraryPage() {
  const [skillsStatus, setSkillsStatus] = useState<ShelfStatus>('loading');
  const [skills, setSkills] = useState<SkillLibraryEntry[]>([]);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const [hooksStatus, setHooksStatus] = useState<ShelfStatus>('loading');
  const [hooks, setHooks] = useState<HookLibraryEntry[]>([]);
  const [hooksError, setHooksError] = useState<string | null>(null);

  const [connectionsStatus, setConnectionsStatus] = useState<ShelfStatus>('loading');
  const [connections, setConnections] = useState<ConnectionWire[]>([]);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);

  const [templatesStatus, setTemplatesStatus] = useState<ShelfStatus>('loading');
  const [templates, setTemplates] = useState<TemplateLibraryEntry[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [communityStatus, setCommunityStatus] = useState<ShelfStatus>('loading');
  const [communityHubs, setCommunityHubs] = useState<CommunityHubWithCount[]>([]);
  const [communityItems, setCommunityItems] = useState<CommunityItem[]>([]);
  const [communityError, setCommunityError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchSkillLibrary().then((r) => {
      if (cancelled) return;
      if (!r.ok) { setSkillsStatus('error'); setSkillsError(r.error ?? 'could not reach the forge bridge'); return; }
      setSkills(r.skills);
      setSkillsStatus('ready');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchHookLibrary().then((r) => {
      if (cancelled) return;
      if (!r.ok) { setHooksStatus('error'); setHooksError(r.error ?? 'could not reach the forge bridge'); return; }
      setHooks(r.hooks);
      setHooksStatus('ready');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchConnections().then((r) => {
      if (cancelled) return;
      if (!r.ok) { setConnectionsStatus('error'); setConnectionsError(r.error ?? 'could not reach the forge bridge'); return; }
      setConnections(r.connections);
      setConnectionsStatus('ready');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchTemplateLibrary().then((r) => {
      if (cancelled) return;
      if (!r.ok) { setTemplatesStatus('error'); setTemplatesError(r.error ?? 'could not reach the forge bridge'); return; }
      setTemplates(r.templates);
      setTemplatesStatus('ready');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchCommunityIndex().then((r) => {
      if (cancelled) return;
      if (!r.ok) { setCommunityStatus('error'); setCommunityError(r.error ?? 'could not reach the forge bridge'); return; }
      setCommunityHubs(r.hubs);
      setCommunityItems(r.items);
      setCommunityStatus('ready');
    });
    return () => { cancelled = true; };
  }, []);

  const ready = skillsStatus !== 'loading'
    && hooksStatus !== 'loading'
    && connectionsStatus !== 'loading'
    && templatesStatus !== 'loading'
    && communityStatus !== 'loading';

  return (
    <LibraryHub
      ready={ready}
      skills={{ status: skillsStatus, entries: skills, error: skillsError }}
      hooks={{ status: hooksStatus, entries: hooks, error: hooksError }}
      connections={{ status: connectionsStatus, entries: connections, error: connectionsError }}
      templates={{ status: templatesStatus, entries: templates, error: templatesError }}
      community={{ status: communityStatus, hubs: communityHubs, items: communityItems, error: communityError }}
    />
  );
}
