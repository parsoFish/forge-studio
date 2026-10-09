/**
 * forge-mfv5.1.13 — the instructions verdict panel names what approving really does.
 *
 * Found on gitweave (capstone A, 2026-10-09): editing a project whose only
 * instruction file was CLAUDE.md, the panel read "Approving writes …/CLAUDE.md
 * (replaces the current file)". Approve wrote AGENTS.md and left CLAUDE.md beside
 * it. The panel now names AGENTS.md, says whether it is new, and says which
 * instruction file is left untouched.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionArtifactPane } from '../../components/studio/session/SessionArtifactPane';
import type { SessionArtifactPayload } from '@/lib/session-client';

const DRAFT: SessionArtifactPayload = { kind: 'markdown-draft', label: 'AGENTS.md draft', body: '# AGENTS.md\n', hasDraft: true };

function render(draftContext: Record<string, unknown>): string {
  return renderToStaticMarkup(React.createElement(SessionArtifactPane, { artifact: DRAFT, draftContext } as never));
}

test('a CLAUDE.md-only project: approving writes a NEW AGENTS.md and the panel says CLAUDE.md is left as it is', () => {
  const html = render({ targetPath: '/p/AGENTS.md', current: '# old claude\n', replaces: false, leftInPlace: 'CLAUDE.md' });
  expect(html).toContain('/p/AGENTS.md');
  expect(html).toContain('(new file)');
  expect(html).not.toContain('replaces the current file');
  expect(html).toContain('data-draft-leaves="CLAUDE.md"');
  expect(html).toMatch(/CLAUDE\.md<\/code> is left as it is/);
});

test('an AGENTS.md project with a CLAUDE.md beside it: approving replaces AGENTS.md and still names the untouched CLAUDE.md', () => {
  const html = render({ targetPath: '/p/AGENTS.md', current: '# agents\n', replaces: true, leftInPlace: 'CLAUDE.md' });
  expect(html).toContain('(replaces the current file)');
  expect(html).toContain('data-draft-leaves="CLAUDE.md"');
});

test('an AGENTS.md-only project: no "left as it is" line', () => {
  const html = render({ targetPath: '/p/AGENTS.md', current: '# agents\n', replaces: true, leftInPlace: null });
  expect(html).toContain('(replaces the current file)');
  expect(html).not.toContain('data-draft-leaves');
});
