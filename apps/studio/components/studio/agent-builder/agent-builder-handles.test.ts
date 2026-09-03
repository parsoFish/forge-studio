// @vitest-environment jsdom
/**
 * The agent builder's story handles — bead `forge-8vfn.5.15`.
 *
 * WHAT THIS FILE PINS, AND WHY IT NEEDS A DOM.
 *
 * S5 ("create a new agent") recorded the builder as write-only to a human:
 * `/agents/new` rendered ten inputs and not ONE carried `data-field`, and it
 * declared exactly four `data-action`s. A story beat's two verbs resolve
 * `[data-field="…"]` (`fill`) and `[data-action="…"]` (`press`) and nothing
 * else (scripts/stories/beats.mjs), so naming the agent, composing its skills,
 * fencing its tools and capping its spend — the four acts 1.0.md §3's S5 row
 * actually names — had no handle at all. This file asserts the handles exist,
 * on the real components, in the real order the operator meets them.
 *
 * WHY ORDER IS THE POINT, not a list of attributes. `/agents/new` mounts the
 * starter picker ALONE: the name field, the purpose field, the instructions
 * body, the Advanced drawer and the Run panel do not exist in the document
 * until a starter is chosen. S5 beat 4 failed on exactly that second fact —
 * `[data-action="toggle-advanced"]` timed out because the control is absent,
 * not because it was slow — and no beat could choose a starter, because the
 * four starter buttons carried `data-starter-option` and no `data-action`. So
 * a flat "every handle is present" assertion would be answered by rendering a
 * SAVED agent, where the picker never appears, and would prove nothing about
 * the route the story drives. The assertions below are therefore staged:
 * absent before the press, present after it.
 *
 * A renderToStaticMarkup test cannot make this claim. The transition is a
 * state update on a click handler, so the second half of every assertion pair
 * only exists after React commits — which needs a document. That is why this
 * file opts into jsdom, as `kickoff-mint-before-navigate.test.ts` does, while
 * the rest of the studio suite stays on `node`.
 *
 * MUTATION PASS (§15.68 — a control that is green either way is not a
 * control). Each of the four `data-field` assertions and each `data-action`
 * assertion was re-run with its attribute deleted from the component; every
 * one goes red naming the missing handle. Recorded in the PR body.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** The two skills and two tools S5 composes, read off the catalog it is given. */
const SKILLS = [
  { id: 'brain-query', name: 'brain-query', desc: 'query the project brain' },
  { id: 'webapp-testing', name: 'webapp-testing', desc: 'drive a web app' },
];
const TOOLS = [
  { id: 'git', name: 'git', desc: 'version control' },
  { id: 'node', name: 'node', desc: 'the Node runtime' },
];

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/agents/new',
  useParams: () => ({ id: 'new' }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href }, children),
}));

// Partial: only the network reads are replaced. The module's real constants
// (`MATERIAL_KINDS`, `KB_SEEDING_ANCHOR_PREFIX`, …) keep their real values, so
// this test cannot pass against a vocabulary the product does not ship.
vi.mock('@/lib/studio-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/studio-client')>()),
  fetchStudioAgentsWithMeta: vi.fn(async () => ({ agents: [], defaultCostCeilingUsd: 10 })),
  fetchStudioCatalog: vi.fn(async () => ({
    skills: SKILLS,
    tools: TOOLS,
    mcps: [],
    guards: [{ id: 'event-log', name: 'event-log', desc: 'observability' }],
    hooks: [],
    // `BLANK_STATE.runtime.sdk` is `'claude'` and `modelsForSdk` filters the
    // model list by `m.sdk === runtime.sdk`, so the fixture uses the real id:
    // a mismatched one renders an EMPTY chip row and the model assertion below
    // would pass or fail for the wrong reason.
    sdks: [{ id: 'claude', name: 'Claude Code', vendor: 'Anthropic', desc: '', installed: true }],
    models: [
      { id: 'claude-sonnet-4-6', name: 'Sonnet', tier: 'worker', sdk: 'claude' },
      { id: 'claude-opus-4-1', name: 'Opus', tier: 'planner', sdk: 'claude' },
    ],
  })),
  fetchStudioFlows: vi.fn(async () => []),
  fetchStarters: vi.fn(async () => [
    { id: 'dev', name: 'Developer', purpose: 'write code' },
  ]),
  fetchStudioProjects: vi.fn(async () => [{ id: 'mdtoc', name: 'mdtoc' }]),
  fetchStandingTriggers: vi.fn(async () => []),
  saveAgent: vi.fn(),
  deleteAgent: vi.fn(),
  requestInstructionsDraft: vi.fn(),
}));

vi.mock('@/lib/connection-client', () => ({
  fetchConnections: vi.fn(async () => []),
}));

