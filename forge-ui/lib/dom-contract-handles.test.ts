/**
 * The declared handles four story lanes could not name — `forge-8vfn.5.4`,
 * `5.5`, `5.6` and `5.9`, one class.
 *
 * All four are the same defect: forge-ui declares a machine-readable contract
 * in `docs/forge-ui-dom-and-harness.md`, and these surfaces render controls
 * that fall outside it — a field with no `data-field`, a disclosure with no
 * `data-action`, an action repeated per instance with no way to say WHICH
 * instance, a session id that exists only inside the click that navigates away
 * from it. `scripts/stories/beats.mjs` resolves `[data-field=…]` and
 * `[data-action=…]` and takes `.first()`, and names no CSS selector on purpose,
 * so an undeclared or ambiguous control is unreachable to every story.
 */
import { test, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/projects/story-s2',
}));

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { OnboardWithAgent } from '@/components/studio/project-builder/OnboardWithAgent';
import { StageSelector } from '@/components/studio/session/StageSelector';
import { ContractBuildout } from '@/components/studio/ContractBuildout';
import { SessionMinted } from '@/components/studio/session/SessionMinted';
import { DemoTimeline } from '@/components/studio/project-builder/DemoTimeline';
import { NorthStar } from '@/components/studio/project-builder/NorthStar';
import { SkillsBind } from '@/components/studio/project-builder/SkillsBind';
import { ContractResolutionPanel } from '@/components/studio/project-builder/ContractResolutionPanel';

/* eslint-disable @typescript-eslint/no-explicit-any */
const render = (component: unknown, props: Record<string, unknown> = {}): string =>
  renderToStaticMarkup(React.createElement(component as any, props));

// ── forge-8vfn.5.4 — the onboarding brief ────────────────────────────────────

test('5.4: the brief inputs declare data-field, the vocabulary every other filled input on this page uses', () => {
  const html = render(OnboardWithAgent, { projectId: 'story-s2' });
  expect(html).toContain('data-field="northStar"');
  expect(html).toContain('data-field="gateCommand"');
  expect(html).toContain('data-field="constraints"');
});

test('5.4: the disclosure that HOLDS the brief can be opened — the convention toggle-onboard-advanced already sets', () => {
  const html = render(OnboardWithAgent, { projectId: 'story-s2' });
  expect(html).toContain('data-action="toggle-onboard-brief"');
});

// ── forge-8vfn.5.6 — the onboarding session's stages ─────────────────────────

test('5.6: a stage is addressable BY NAME — a generic press took .first() and opened whichever stage rendered first', () => {
  const html = render(StageSelector, {
    stages: ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
    selectedStage: 'contract',
    onSelect: () => {},
  });
  for (const stage of ['contract', 'instructions', 'secrets', 'demo', 'roadmap']) {
    expect(html).toContain(`data-action="select-stage-${stage}"`);
  }
  // The qualifying attribute stays — it is what the DOM contract reads.
  expect(html).toContain('data-stage="secrets"');
});

test('5.6: the demo stage detail carries the act it exists for — handing the stage to the demo builder', () => {
  const html = render(ContractBuildout, {
    view: { kind: 'contract-buildout', mode: 'detail', row: { stage: 'demo', status: 'absent', source: 'demo/', bytes: null, detail: [] }, checklist: [] },
    activeStage: 'demo',
    project: 'story-s2',
  });
  expect(html).toContain('data-stage-detail-stage="demo"');
  expect(html).toContain('data-action="launch-demo-builder"');
});

test('5.6: a stage that is NOT the demo stage offers no demo handoff — the control states a real act, never decoration', () => {
  const html = render(ContractBuildout, {
    view: { kind: 'contract-buildout', mode: 'detail', row: { stage: 'secrets', status: 'present', source: '.env.example', bytes: 12, detail: ['API_KEY'] }, checklist: [] },
    activeStage: 'secrets',
    project: 'story-s2',
  });
  expect(html).not.toContain('data-action="launch-demo-builder"');
});

// ── forge-8vfn.5.5 — a minted session id, rendered before it is consumed ─────

test('5.5: a minted session id is RENDERED, with the way into it, before anything navigates', () => {
  const html = render(SessionMinted, { kind: 'demo', sessionId: 'ds-42', project: 'story-s2' });
  expect(html).toContain('data-session-kind="demo"');
  expect(html).toContain('data-session-id="ds-42"');
  expect(html).toContain('data-action="view-demo-session"');
  expect(html).toContain('href="/sessions/demo/ds-42?project=story-s2"');
});

test('5.5: nothing is claimed before a session exists', () => {
  expect(render(SessionMinted, { kind: 'architect', sessionId: null })).toBe('');
});

// ── forge-8vfn.5.9 — the project editor's own inputs ─────────────────────────

test('5.9: the north star and the skills search declare data-field', () => {
  expect(render(NorthStar, { value: 'a thing', onChange: () => {} })).toContain('data-field="north-star"');
  expect(render(SkillsBind, { skills: [], onChange: () => {}, catalog: [] })).toContain('data-field="skills-search"');
});

test('5.9: a demo step is addressable BY POSITION, so beat 8 can name the step it changes', () => {
  const html = render(DemoTimeline, {
    project: 'story-s2',
    steps: [
      { kind: 'capture', text: 'build the binary' },
      { kind: 'present', text: 'show the timings' },
    ],
    hasLockedDemo: false,
    onChange: () => {},
  });
  expect(html).toContain('data-field="demo-step-1"');
  expect(html).toContain('data-field="demo-step-2"');
});

test('5.9: a clause decision box names its own clause — .first() cannot say which clause otherwise', () => {
  const html = render(ContractResolutionPanel, {
    projectId: 'story-s2',
    clauses: [{ id: 'C6', title: 'a demo capability', hard: true, pass: false, detail: 'none', resolution: 'user' }],
    boundKbId: null,
  });
  expect(html).toContain('data-field="clause-decision-C6"');
});
