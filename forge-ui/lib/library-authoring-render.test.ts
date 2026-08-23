/**
 * W7-B4 — render pins for the library authoring affordances:
 *
 *   library-05/08/17  every library detail page grows an Edit + Delete pair
 *                     (shared `LibraryItemActions` bar; delete is two-step,
 *                     and a server-guarded delete renders disabled WITH the
 *                     reason, never a dead button).
 *   library-09        a resolved (approved/overridden) hook renders an
 *                     approval RECORD (badge + approvedAt + reason + Revoke)
 *                     instead of nothing.
 *   library-17        the template editor is a real content editor
 *                     (`data-field="template-content"`), not read-only text.
 *   agents-22         the session entry href is DERIVED from the shared
 *                     session-kind table (lib/session-kind-meta.ts — the
 *                     yaml-parity-pinned module; B4's parallel
 *                     lib/kickoff-kinds.ts was consolidated into it at the
 *                     W7-B1 merge), never a frozen per-slug href table.
 *   agents-28/09      the agent PUT payload builder carries `create: true`
 *                     for a new agent, and duplicate-prefill clears the slug.
 *
 * Pinned RED at branch base: none of the modules exist yet.
 * RUN: npx vitest run lib/library-authoring-render.test.ts   (from forge-ui/)
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { LibraryItemActions } from '@/components/studio/LibraryItemActions';
import { ApprovalRecordPanel } from '@/components/studio/ApprovalRecordPanel';
import { TemplateEditor } from '@/components/studio/TemplateEditor';
import { sessionEntryHrefForAgent, SESSION_KIND_META } from './session-kind-meta';
import { buildAgentPutBody, parseAgentToState, duplicateAgentState } from './agent-authoring-view';
import type { Agent } from './studio-client';

// ---------------------------------------------------------------------------
// LibraryItemActions — the shared Edit / Delete bar
// ---------------------------------------------------------------------------

test('LibraryItemActions renders Edit + Delete for a deletable item', () => {
  const html = renderToStaticMarkup(
    React.createElement(LibraryItemActions, {
      kind: 'skill',
      id: 'my-skill',
      editing: false,
      onToggleEdit: () => {},
      onDelete: () => {},
    }),
  );
  expect(html).toContain('data-component="library-item-actions"');
  expect(html).toContain('data-kind="skill"');
  expect(html).toContain('data-action="edit-skill"');
  expect(html).toContain('data-action="delete-skill"');
  // Two-step: the destructive confirm is NOT rendered until armed.
  expect(html).not.toContain('data-action="confirm-delete-skill"');
});

test('LibraryItemActions — a blocked delete is disabled WITH the reason shown', () => {
  const html = renderToStaticMarkup(
    React.createElement(LibraryItemActions, {
      kind: 'hook',
      id: 'carried-hook',
      editing: false,
      onToggleEdit: () => {},
      onDelete: () => {},
      deleteBlockReason: 'carried by agent hook-carrier — unbind it first',
    }),
  );
  expect(html).toContain('data-component="delete-blocked"');
  expect(html).toContain('carried by agent hook-carrier');
  expect(html).toMatch(/data-action="delete-hook"[^>]*disabled/);
});

test('LibraryItemActions — editing state flips the edit control label/pressed state', () => {
  const html = renderToStaticMarkup(
    React.createElement(LibraryItemActions, {
      kind: 'template',
      id: 't',
      editing: true,
      onToggleEdit: () => {},
      onDelete: () => {},
    }),
  );
  expect(html).toMatch(/data-action="edit-template"[^>]*aria-pressed="true"/);
});

// ---------------------------------------------------------------------------
// ApprovalRecordPanel — library-09
// ---------------------------------------------------------------------------

test('ApprovalRecordPanel renders the approved record + Revoke', () => {
  const html = renderToStaticMarkup(
    React.createElement(ApprovalRecordPanel, {
      trust: 'approved',
      approvedAt: '2026-08-01T10:00:00.000Z',
      onRevoke: () => {},
      revoking: false,
      error: null,
    }),
  );
  expect(html).toContain('data-section="approval-record"');
  expect(html).toContain('data-hook-trust="approved"');
  expect(html).toContain('2026-08-01');
  expect(html).toContain('data-action="revoke-hook-approval"');
});

test('ApprovalRecordPanel renders an overridden record with its reason', () => {
  const html = renderToStaticMarkup(
    React.createElement(ApprovalRecordPanel, {
      trust: 'overridden',
      approvedAt: '2026-08-02T10:00:00.000Z',
      reason: 'accepted the egress risk for CI',
      onRevoke: () => {},
      revoking: false,
      error: null,
    }),
  );
  expect(html).toContain('data-hook-trust="overridden"');
  expect(html).toContain('accepted the egress risk for CI');
});

// ---------------------------------------------------------------------------
// TemplateEditor — library-17
// ---------------------------------------------------------------------------

test('TemplateEditor renders an editable content field + save/cancel', () => {
  const html = renderToStaticMarkup(
    React.createElement(TemplateEditor, {
      content: '---\nid: t\n---\nBody',
      onChange: () => {},
      onSave: () => {},
      onCancel: () => {},
      saving: false,
      error: null,
    }),
  );
  expect(html).toContain('data-field="template-content"');
  expect(html).toContain('data-action="save-template"');
  expect(html).toContain('data-action="cancel-template-edit"');
});

test('TemplateEditor surfaces a save error verbatim', () => {
  const html = renderToStaticMarkup(
    React.createElement(TemplateEditor, {
      content: 'x',
      onChange: () => {},
      onSave: () => {},
      onCancel: () => {},
      saving: false,
      error: 'studio/artifact-templates/t.md: missing required "kind"',
    }),
  );
  expect(html).toContain('missing required');
});

// ---------------------------------------------------------------------------
// kickoff-kinds — agents-22
// ---------------------------------------------------------------------------

test('sessionEntryHrefForAgent derives /sessions/<kind>/new from the ONE kickoff table', () => {
  expect(sessionEntryHrefForAgent('community-refresh')).toBe('/sessions/community-refresh/new');
  expect(sessionEntryHrefForAgent('creation-agent')).toBe('/sessions/authoring/new');
  expect(sessionEntryHrefForAgent('brain-maintenance')).toBe('/sessions/kb-cleanup/new');
  expect(sessionEntryHrefForAgent('instructions-creator')).toBe('/sessions/instructions/new');
  expect(sessionEntryHrefForAgent('demo-builder')).toBe('/sessions/demo/new');
  expect(sessionEntryHrefForAgent('project-brain-builder')).toBe('/sessions/project-brain/new');
  // architect keeps its bespoke entry (ADR-043 §4).
  expect(sessionEntryHrefForAgent('architect')).toBe('/architect/new');
  // an agent with no session kind has NO fabricated href.
  expect(sessionEntryHrefForAgent('developer-ralph')).toBeNull();
});

test('every SESSION_KIND_META row resolves back through sessionEntryHrefForAgent (no drift)', () => {
  // STRONGER than the original KICKOFF_KINDS pin: covers architect's bespoke
  // href and onboarding's honest null, not just the six generic kinds.
  for (const meta of SESSION_KIND_META) {
    expect(sessionEntryHrefForAgent(meta.agent)).toBe(meta.kickoffHref);
  }
});

// ---------------------------------------------------------------------------
// agent-authoring-view — agents-28 (create flag) + agents-09 (duplicate)
// ---------------------------------------------------------------------------

const AGENT_FIXTURE: Agent = {
  id: 'source-agent',
  name: 'Source Agent',
  purpose: 'p',
  skills: ['s1'],
  tools: [],
  mcps: [],
  guards: ['event-log'],
  hooks: [],
  process: 'body',
  interactivity: 'auto',
  runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6', range: [] },
  brainAccess: 'none',
} as unknown as Agent;

test('buildAgentPutBody carries create:true ONLY for a new agent', () => {
  const state = parseAgentToState(AGENT_FIXTURE);
  const createBody = buildAgentPutBody(state, { create: true });
  expect(createBody['create']).toBe(true);
  const updateBody = buildAgentPutBody(state, { create: false });
  expect('create' in updateBody).toBe(false);
  // field mapping survives the move out of the page file
  expect(updateBody['process']).toBe('body');
  expect((updateBody['composition'] as Record<string, unknown>)['skills']).toEqual(['s1']);
});

test('duplicateAgentState clears the slug and marks the name as a copy', () => {
  const dup = duplicateAgentState(AGENT_FIXTURE);
  expect(dup.slug).toBe('');
  expect(dup.name).toBe('Source Agent (copy)');
  expect(dup.skills).toEqual(['s1']);
});

// ---------------------------------------------------------------------------
// forge-hoq — the builder must PRESERVE disallowed-tools (and allowed-tools)
// across a full round trip, whether or not it renders them (ReadOnlyFields
// deliberately does not — that is a UI choice; dropping the field on save is
// data loss, per T1's ruling in _wave8/ledger.md). Before this fix,
// buildAgentPutBody omitted both fields from the PUT body entirely, so a new
// agent authored from a fenced starter (applyStarter → parseAgentToState →
// buildAgentPutBody, forge-ui/app/agents/[id]/page.tsx:245-250/460) or a
// duplicate of a fenced agent (duplicateAgentState) landed on disk UNFENCED
// — cli/studio-lint-tool-fence.ts's disallowed-tools rule has nothing to
// find, because the field never reached the bridge at all.
const FENCED_AGENT_FIXTURE: Agent = {
  ...AGENT_FIXTURE,
  id: 'fenced-source-agent',
  name: 'Fenced Source Agent',
  allowedTools: ['WebFetch', 'WebSearch'],
  disallowedTools: ['WebFetch', 'WebSearch', 'Task', 'Agent'],
} as unknown as Agent;

test('buildAgentPutBody carries allowedTools/disallowedTools through on a plain edit (create:false)', () => {
  const state = parseAgentToState(FENCED_AGENT_FIXTURE);
  const body = buildAgentPutBody(state, { create: false });
  expect(body['allowedTools']).toEqual(['WebFetch', 'WebSearch']);
  expect(body['disallowedTools']).toEqual(['WebFetch', 'WebSearch', 'Task', 'Agent']);
});

test('buildAgentPutBody carries allowedTools/disallowedTools through on a starter-derived new agent (create:true) — the applyStarter path', () => {
  // Mirrors forge-ui/app/agents/[id]/page.tsx's applyStarter(): the builder
  // state is seeded from a fenced starter with the slug cleared, then saved
  // as a brand-new agent.
  const state = { ...parseAgentToState(FENCED_AGENT_FIXTURE), slug: '' };
  const body = buildAgentPutBody(state, { create: true });
  expect(body['create']).toBe(true);
  expect(body['disallowedTools']).toEqual(['WebFetch', 'WebSearch', 'Task', 'Agent']);
});

test('duplicateAgentState + buildAgentPutBody carries disallowedTools through on a duplicate save', () => {
  const dup = duplicateAgentState(FENCED_AGENT_FIXTURE);
  const body = buildAgentPutBody(dup, { create: true });
  expect(body['disallowedTools']).toEqual(['WebFetch', 'WebSearch', 'Task', 'Agent']);
});
