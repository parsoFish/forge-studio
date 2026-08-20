/**
 * Acceptance tests — the rebuilt `/library` page (W6-IA-4).
 *
 * `forge-ui/app/library/page.tsx` used to be a full landing page: hero,
 * Operator Pulse mini-panel, a cross-project attention strip, and four
 * shelves (projects/agents/flows/knowledge bases) — all of which now have
 * their own real index routes (`/projects` IA-1, `/agents` IA-3, `/flows`
 * IA-2, `/knowledge`). This file pins the REPLACEMENT:
 * `components/studio/LibraryHub.tsx`'s `LibraryHub` — a pure, props-driven
 * presentational component (no fetch, no `useEffect`) rendered via
 * `react-dom/server`'s `renderToStaticMarkup`, mirroring
 * `./projects-index-render.test.ts`'s own precedent exactly (same
 * `next/navigation` mock rationale: `LibraryHub` renders `<StudioPage>`,
 * which always renders `<StudioNav>`, which calls `usePathname()` — `null`
 * outside a mounted Next.js app router, crashing `.startsWith(...)`).
 *
 * RUN: npx vitest run lib/library-hub-render.test.ts   (from forge-ui/)
 */
import { test, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  usePathname: () => '/library',
}));

import { LibraryHub, LIBRARY_SHELF_CARD_LIMIT, type LibraryHubProps } from '@/components/studio/LibraryHub';
import type { SkillLibraryEntry } from './skill-client.ts';
import type { HookLibraryEntry } from './hook-client.ts';
import type { ConnectionWire } from './connection-client.ts';
import type { TemplateLibraryEntry } from './template-client.ts';
import type { CommunityItem } from './community-client.ts';

// ---------------------------------------------------------------------------
// Fixtures — minimal, real-shaped entries for each of the five shelves.
// ---------------------------------------------------------------------------

function makeSkill(id: string, overrides: Partial<SkillLibraryEntry> = {}): SkillLibraryEntry {
  return {
    id, name: id, description: '', source: 'local', trust: 'ready', installed: true,
    usedBy: [], paletteVisible: true, provenance: null,
    ...overrides,
  };
}

function makeHook(id: string, overrides: Partial<Extract<HookLibraryEntry, { ok: true }>> = {}): HookLibraryEntry {
  return {
    ok: true, id, name: id, description: '', on: 'PreToolUse', carriedBy: [],
    carriedByDerivation: { source: 'agents', scanned: 0 },
    permissions: { env: [], read: [], network: false },
    trust: 'approved', scanVerdict: 'clean', runnable: true,
    ...overrides,
  };
}

function makeConnection(id: string, overrides: Partial<ConnectionWire> = {}): ConnectionWire {
  return {
    id, name: id, kind: 'tool', desc: '', usedBy: [],
    installable: true,
    install: { method: 'system-provided' },
    config: [],
    probe: { state: 'available' },
    provenance: 'ootb',
    usedByDerivation: { source: 'agents', scanned: 0 },
    ...overrides,
  };
}

function makeTemplate(id: string, overrides: Partial<TemplateLibraryEntry> = {}): TemplateLibraryEntry {
  return {
    id, name: id, description: '', category: 'planning',
    provenance: 'ootb', definitionRef: `templates/${id}`,
    usedBy: [], usedByDerivation: { scanned: 0, source: 'flows' },
    ...overrides,
  };
}

function makeCommunityItem(id: string, overrides: Partial<CommunityItem> = {}): CommunityItem {
  return {
    id, kind: 'skill', name: id, desc: '', upstream: '', hub: null, signals: null,
    vendored: false, installState: 'not-installed', probeState: null, origin: 'catalog',
    ...overrides,
  };
}

const EMPTY_READY_PROPS: LibraryHubProps = {
  ready: true,
  skills: { status: 'ready', entries: [], error: null },
  hooks: { status: 'ready', entries: [], error: null },
  connections: { status: 'ready', entries: [], error: null },
  templates: { status: 'ready', entries: [], error: null },
  community: { status: 'ready', hubs: [], items: [], error: null },
};