vi.mock('@/lib/agent-ledger', () => ({
  fetchAgentHistory: vi.fn(async () => ({ kind: 'not-found' as const })),
}));

vi.mock('@/lib/use-bridge-status', () => ({
  useBridgeRecoveryWhenFailed: () => {},
  useBridgeStatus: () => ({ state: 'up' }),
}));

vi.mock('@/components/StudioNav', () => ({
  StudioNav: () => React.createElement('nav', null),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

/** Mount the real builder page and let its four loads settle. */
async function mountBuilder() {
  const { default: AgentBuilderPage } = await import('@/app/agents/[id]/page');
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(AgentBuilderPage));
  });
  // The page fires four independent fetches; a second flush lets each
  // resolved promise commit before anything is read.
  await act(async () => { await Promise.resolve(); });
}

const q = (sel: string) => container.querySelector(sel);
const press = async (action: string) => {
  const el = q(`[data-action="${action}"]`);
  expect(el, `[data-action="${action}"] must exist to be pressed`).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
};

test('the starter picker is the only act available on /agents/new, and it carries a pressable handle', async () => {
  await mountBuilder();

  // The picker is up…
  expect(q('[data-section="starter-picker"]')).not.toBeNull();
  expect(q('[data-action="starter-blank"]')).not.toBeNull();
  expect(q('[data-action="starter-dev"]')).not.toBeNull();

  // The name lives in the agent HEADER, which renders above the picker on
  // both branches — so it is nameable from the first frame. Measured, not
  // assumed: the first draft of this test asserted it absent and went red.
  expect(q('[data-field="agent-name"]')).not.toBeNull();

  // Everything else is genuinely NOT here yet. This is S5 beat 4's second
  // cause stated as an assertion: the one composition control that already
  // had a `data-action` is unreachable, because the surface it lives on has
  // not mounted.
  expect(q('[data-action="toggle-advanced"]')).toBeNull();
  expect(q('[data-field="purpose"]')).toBeNull();
  expect(q('[data-field="instructions"]')).toBeNull();
  expect(q('[data-field="interactivity"]')).toBeNull();

  // The RUN column is up from the first frame too (W8-B1 pins the Run panel
  // first in `aside.col-right`, and that aside is outside the picker branch).
  // Also measured rather than assumed — the first draft asserted it absent.
  expect(q('[data-field="run-cost-ceiling"]')).not.toBeNull();
});

test('pressing the blank starter mounts the builder, and every named field carries its handle', async () => {
  await mountBuilder();
  await press('starter-blank');

  // The picker is gone and the builder is up.
  expect(q('[data-section="starter-picker"]')).toBeNull();
  expect(q('[data-action="toggle-advanced"]')).not.toBeNull();

  for (const field of ['agent-name', 'purpose', 'instructions', 'interactivity']) {
    const el = q(`[data-field="${field}"]`);
    expect(el, `[data-field="${field}"] is missing from the builder`).not.toBeNull();
    // `fill` sets an INPUT/TEXTAREA with `locator.fill` and a SELECT with
    // `selectOption`; a handle on any other tag would fail in the runner, not
    // here, which is the failure this assertion exists to move forward.
    expect(['INPUT', 'TEXTAREA', 'SELECT']).toContain((el as HTMLElement).tagName);
  }
});

test('the catalog chips carry per-kind add actions — composing a skill and fencing a tool are different acts', async () => {
  await mountBuilder();
  await press('starter-blank');

  for (const s of SKILLS) expect(q(`[data-action="add-skill-${s.id}"]`)).not.toBeNull();
  for (const t of TOOLS) expect(q(`[data-action="add-tool-${t.id}"]`)).not.toBeNull();

  // The kind is part of the name, so no beat can press a tool believing it
  // composed a skill — the fence and the composition are the same widget.
  expect(q('[data-action="add-tool-brain-query"]')).toBeNull();
  expect(q('[data-action="add-skill-git"]')).toBeNull();
});

test('adding two skills through their handles moves the skill zone to count=2 and leaves the mcp zone at 0', async () => {
  await mountBuilder();
  await press('starter-blank');

  await press('add-skill-brain-query');
  await press('add-skill-webapp-testing');

  // S5 beats 5 and 7 (4 and 6 before the story's amendment 1): the same
  // claim the story makes, on the same elements.
  expect(q('[data-accepts="skill"]')?.getAttribute('data-count')).toBe('2');
  expect(q('[data-accepts="mcp"]')?.getAttribute('data-count')).toBe('0');

  // The guard and hook zones stay DISTINCT (plan 8.1 / R3-03): a fix that
  // merged them would still satisfy every count above.
  expect(q('[data-accepts="guard"]')).not.toBeNull();
  expect(q('[data-accepts="hook"]')).not.toBeNull();
  expect(q('[data-accepts="guard"]')).not.toBe(q('[data-accepts="hook"]'));
});

