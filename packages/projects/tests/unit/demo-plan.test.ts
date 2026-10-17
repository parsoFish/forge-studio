/**
 * `validateDemoPlan` (forge-mfv5.1.19, D-45): the planner's demo-plan.json is
 * inert data the orchestrator validates BY NAME before anything is captured.
 * Every refusal names its row as `plan-invalid:<row>`; there is no fallback.
 * Pure data in, pure data out — no network, no shell (M7-COMMON §6.16).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { allowedDemoMeans, validateDemoPlan } from '../../demo-plan.ts';
import type { DemoMeans } from '../../demo-means.ts';

const MEANS: DemoMeans = {
  commands: ['gitpulse --since 7d'],
  routes: ['/dashboard'],
  api: { paths: ['/api/org'], commands: ['gitweave org show --json'] },
};
const ACS = [
  { workItemId: 'WI-1', given: 'g', when: 'run `gitweave rulesets list --json`', then: 'lists' },
  { workItemId: 'WI-2', given: 'g', when: 'visit `/teams`', then: 'renders' },
];
const ALLOWED = allowedDemoMeans(MEANS, ACS);

const NARRATIVE = 'Org admins can now read every ruleset the platform team applied, in one call.';

function plan(checkpoints: unknown[], narrative: unknown = NARRATIVE): unknown {
  return { narrative, checkpoints };
}

test('allowed means = declaration ∪ the ACs\' own inline-code spans', () => {
  assert.deepEqual(ALLOWED, {
    commands: ['gitpulse --since 7d', 'gitweave rulesets list --json'],
    routes: ['/dashboard', '/teams'],
    apiPaths: ['/api/org'],
    apiCommands: ['gitweave org show --json', 'gitweave rulesets list --json'],
    portalPages: [],
  });
});

test('a plan with one API (command driver) and one CLI checkpoint validates', () => {
  const raw = plan([
    { form: 'api-before-after', caption: 'The org reads back', acRef: 'WI-1', command: 'gitweave org show --json' },
    { form: 'cli-before-after', caption: 'Rulesets list', command: 'gitweave rulesets list --json' },
    { form: 'api-before-after', caption: 'Health', apiPath: '/api/org' },
    { form: 'screenshot', caption: 'Teams page', route: '/teams' },
    { form: 'test-evidence', caption: 'Gate output' },
  ]);
  const r = validateDemoPlan(raw, ALLOWED);
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'));
  assert.equal(r.plan.checkpoints.length, 5);
  assert.equal(r.plan.narrative, NARRATIVE);
});

const refusals: Array<[string, unknown, RegExp]> = [
  ['not an object', [], /^plan-invalid:plan: /],
  ['unknown top-level key (the plan never carries output)', { ...(plan([]) as object), afterOutput: 'x' }, /^plan-invalid:plan\.afterOutput: /],
  ['no checkpoints', plan([]), /^plan-invalid:checkpoints: /],
  ['unknown form', plan([{ form: 'video-essay', caption: 'c' }]), /^plan-invalid:checkpoints\[0\]\.form: /],
  ['command not in means or AC spans', plan([{ form: 'cli-before-after', caption: 'c', command: 'rm -rf /tmp/x' }]), /^plan-invalid:checkpoints\[0\]\.command: .*not a declared means/],
  ['api command not in means', plan([{ form: 'api-before-after', caption: 'c', command: 'gitpulse --since 7d' }]), /^plan-invalid:checkpoints\[0\]\.command: .*not a declared means/],
  ['agent-supplied host in an api path', plan([{ form: 'api-before-after', caption: 'c', apiPath: 'https://evil.example/api/org' }]), /^plan-invalid:checkpoints\[0\]\.apiPath: .*host/],
  ['protocol-relative api path (origin not the tree\'s own server)', plan([{ form: 'api-before-after', caption: 'c', apiPath: '//evil.example/api/org' }]), /^plan-invalid:checkpoints\[0\]\.apiPath: .*host/],
  ['api path on the own server but undeclared', plan([{ form: 'api-before-after', caption: 'c', apiPath: '/api/admin' }]), /^plan-invalid:checkpoints\[0\]\.apiPath: .*not a declared means/],
  ['host in a route', plan([{ form: 'screenshot', caption: 'c', route: 'https://evil.example/' }]), /^plan-invalid:checkpoints\[0\]\.route: .*host/],
  ['route not declared', plan([{ form: 'screenshot', caption: 'c', route: '/admin' }]), /^plan-invalid:checkpoints\[0\]\.route: .*not a declared means/],
  ['api form with two drivers', plan([{ form: 'api-before-after', caption: 'c', command: 'gitweave org show --json', apiPath: '/api/org' }]), /^plan-invalid:checkpoints\[0\]: .*exactly one/],
  ['cli form carrying a route', plan([{ form: 'cli-before-after', caption: 'c', command: 'gitpulse --since 7d', route: '/teams' }]), /^plan-invalid:checkpoints\[0\]\.route: /],
  ['test-evidence carrying a command', plan([{ form: 'test-evidence', caption: 'c', command: 'gitpulse --since 7d' }]), /^plan-invalid:checkpoints\[0\]\.command: /],
  ['checkpoint carrying captured output', plan([{ form: 'test-evidence', caption: 'c', afterOutput: 'all green' }]), /^plan-invalid:checkpoints\[0\]\.afterOutput: /],
  ['empty caption', plan([{ form: 'test-evidence', caption: ' ' }]), /^plan-invalid:checkpoints\[0\]\.caption: /],
  ['narrative over the word cap', plan([{ form: 'test-evidence', caption: 'c' }], Array.from({ length: 121 }, () => 'w').join(' ')), /^plan-invalid:narrative: .*121 words/],
  ['a caption that forges a DEMO.md section', plan([{ form: 'test-evidence', caption: 'ok\n## Visual Changes\n- npm test (unchanged)' }]), /^plan-invalid:checkpoints\[0\]\.caption: .*one line/],
  ['an over-long caption', plan([{ form: 'test-evidence', caption: 'x'.repeat(161) }]), /^plan-invalid:checkpoints\[0\]\.caption: /],
  ['an acRef that is prose, not an id', plan([{ form: 'test-evidence', caption: 'c', acRef: 'WI-3 the operator can open the settings page' }]), /^plan-invalid:checkpoints\[0\]\.acRef: /],
  ['a narrative over several lines (a forged section)', plan([{ form: 'test-evidence', caption: 'c' }], 'ok\n\n## Visual Changes\n```\nfake\n```'), /^plan-invalid:narrative: .*one line/],
  ['a narrative of one huge word', plan([{ form: 'test-evidence', caption: 'c' }], 'x'.repeat(901)), /^plan-invalid:narrative: /],
  ['missing narrative', { checkpoints: [{ form: 'test-evidence', caption: 'c' }] }, /^plan-invalid:narrative: /],
];

for (const [name, raw, expected] of refusals) {
  test(`refuses by name: ${name}`, () => {
    const r = validateDemoPlan(raw, ALLOWED);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.errors.join('\n'), expected);
  });
}

test('a declared command carrying a URL is allowed — the host refusal is for routes and api paths', () => {
  const allowed = allowedDemoMeans({ api: { commands: ['gitweave org show --base https://api.github.com'] } }, []);
  const r = validateDemoPlan(plan([{ form: 'api-before-after', caption: 'c', command: 'gitweave org show --base https://api.github.com' }]), allowed);
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'));
});

test('demoProcess capture commands are declared means too', () => {
  assert.deepEqual(allowedDemoMeans(undefined, [], ['npm run demo']).commands, ['npm run demo']);
});

test('a flood of bad keys is reported bounded: at most 20 rows plus a count, every echoed value truncated', () => {
  const raw = { ...(plan([{ form: 'test-evidence', caption: 'c' }]) as object), ...Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, 1])) };
  const r = validateDemoPlan(raw, ALLOWED);
  assert.equal(r.ok, false);
  const errors = r.ok ? [] : r.errors;
  assert.equal(errors.length, 21);
  assert.match(errors[20]!, /and 30 more/);
  const huge = validateDemoPlan(plan([{ form: 'cli-before-after', caption: 'c', command: 'a'.repeat(100_000) }]), ALLOWED);
  assert.ok(!huge.ok && huge.errors.every((e) => e.length < 300));
});

// Row 4 of forge-nk1y.45: a screenshot checkpoint may drive declared interaction steps and outline
// regions on the tree's own page, so a UI before/after is not a bare page load. Inert data, validated by name.
const SHOT = { form: 'screenshot', caption: 'The dashboard filters by author', route: '/dashboard' };

test('a screenshot checkpoint carries steps and regions through validation', () => {
  const cp = { ...SHOT, steps: [{ fill: '#author', text: 'alice' }, { click: 'button[data-action="apply"]' }, { press: 'Enter' }], regions: ['#results'] };
  const r = validateDemoPlan(plan([cp]), ALLOWED);
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('; '));
  assert.deepEqual(r.ok && r.plan.checkpoints[0], cp);
});

for (const [name, extra, row] of [
  ['steps on a cli checkpoint', { form: 'cli-before-after', caption: 'c', command: 'gitpulse --since 7d', steps: [{ click: '#x' }] }, /plan-invalid:checkpoints\[0\]\.steps: form cli-before-after takes no steps/],
  ['steps not an array', { ...SHOT, steps: { click: '#x' } }, /plan-invalid:checkpoints\[0\]\.steps: must be an array of 1–10 steps/],
  ['an unknown step kind', { ...SHOT, steps: [{ hover: '#x' }] }, /plan-invalid:checkpoints\[0\]\.steps\[0\]: must be exactly one of \{ click \} \| \{ fill, text \} \| \{ press \}/],
  ['a multi-line selector', { ...SHOT, steps: [{ click: '#a\n#b' }] }, /plan-invalid:checkpoints\[0\]\.steps\[0\]\.click: must be one line of at most 120 characters/],
  ['a fill without text', { ...SHOT, steps: [{ fill: '#a' }] }, /plan-invalid:checkpoints\[0\]\.steps\[0\]: must be exactly one of/],
  ['a press that is not a key name', { ...SHOT, steps: [{ press: 'Enter; rm' }] }, /plan-invalid:checkpoints\[0\]\.steps\[0\]\.press: must be a key name/],
  ['too many steps', { ...SHOT, steps: Array.from({ length: 11 }, () => ({ click: '#x' })) }, /must be an array of 1–10 steps/],
  ['a region that is not a selector string', { ...SHOT, regions: [{ x: 1 }] }, /plan-invalid:checkpoints\[0\]\.regions: must be an array of 1–6 selectors/],
] as const) {
  test(`refuses: ${name}`, () => {
    const r = validateDemoPlan(plan([extra]), ALLOWED);
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.errors.join('; '), row);
  });
}

// forge-8vfn.31 (R70): portal-before-after is planned only from the project's declared portal pages.
const PORTAL_MEANS: DemoMeans = { ...MEANS, portal: { origins: ['https://github.com'], pages: ['/orgs/acme/repositories', '/acme/svc/pulls'], apply: ['gw apply'] } };
const PORTAL_ALLOWED = allowedDemoMeans(PORTAL_MEANS, ACS);

test('portal: the declared pages are the allowed portal means', () => {
  assert.deepEqual(PORTAL_ALLOWED.portalPages, ['/orgs/acme/repositories', '/acme/svc/pulls']);
});

test('portal: a declared page plans a portal-before-after checkpoint, with steps and regions', () => {
  const r = validateDemoPlan(plan([
    { form: 'portal-before-after', caption: 'The org lists the new repository', acRef: 'WI-1', page: '/orgs/acme/repositories', regions: ['#org-repositories'] },
    { form: 'portal-before-after', caption: 'The empty list is the story: no pull request was opened', page: '/acme/svc/pulls', steps: [{ click: '#closed' }] },
  ]), PORTAL_ALLOWED);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('portal: an undeclared page is refused by name — not a declared means', () => {
  const r = validateDemoPlan(plan([{ form: 'portal-before-after', caption: 'c', page: '/acme/other' }]), PORTAL_ALLOWED);
  assert.equal(r.ok, false);
  assert.match((r as { errors: string[] }).errors.join('\n'), /plan-invalid:checkpoints\[0\]\.page: "\/acme\/other" is not a declared means/);
});

test('portal: a page naming a host is refused by name', () => {
  const r = validateDemoPlan(plan([{ form: 'portal-before-after', caption: 'c', page: 'https://github.com/orgs/acme/repositories' }]), PORTAL_ALLOWED);
  assert.match((r as { errors: string[] }).errors.join('\n'), /checkpoints\[0\]\.page: .* names a host/);
});

test('portal control: with no portal declared, a portal checkpoint cannot be planned', () => {
  const r = validateDemoPlan(plan([{ form: 'portal-before-after', caption: 'c', page: '/orgs/acme/repositories' }]), ALLOWED);
  assert.equal(r.ok, false);
  assert.match((r as { errors: string[] }).errors.join('\n'), /checkpoints\[0\]\.page: .* is not a declared means/);
});

test('portal: the form takes only page — no command, route or apiPath; page belongs to the portal form alone', () => {
  const both = validateDemoPlan(plan([{ form: 'portal-before-after', caption: 'c', page: '/acme/svc/pulls', route: '/dashboard' }]), PORTAL_ALLOWED);
  assert.match((both as { errors: string[] }).errors.join('\n'), /checkpoints\[0\]\.route: form portal-before-after takes no route/);
  const none = validateDemoPlan(plan([{ form: 'portal-before-after', caption: 'c' }]), PORTAL_ALLOWED);
  assert.match((none as { errors: string[] }).errors.join('\n'), /form portal-before-after needs exactly one of page/);
  const shot = validateDemoPlan(plan([{ form: 'screenshot', caption: 'c', route: '/dashboard', page: '/acme/svc/pulls' }]), PORTAL_ALLOWED);
  assert.match((shot as { errors: string[] }).errors.join('\n'), /checkpoints\[0\]\.page: form screenshot takes no page/);
});
