'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sticky top nav.
 *
 * Every nav item is a live link (the builders all ship — ADR-033):
 *   Library   → /
 *   Flows     → /flows/forge-develop  (a present seed flow; the library
 *               flows section is the full browser, the monitor selector lists all)
 *   Agents    → /agents/new
 *   Projects  → /projects
 *   Knowledge → /knowledge
 *
 * Active link detected from usePathname().
 */

type NavItem = { label: string; href: string; id: string };

const NAV_ITEMS: NavItem[] = [
  { label: 'Library', href: '/', id: 'library' },
  { label: 'Flows', href: '/flows/forge-develop', id: 'flows' },
  { label: 'Agents', href: '/agents/new', id: 'agents' },
  { label: 'Projects', href: '/projects', id: 'projects' },
  { label: 'Knowledge', href: '/knowledge', id: 'knowledge' },
];

export function StudioNav() {
  const pathname = usePathname();

  function isActive(item: NavItem): boolean {
    if (item.href === '/') return pathname === '/';
    // Agents nav points to /agents/new but any /agents/* route should be active
    if (item.id === 'agents')    return pathname.startsWith('/agents');
    if (item.id === 'projects')  return pathname.startsWith('/projects');
    if (item.id === 'knowledge') return pathname.startsWith('/knowledge');
    return pathname.startsWith(item.href);
  }

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
            className={isActive(item) ? 'active' : undefined}
            data-nav={item.id}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
