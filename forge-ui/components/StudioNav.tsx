'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Sticky top nav mirroring mockups/agent-flow-builder/shared/shell.js.
 *
 * Nav items:
 *   Library  → /           (M1 — live)
 *   Flows    → /flows/forge-cycle  (M1-5 — live after task 5)
 *   Agents   → disabled (M2)
 *   Projects → disabled (M5)
 *   Knowledge → disabled (M5)
 *   Dashboard → /dashboard (the old dashboard, always available)
 *
 * Active link detected from usePathname(). Non-existent builder pages
 * render as disabled <span> chips with title "M2" or "M5".
 */

type NavItem =
  | { kind: 'link'; label: string; href: string; id: string }
  | { kind: 'disabled'; label: string; title: string; id: string };

const NAV_ITEMS: NavItem[] = [
  { kind: 'link', label: 'Library', href: '/', id: 'library' },
  { kind: 'link', label: 'Flows', href: '/flows/forge-cycle', id: 'flows' },
  { kind: 'disabled', label: 'Agents', title: 'M2', id: 'agents' },
  { kind: 'disabled', label: 'Projects', title: 'M5', id: 'projects' },
  { kind: 'disabled', label: 'Knowledge', title: 'M5', id: 'knowledge' },
];

export function StudioNav() {
  const pathname = usePathname();

  function isActive(item: NavItem): boolean {
    if (item.kind !== 'link') return false;
    if (item.href === '/') return pathname === '/';
    return pathname.startsWith(item.href);
  }

  return (
    <nav className="afb-nav" data-component="studio-nav">
      <Link className="afb-brand" href="/">
        <span className="hex-mark" />
        FORGE&nbsp;STUDIO <span className="sub">/ modular agent flows</span>
      </Link>

      <div className="afb-nav-links">
        {NAV_ITEMS.map((item) => {
          if (item.kind === 'disabled') {
            return (
              <span
                key={item.id}
                className="nav-disabled"
                data-nav={item.id}
                title={item.title}
                role="link"
                aria-disabled="true"
                aria-label={`${item.label} — coming in milestone ${item.title}`}
              >
                {item.label}
              </span>
            );
          }
          return (
            <Link
              key={item.id}
              href={item.href}
              className={isActive(item) ? 'active' : undefined}
              data-nav={item.id}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <Link
        href="/dashboard"
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--dim)',
          padding: '6px 14px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--line)',
          textDecoration: 'none',
        }}
        data-nav="dashboard"
      >
        Dashboard
      </Link>
    </nav>
  );
}