function render(props: LibraryHubProps): string {
  return renderToStaticMarkup(React.createElement(LibraryHub, props));
}

// ---------------------------------------------------------------------------
// data-page identity + readiness
// ---------------------------------------------------------------------------

test('data-page="library" is present before any shelf has settled (ready=false)', () => {
  const html = render({
    ready: false,
    skills: { status: 'loading', entries: [], error: null },
    hooks: { status: 'loading', entries: [], error: null },
    connections: { status: 'loading', entries: [], error: null },
    templates: { status: 'loading', entries: [], error: null },
    community: { status: 'loading', hubs: [], items: [], error: null },
  });
  expect(html).toContain('data-page="library"');
  expect(html).toContain('data-page-ready="false"');
});

test('data-page-ready="true" once every shelf has settled', () => {
  const html = render(EMPTY_READY_PROPS);
  expect(html).toContain('data-page-ready="true"');
});

// ---------------------------------------------------------------------------
// Five shelves, in the operator-locked order: Skills / Hooks / Connections /
// Templates / Community — each with real counts + entries.
// ---------------------------------------------------------------------------

test('all five shelves render, in the operator-locked order Skills / Hooks / Connections / Templates / Community', () => {
  const html = render(EMPTY_READY_PROPS);
  for (const section of ['skills', 'hooks', 'connections', 'templates', 'community']) {
    expect(html).toContain(`data-section="${section}"`);
  }
  const order = ['skills', 'hooks', 'connections', 'templates', 'community']
    .map((s) => html.indexOf(`data-section="${s}"`));
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test('the Skills shelf renders a real count from groupSkillLibrary and a card per entry, up to the shelf limit', () => {
  const entries = Array.from({ length: 3 }, (_, i) => makeSkill(`skill-${i}`));
  const html = render({ ...EMPTY_READY_PROPS, skills: { status: 'ready', entries, error: null } });
  expect(html).toContain('data-section="skills" data-count="3"');
  expect((html.match(/data-card-type="skill"/g) ?? []).length).toBe(3);
  expect(html).toContain('href="/skills/skill-0"');
});

test('the Skills shelf caps rendered cards at LIBRARY_SHELF_CARD_LIMIT even when the count is higher', () => {
  const entries = Array.from({ length: LIBRARY_SHELF_CARD_LIMIT + 5 }, (_, i) => makeSkill(`skill-${i}`));
  const html = render({ ...EMPTY_READY_PROPS, skills: { status: 'ready', entries, error: null } });
  expect(html).toContain(`data-count="${LIBRARY_SHELF_CARD_LIMIT + 5}"`);
  expect((html.match(/data-card-type="skill"/g) ?? []).length).toBe(LIBRARY_SHELF_CARD_LIMIT);
});

test('the Hooks shelf renders a real count and a card per entry', () => {
  const entries = [makeHook('h1'), makeHook('h2')];
  const html = render({ ...EMPTY_READY_PROPS, hooks: { status: 'ready', entries, error: null } });
  expect(html).toContain('data-section="hooks" data-count="2"');
  expect((html.match(/data-card-type="hook"/g) ?? []).length).toBe(2);
});

test('the Connections shelf renders a real count and a card per entry', () => {
  const entries = [makeConnection('gh'), makeConnection('playwright', { kind: 'mcp' })];
  const html = render({ ...EMPTY_READY_PROPS, connections: { status: 'ready', entries, error: null } });
  expect(html).toContain('data-section="connections" data-count="2"');
  expect((html.match(/data-card-type="connection"/g) ?? []).length).toBe(2);
});

test('the Templates shelf renders a real count and a card per entry', () => {
  const entries = [makeTemplate('t1'), makeTemplate('t2', { category: 'demo-output' })];
  const html = render({ ...EMPTY_READY_PROPS, templates: { status: 'ready', entries, error: null } });
  expect(html).toContain('data-section="templates" data-count="2"');
  expect((html.match(/data-card-type="template"/g) ?? []).length).toBe(2);
});

test('the Community shelf renders a real item count and a card per item', () => {
  const items = [makeCommunityItem('c1'), makeCommunityItem('c2', { kind: 'hook' })];
  const html = render({ ...EMPTY_READY_PROPS, community: { status: 'ready', hubs: [], items, error: null } });
  expect(html).toContain('data-section="community" data-count="2"');
  expect((html.match(/data-card-type="community-item"/g) ?? []).length).toBe(2);
});

// ---------------------------------------------------------------------------
// Create CTAs — Skills, Hooks and (W7-B4, library-17) Templates. Connections
// stay curation-by-PR; Community gets a browse entry, never a create CTA.
// ---------------------------------------------------------------------------

test('Skills, Hooks and Templates each carry a create CTA routing to their real builder', () => {
  const html = render(EMPTY_READY_PROPS);
  expect(html).toContain('data-action="new-skill"');
  expect(html).toContain('href="/skills/new"');
  expect(html).toContain('data-action="new-hook"');
  expect(html).toContain('href="/hooks/new"');
  // W7-B4 (library-17/library-01): templates are authorable now.
  expect(html).toContain('data-action="new-template"');
  expect(html).toContain('href="/templates/new"');
});

test('Connections carry NO create CTA — curation by PR to studio/catalog.yaml only', () => {
  const html = render(EMPTY_READY_PROPS);
  expect(html).not.toContain('data-action="new-connection"');
});

test('Community carries a "Browse community" entry, never a create CTA', () => {
  const html = render(EMPTY_READY_PROPS);
  expect(html).toContain('data-action="browse-community"');
  expect(html).not.toContain('data-action="new-community"');
});

// ---------------------------------------------------------------------------
// Removed surfaces — the old landing page's hero/pulse/attention/shelves
// ---------------------------------------------------------------------------

test('the old landing-page surfaces (hero pulse, attention strip, projects/agents/flows/kbs shelves) are GONE', () => {
  const html = render(EMPTY_READY_PROPS);
  expect(html).not.toContain('data-pulse-flows');
  expect(html).not.toContain('data-section="attention-strip"');
  expect(html).not.toContain('data-section="projects"');
  expect(html).not.toContain('data-section="agents"');
  expect(html).not.toContain('data-section="flows"');
  expect(html).not.toContain('data-section="kbs"');
  expect(html).not.toContain('data-section="orientation"');
  expect(html).not.toContain('data-first-run');
});

// ---------------------------------------------------------------------------
// KB cross-link card — REMOVED (W7-B4, library-02: operator note 9 asked for
// its removal; the pillar nav already carries Knowledge, the card duplicated
// it).
// ---------------------------------------------------------------------------

test('the KB cross-link card is GONE — the nav owns the Knowledge pillar (library-02)', () => {
  const html = render(EMPTY_READY_PROPS);
  expect(html).not.toContain('data-section="kb-crosslink"');
  expect(html).not.toContain('data-action="kb-crosslink"');
});

// ---------------------------------------------------------------------------
// Installed marker — W7-B4 (library-04): the DOM attribute must have a
// HUMAN-VISIBLE counterpart on every skill card.
// ---------------------------------------------------------------------------

test('a skill card renders a visible install-state marker, not just a data attribute (library-04)', () => {
  const html = render({
    ...EMPTY_READY_PROPS,
    skills: {
      status: 'ready',
      entries: [
        makeSkill('local-one', { installed: true }),
        makeSkill('community-gap', { source: 'community', installed: false, paletteVisible: false }),
      ],
      error: null,
    },
  });
  expect(html).toContain('data-component="install-state"');
  expect(html).toMatch(/data-component="install-state"[^>]*data-installed="true"/);
  expect(html).toMatch(/data-component="install-state"[^>]*data-installed="false"/);
});

// ---------------------------------------------------------------------------
// Independent shelf failure — one dead bridge route must not blank the rest
// ---------------------------------------------------------------------------

test('a failed Connections fetch renders that shelf\'s own error state without blanking the other four', () => {
  const html = render({
    ...EMPTY_READY_PROPS,
    skills: { status: 'ready', entries: [makeSkill('s1')], error: null },
    connections: { status: 'error', entries: [], error: 'bridge unreachable' },
  });
  expect(html).toContain('data-component="connections-error"');
  expect(html).toContain('data-card-type="skill"');
});
