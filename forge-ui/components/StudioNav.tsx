'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sticky top nav — the six-pillar Studio IA.
 *
 * R6-03-F3 added the Home pillar and moved Library off `/`; W6-IA-5
 * repointed every pillar at its real per-kind browse index (once IA-1/2/3
 * built /projects, /flows, /agents) and rewrote active-pillar detection as
 * a data-driven prefix table instead of per-id special cases:
 *   Home      → /            (Home surface, R6-07 — `/` no longer redirects)
 *   Projects  → /projects
 *   Flows     → /flows       (the flows index; a specific flow's own
 *               monitor — e.g. the OOTB forge-develop flow — is reached via
 *               a card on that index, not a nav deep-link)
 *   Agents    → /agents      (the agents roster; the agent-builder is
 *               reached via a CTA on that index, not a nav deep-link)
 *   Library   → /library     (shelves-only hub — skills/hooks/connections/
 *               templates/community; that whole "library island" also
 *               lights this pillar, see ACTIVE_RULES below)
 *   Knowledge → /knowledge
 *
 * Active pillar resolved by `isNavItemActive()` from `usePathname()`.
 * Session-shell routes (`/sessions/*`, `/architect/*`, `/project-brain/*`,
 * `/instructions/*`, `/demo/*`) and `/artifact` deliberately light no
 * pillar — they're reached from within a page, not the top nav.
 */

export type NavItem = { label: string; href: string; id: string };

export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', id: 'home' },
  { label: 'Projects', href: '/projects', id: 'projects' },
  { label: 'Flows', href: '/flows', id: 'flows' },
  { label: 'Agents', href: '/agents', id: 'agents' },
  { label: 'Library', href: '/library', id: 'library' },
  { label: 'Knowledge', href: '/knowledge', id: 'knowledge' },
];

// Data-driven active-pillar table: `exact` matches only the literal path
// (Home owns the root slot and nothing else); `prefixes` matches the
// pathname itself or anything nested under it (`p` or `p/*`). Library's
// prefix list additionally carries the five-shelf "library island" — those
// routes are library sub-kinds, not separate pillars.
type ActiveRule = { exact: string } | { prefixes: string[] };

const ACTIVE_RULES: Record<string, ActiveRule> = {
  home: { exact: '/' },
  projects: { prefixes: ['/projects'] },
  flows: { prefixes: ['/flows'] },
  agents: { prefixes: ['/agents'] },
  library: { prefixes: ['/library', '/skills', '/hooks', '/connections', '/templates', '/community'] },
  knowledge: { prefixes: ['/knowledge'] },
};

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Pure, testable active-pillar check — no router, no component render. */
export function isNavItemActive(pathname: string, id: string): boolean {
  const rule = ACTIVE_RULES[id];
  if (!rule) return false;
  if ('exact' in rule) return pathname === rule.exact;
  return rule.prefixes.some((prefix) => matchesPrefix(pathname, prefix));
}

export function StudioNav() {
  const pathname = usePathname();

  return (
    <nav className="afb-nav" data-component="studio-nav">
      <Link className="afb-brand" href="/">
        <span className="hex-mark" />
        FORGE&nbsp;STUDIO <span className="sub">/ modular agent flows</span>
      </Link>

      <div className="afb-nav-links">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={isNavItemActive(pathname, item.id) ? 'active' : undefined}
            data-nav={item.id}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