test('adding two tools through their handles moves the tool zone to count=2', async () => {
  await mountBuilder();
  await press('starter-blank');

  await press('add-tool-git');
  await press('add-tool-node');

  expect(q('[data-accepts="tool"]')?.getAttribute('data-count')).toBe('2');
  expect(q('[data-accepts="skill"]')?.getAttribute('data-count')).toBe('0');
});

test('typing a purpose through its handle ticks the readiness panel’s purpose check — S5 beat 3’s own assertion', async () => {
  await mountBuilder();
  await press('starter-blank');

  expect(q('[data-check="purpose"]')?.getAttribute('data-ok')).toBe('false');

  const input = q('[data-field="purpose"]') as HTMLInputElement;
  await act(async () => {
    // React tracks the value on the node; setting `.value` directly is
    // invisible to it, so the native setter is called before the event.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, 'Report every doc page that describes a page that no longer exists.');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  expect(q('[data-check="purpose"]')?.getAttribute('data-ok')).toBe('true');
});

test('the runtime pickers and the run panel carry the remaining named handles', async () => {
  await mountBuilder();
  await press('starter-blank');

  // Runtime: SDK / model / loop strategy / brain access (S5.md's own table).
  expect(q('[data-action="sdk-claude"]')).not.toBeNull();
  // The model chips are the fourth of that table's four picks, and they were
  // the ONE handle the first version of this file left unasserted — the
  // mutation pass caught it: deleting `data-action` from the model chip left
  // all eight tests green. A control that is green either way is not a
  // control (§15.68).
  expect(q('[data-action="model-claude-sonnet-4-6"]')).not.toBeNull();
  expect(q('[data-action="model-claude-opus-4-1"]')).not.toBeNull();
  expect(q('[data-action="loop-ralph"]')).not.toBeNull();
  expect(q('[data-action="loop-one-shot"]')).not.toBeNull();
  for (const access of ['mandatory', 'advisory', 'none']) {
    expect(q(`[data-action="access-${access}"]`), `brain access "${access}"`).not.toBeNull();
  }

  // The run surface: the project to run against and the ceiling for the run.
  // Both were bespoke boolean markers with no `fill` handle before this bead.
  const project = q('[data-field="run-project"]');
  expect(project).not.toBeNull();
  expect((project as HTMLElement).tagName).toBe('SELECT');
  expect(project?.hasAttribute('data-run-project')).toBe(true);

  const ceiling = q('[data-field="run-cost-ceiling"]');
  expect(ceiling).not.toBeNull();
  expect((ceiling as HTMLElement).tagName).toBe('INPUT');
  expect(ceiling?.hasAttribute('data-run-cost-ceiling')).toBe(true);
});

/**
 * MEASURED FOR THE S5 PARK, not a handle assertion.
 *
 * S5 beat 9 (beat 8 before the story's amendment 1) asserts
 * `data-ready-count="6"`. From the Blank starter the six
 * checks are purpose / skill / guard / process / interactivity / runtime, and
 * `BLANK_STATE` already ships `guards: ['event-log']`, an interactivity
 * sentence and a model — so typing a purpose and composing one skill takes the
 * page to FIVE, with `process` (the instructions body) the one still unmet.
 * No S5 beat names typing instructions.
 *
 * That is why the handles alone do not turn S5 green, and why the story
 * amendment that consumes them is an operator question rather than a
 * mechanical one. Recorded here so the number in the park message is measured
 * against the real components instead of reasoned about.
 *
 * `runtime` is descriptor-sourced (server-computed) and this mount has no
 * descriptor, so it reads unmet here; the count below is stated as the set of
 * UNMET keys, which is invariant to that.
 */
test('S5 park measurement: purpose + one skill from Blank leaves `process` unmet — no beat types instructions', async () => {
  await mountBuilder();
  await press('starter-blank');

  const input = q('[data-field="purpose"]') as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, 'Report every doc page that describes a page that no longer exists.');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await press('add-skill-brain-query');

  const unmet = Array.from(container.querySelectorAll('[data-check][data-ok="false"]'))
    .map((el) => el.getAttribute('data-check'));

  // guard and interactivity are already met by BLANK_STATE — measured, and the
  // reason beat 8's gap is exactly one field wide rather than three.
  expect(unmet).not.toContain('guard');
  expect(unmet).not.toContain('interactivity');
  expect(unmet).not.toContain('purpose');
  expect(unmet).not.toContain('skill');
  expect(unmet).toContain('process');
});
