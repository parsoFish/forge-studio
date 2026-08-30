'use client';

import { useState } from 'react';
import { filePackageTabs, fileLanguage, type PackageFile } from '@/lib/file-package';

// ---------------------------------------------------------------------------
// FilePackage — reusable file-package tab-strip renderer (R3-01-F3/F4, WI-3).
//
// Kind-agnostic (SHARED with R2-10-F3's interactive session file viewer): it
// only knows about `{path, body}` files, never about skills. All view-state
// logic lives in `lib/file-package.ts` — this component just wires that pure
// state to the DOM-as-metrics contract and renders the active file's body.
// No data fetching here; the caller owns the fetch and passes `files` down.
//
// sessions-kinds-R09 — poll-stable selection: on a session route
// (SessionShell) the caller refetches every 3s and hands us a BRAND-NEW
// `files` array each tick even when nothing changed. This component
// therefore does NOT store the derived state, and keys NO effect on `files`
// (`useEffect(() => setState(filePackageTabs(files)), [files])` was exactly
// that defect — it fired every poll tick and snapped the strip back to
// file[0] within 3s, so a review gating an irreversible brain-write could
// not be completed for any file past the first). Instead it remembers only
// the operator's chosen PATH and derives the view fresh on every render,
// looked up BY VALUE. This is GenerationGallery.tsx's already-ratified shape
// (R4-16 pin 2 / round 2 pin 3), applied to the tab strip; a new package
// (navigating to another skill's detail page) no longer carries that path,
// so `filePackageTabs` falls back to the first tab on its own.
// ---------------------------------------------------------------------------

export function FilePackage({ files }: { files: PackageFile[] }) {
  // `null` = nothing picked yet; the view's own default (first tab) applies.
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const state = filePackageTabs(files, selectedPath ?? undefined);

  const active = state.activeIndex >= 0 ? state.tabs[state.activeIndex] : null;

  return (
    <div
      data-component="file-package"
      data-file-count={state.tabs.length}
      data-active-file={active?.path ?? ''}
      style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm, 6px)', overflow: 'hidden' }}
    >
      <div
        role="tablist"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 2, background: 'var(--bg-2)', borderBottom: '1px solid var(--line)', padding: '4px 4px 0' }}
      >
        {state.tabs.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--faint)', padding: '8px 10px', fontStyle: 'italic' }}>
            No files in this package.
          </span>
        )}
        {state.tabs.map((tab, i) => {
          const isActive = i === state.activeIndex;
          return (
            <button
              key={tab.path}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-file-tab
              data-file-path={tab.path}
              onClick={() => setSelectedPath(tab.path)}
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 12,
                padding: '7px 12px',
                background: isActive ? 'var(--bg)' : 'transparent',
                color: isActive ? 'var(--text)' : 'var(--dim)',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--ember, #FF9E4A)' : '2px solid transparent',
                cursor: 'pointer',
                borderTopLeftRadius: 4,
                borderTopRightRadius: 4,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div style={{ background: 'var(--bg)', maxHeight: 480, overflow: 'auto' }}>
        {active ? (
          <pre
            data-file-language={fileLanguage(active.path)}
            style={{ margin: 0, padding: '14px 16px', fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
          >
            <code>{active.body}</code>
          </pre>
        ) : (
          <div style={{ padding: '14px 16px', fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic' }}>
            Nothing to display.
          </div>
        )}
      </div>
    </div>
  );
}
