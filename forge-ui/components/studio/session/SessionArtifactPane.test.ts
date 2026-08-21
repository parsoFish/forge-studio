/**
 * W7-C2 (sessions-kinds-30) — DOM pins for SessionArtifactPane's
 * markdown-draft renderer gaining VERDICT CONTEXT: the destination the
 * approve will write to, and a draft-vs-current diff affordance when the
 * session is editing an existing file. Rendered via renderToStaticMarkup,
 * mirroring SessionInteractivePanel.test.ts's own pattern (initial-render
 * pins only — no jsdom in this suite).
 *
 * RUN: npx vitest run components/studio/session/SessionArtifactPane.test.ts   (from forge-ui/)
 */

import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionArtifactPane } from './SessionArtifactPane';
import type { SessionArtifactPayload } from '@/lib/session-client';

const DRAFT_ARTIFACT: SessionArtifactPayload = {
  kind: 'markdown-draft',
  label: 'AGENTS.md draft',
  body: '# AGENTS.md\n\nUse npm test as the gate.\n',
  hasDraft: true,
};

function render(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    React.createElement(SessionArtifactPane, { artifact: DRAFT_ARTIFACT, ...props } as never),
  );
}

test('C2-PANE-1: draftContext.targetPath renders the destination the approve will write (never an unlabeled irreversible write)', () => {
  const html = render({
    draftContext: { targetPath: '/home/x/projects/demo-project/AGENTS.md', current: null },
  });
  expect(html).toContain('data-draft-target');
  expect(html).toContain('/home/x/projects/demo-project/AGENTS.md');
});

test('C2-PANE-2: edit mode (current !== null) offers the diff view toggle; init mode (current === null) does not', () => {
  const edit = render({
    draftContext: { targetPath: '/p/AGENTS.md', current: '# AGENTS.md\n\nOld body.\n' },
  });
  expect(edit).toContain('data-action="draft-view-diff"');

  const init = render({
    draftContext: { targetPath: '/p/AGENTS.md', current: null },
  });
  expect(init).not.toContain('data-action="draft-view-diff"');
});

test('C2-PANE-3: without draftContext the markdown-draft body renders exactly as before (no target line, no diff toggle)', () => {
  const html = render({});
  expect(html).toContain('data-markdown-draft-state="has-content"');
  expect(html).not.toContain('data-draft-target');
  expect(html).not.toContain('data-action="draft-view-diff"');
});
