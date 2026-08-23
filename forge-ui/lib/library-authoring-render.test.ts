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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { LibraryItemActions } from '@/components/studio/LibraryItemActions';
import { ApprovalRecordPanel } from '@/components/studio/ApprovalRecordPanel';
import { TemplateEditor } from '@/components/studio/TemplateEditor';
import { sessionEntryHrefForAgent, SESSION_KIND_META } from './session-kind-meta';
import { buildAgentPutBody, parseAgentToState, duplicateAgentState } from './agent-authoring-view';
import type { Agent } from './studio-client';
import { SkillDetailBody } from '@/components/studio/SkillDetailBody';
import type { SkillDetail, SkillTrust } from './skill-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readAppFile = (relPath: string) => readFileSync(join(__dirname, relPath), 'utf8');

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

// W8-B4 (library-46): `LibraryItemActions`' Delete used a hand-written
// `disabled` + `title` pair instead of the ONE derivation
// (`disabledAttrs()`, forge-ui/lib/disabled-reason.ts) — invisible to
// `scripts/check-disabled-reason.mjs`'s ratchet (it never carried
// `data-disabled-reason`, and its non-primary className skipped it from the
// scan entirely). Pin 5: the attribute is now driven by the ONE derivation,
// present iff blocked, absent iff not.
test('LibraryItemActions — Delete carries data-disabled-reason when blocked, and none when not blocked (library-46, pin 5)', () => {
  const blockedHtml = renderToStaticMarkup(
    React.createElement(LibraryItemActions, {
      kind: 'skill',
      id: 'x',
      editing: false,
      onToggleEdit: () => {},
      onDelete: () => {},
      deleteBlockReason: 'still composed by 1 agent(s): foo — unbind it from their builders first',
    }),
  );
  expect(blockedHtml).toMatch(/data-action="delete-skill"[^>]*data-disabled-reason="still composed by 1 agent/);

  const enabledHtml = renderToStaticMarkup(
    React.createElement(LibraryItemActions, {
      kind: 'skill',
      id: 'x',
      editing: false,
      onToggleEdit: () => {},
      onDelete: () => {},
    }),
  );
  const idx = enabledHtml.indexOf('data-action="delete-skill"');
  const start = enabledHtml.lastIndexOf('<', idx);
  const end = enabledHtml.indexOf('>', idx);
  const tag = enabledHtml.slice(start, end + 1);
  expect(tag).not.toContain('data-disabled-reason');
  expect(tag).not.toContain('disabled=""');
});

// W8-B4: STRONGER replacement for the old 'editing state flips the edit
// control label/pressed state' pin. The old contract (an `edit-<kind>`
// control that relabels to "Close editor" and stays pressed while editing)
// made every library detail page show TWO controls that dismiss the same
// editor: this action-bar control AND the editor's own adjacent Cancel
// (TemplateEditor/HookEditForm/SkillEditForm all already have one). The new
// contract: LibraryItemActions renders NO dismiss control at all while
// editing — the editor below is the ONE surviving dismiss.
//
// This is the enumeration pin: real, looped (not three copy-pasted
// single-kind assertions a fourth page could dodge) — for every kind a real
// library detail page uses (skill/hook/template), it asserts (a) the shared
// action bar contributes zero dismiss controls while editing, from the
// SAME LibraryItemActions instance every page mounts, and (b) that page's
// own source still wires its own editor's Cancel to the SAME toggleEdit
// handler, so exactly one dismiss survives end to end. Because the
// production fix lives in LibraryItemActions and is not kind-specific, a
// future fourth consumer inherits "zero from the bar" for free — it cannot
// resurrect the two-control bug through this shared component regardless of
// what its own editor looks like.
test('LibraryItemActions — exactly one dismiss control survives while editing, for every real page (skill, hook, template)', () => {
  const kinds = ['skill', 'hook', 'template'] as const;
  const pageSourceByKind: Record<(typeof kinds)[number], { path: string; cancelPattern: RegExp }> = {
    skill: {
      path: '../app/skills/[id]/page.tsx',
      cancelPattern: /data-action="cancel-skill-edit"[^>]*onClick=\{toggleEdit\}/,
    },
    hook: {
      path: '../app/hooks/[id]/page.tsx',
      cancelPattern: /data-action="cancel-hook-edit"[^>]*onClick=\{toggleEdit\}/,
    },
    template: {
      path: '../app/templates/[id]/page.tsx',
      // The template editor is the one extracted, reusable component
      // (TemplateEditor) — its onCancel is wired to the SAME toggleEdit.
      cancelPattern: /<TemplateEditor[\s\S]*?onCancel=\{toggleEdit\}/,
    },
  };

  for (const kind of kinds) {
    // (a) the shared action bar: zero dismiss controls while editing.
    const actionsHtml = renderToStaticMarkup(
      React.createElement(LibraryItemActions, {
        kind,
        id: 'x',
        editing: true,
        onToggleEdit: () => {},
        onDelete: () => {},
      }),
    );
    expect(actionsHtml).not.toMatch(new RegExp(`data-action="edit-${kind}"`));
    expect(actionsHtml).not.toContain('Close editor');

    // (b) the real page still wires its own editor's Cancel — dismissal
    // still works, it just isn't duplicated.
    const { path, cancelPattern } = pageSourceByKind[kind];
    const pageSrc = readAppFile(path);
    expect(pageSrc).toMatch(cancelPattern);
  }

  // Cross-check (b) for templates against the REAL TemplateEditor markup —
  // not just page-source text — since it IS an extracted, importable
  // component: the ONE dismiss control it renders is cancel-template-edit.
  const templateEditorHtml = renderToStaticMarkup(
    React.createElement(TemplateEditor, {
      content: 'x',
      onChange: () => {},
      onSave: () => {},
      onCancel: () => {},
      saving: false,
      error: null,
    }),
  );
  expect(templateEditorHtml).toContain('data-action="cancel-template-edit"');
});

// Component-level: NO kind value renders a dismiss control while editing —
// including 'agent', which never passes onToggleEdit at all (the agent
// builder page IS the editor; LibraryItemActions renders no Edit control for
// it either way). Parameterized over ALL FOUR kind values so the underlying
// production guard is proven kind-agnostic, not merely kind-by-kind lucky.
test('LibraryItemActions — the action bar renders no dismiss control while editing, for every kind', () => {
  const kinds = ['skill', 'hook', 'template', 'agent'] as const;
  for (const kind of kinds) {
    const html = renderToStaticMarkup(
      React.createElement(LibraryItemActions, {
        kind,
        id: 'x',
        editing: true,
        onToggleEdit: () => {},
        onDelete: () => {},
      }),
    );
    expect(html).not.toMatch(new RegExp(`data-action="edit-${kind}"`));
    expect(html).not.toContain('Close editor');
  }
});

// The flip side of the above: the fix must not be "delete the Edit button
// outright" — it must still be OFFERED whenever the item is NOT being
// edited, for every kind a real page uses.
test('LibraryItemActions — the Edit control is still offered when NOT editing, for every real kind', () => {
  const kinds = ['skill', 'hook', 'template'] as const;
  for (const kind of kinds) {
    const html = renderToStaticMarkup(
      React.createElement(LibraryItemActions, {
        kind,
        id: 'x',
        editing: false,
        onToggleEdit: () => {},
        onDelete: () => {},
      }),
    );
    expect(html).toMatch(new RegExp(`data-action="edit-${kind}"[^>]*aria-pressed="false"`));
    expect(html).toContain('>Edit<');
  }
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

// ---------------------------------------------------------------------------
// SkillDetailBody — the approval gate (library-36, W8-B4 WI-7)
//
// Root cause (wave-7 regate finding): the gate only ever rendered for
// `detail.trust === 'draft'`. A skill that dropped to `needs-review` (hash
// drift after an edit, provenance tampering, an unregistered install) had NO
// way back to composable except Delete — the edit form's own copy promises
// "it will honestly drop to needs-review until re-approved", but there was
// no re-approve path. Hooks got this right (`app/hooks/[id]/page.tsx`'s
// `!resolved` gate covers `needs-review` unconditionally); this mirrors it.
// ---------------------------------------------------------------------------

function skillDetail(overrides: Partial<SkillDetail> & { trust: SkillTrust }): SkillDetail {
  return {
    id: 'my-skill',
    name: 'My Skill',
    description: 'a skill',
    paletteVisible: overrides.trust === 'ready',
    files: [{ path: 'SKILL.md', body: '---\nname: my-skill\n---\nBody' }],
    source: 'community',
    usedBy: [],
    provenance: {
      source: 'https://github.com/example/my-skill',
      contentHash: 'hash-old',
      installedAt: '2026-08-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

/** Recursively walks a (not-yet-rendered-to-string) React element tree
 *  looking for the element carrying `props[propName] === propValue` — lets a
 *  test invoke a real onClick handler directly (there is no jsdom/
 *  `@testing-library/react` in this repo's vitest setup — `environment:
 *  'node'` — so DOM event simulation is not available; walking the element
 *  tree returned by calling a plain, hookless function component directly
 *  is the mechanism `AuthoringLauncher.test.ts`'s own header documents as
 *  this repo's limit: "click-handler interaction does not run under
 *  renderToStaticMarkup"). */
function findByProp(node: unknown, propName: string, propValue: string): React.ReactElement | null {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByProp(child, propName, propValue);
      if (found) return found;
    }
    return null;
  }
  const el = node as React.ReactElement<Record<string, unknown>>;
  if (el.props && (el.props as Record<string, unknown>)[propName] === propValue) return el;
  if (el.props && 'children' in el.props) {
    return findByProp((el.props as Record<string, unknown>)['children'], propName, propValue);
  }
  return null;
}

// pin 3's choice, stated: 'ready' is the state that must NOT offer approval
// — it is the fully-trusted, palette-visible, terminal-GOOD state (nothing
// to review), not a dead end. Proving this guards against the naive
// "always render Approve" fix that would make pin 1 pass too.
test('SkillDetailBody — a needs-review skill renders the approve control (library-36, pin 1)', () => {
  const detail = skillDetail({ trust: 'needs-review', reason: 'hash-drift' });
  const html = renderToStaticMarkup(
    React.createElement(SkillDetailBody, { detail, approving: false, approveError: null, onApprove: () => {} }),
  );
  expect(html).toContain('data-section="approval-gate"');
  expect(html).toContain('data-action="approve-skill"');
});

test('SkillDetailBody — a draft skill still renders the approve control (pin 2 — control, existing behaviour not replaced)', () => {
  const detail = skillDetail({
    trust: 'draft',
    provenance: null,
    scan: { quarantinedKeys: [], executableFiles: [], fileCount: 1, totalBytes: 42, body: 'draft body' },
  });
  const html = renderToStaticMarkup(
    React.createElement(SkillDetailBody, { detail, approving: false, approveError: null, onApprove: () => {} }),
  );
  expect(html).toContain('data-section="approval-gate"');
  expect(html).toContain('data-action="approve-skill"');
});

test('SkillDetailBody — a fully-trusted "ready" skill does NOT render the approve control (pin 3 — chosen because it is the terminal-good state, not a dead end; proves the fix is not "always show Approve")', () => {
  const detail = skillDetail({ trust: 'ready' });
  const html = renderToStaticMarkup(
    React.createElement(SkillDetailBody, { detail, approving: false, approveError: null, onApprove: () => {} }),
  );
  expect(html).not.toContain('data-section="approval-gate"');
  expect(html).not.toContain('data-action="approve-skill"');
});

test('SkillDetailBody — the rendered approve button for a needs-review skill is wired to the SAME onApprove the caller passed in, not a decorative copy (pin 4, half 1: the wiring)', () => {
  const detail = skillDetail({ trust: 'needs-review', reason: 'unregistered-install' });
  let calls = 0;
  const element = SkillDetailBody({ detail, approving: false, approveError: null, onApprove: () => { calls += 1; } });
  const btn = findByProp(element, 'data-action', 'approve-skill');
  expect(btn).not.toBeNull();
  (btn!.props as { onClick: () => void }).onClick();
  expect(calls).toBe(1);
});

test('SkillDetailBody — after a needs-review skill is re-approved, the render reflects the re-pinned hash and clears the gate/banner — the EFFECT, not just that a request was sent (pin 4, half 2)', () => {
  const before = skillDetail({ trust: 'needs-review', reason: 'hash-drift' });
  const beforeHtml = renderToStaticMarkup(
    React.createElement(SkillDetailBody, { detail: before, approving: false, approveError: null, onApprove: () => {} }),
  );
  expect(beforeHtml).toContain('data-action="approve-skill"');
  expect(beforeHtml).toContain('data-section="needs-review"');
  expect(beforeHtml).toContain('hash-old');

  // Simulates the page's post-approve reload (handleApprove → void load(id))
  // receiving the server's re-pinned state: orchestrator/studio/
  // skill-library.ts's repinSkillPackage recomputes the content hash off the
  // CURRENT on-disk bytes and writes it into both the SKILL.md provenance
  // block and the install ledger; the trust pipeline then re-evaluates to
  // 'ready' since the pin now matches.
  const after: SkillDetail = {
    ...before,
    trust: 'ready',
    reason: undefined,
    paletteVisible: true,
    provenance: { ...before.provenance!, contentHash: 'hash-new-repinned' },
  };
  const afterHtml = renderToStaticMarkup(
    React.createElement(SkillDetailBody, { detail: after, approving: false, approveError: null, onApprove: () => {} }),
  );
  expect(afterHtml).not.toContain('data-action="approve-skill"');
  expect(afterHtml).not.toContain('data-section="needs-review"');
  expect(afterHtml).toContain('hash-new-repinned');
  expect(afterHtml).not.toContain('hash-old');
});
