// @vitest-environment jsdom
/**
 * The verdict gate layout (forge-mfv5.1.31, D-46).
 *
 * Kills these wrong implementations, each one the page had or a redesign
 * could slide back into:
 *   - the decision control rendered AFTER the evidence (it sat at y=12,827);
 *   - criteria and checkpoints rendered twice, or more than five top-level blocks;
 *   - the first `[data-demo-region]` being a checkpoint (S10 beats 13/16 anchor
 *     their comment to the first region in document order);
 *   - reviewer prose shown as one unbroken paragraph per field;
 *   - a findings pane that grows with its data instead of scrolling inside a pane token;
 *   - CLI checkpoints opening on the 320 px frame instead of the captured stdout;
 *   - an enlarge affordance that is not a <dialog>, or that cannot be closed;
 *   - narrative shown without its "not evidence" label (D-45);
 *   - a bare pixel size in the new gate styles (D-46 §2, tokens only).
 *
 * RUN: npx vitest run apps/studio/tests/regression/verdict-gate-layout.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

import type { DemoModel } from '@/lib/bridge-client';
import type { ReviewFindingsDoc } from '@/components/ReviewFindingsPanel';

const submitMock = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/bridge-client', () => ({
  submitVerdict: (...a: unknown[]) => submitMock(...(a as [])),
}));
const comments = vi.hoisted(() => ({
  load: { current: { cycleId: 'c', comments: [], derivedVerdict: { kind: 'approve' } } as unknown },
  add: { current: { error: 'unset' } as unknown },
}));
vi.mock('@/lib/review-comments-client', () => ({
  fetchReviewComments: vi.fn(async () => comments.load.current),
  addReviewComment: vi.fn(async () => comments.add.current),
  resolveReviewComment: vi.fn(),
  editReviewComment: vi.fn(),
  deleteReviewComment: vi.fn(),
  isResponse: (r: { comments?: unknown }) => r.comments !== undefined,
}));

import { DemoReviewSurface } from '@/components/DemoReviewSurface';

const INIT = 'INIT-2026-10-10-i1-honest-baseline';
const CYCLE = `2026-10-10T01-55-59_${INIT}`;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const MODEL: DemoModel = {
  title: 'I1 — An honest baseline',
  essence: 'e',
  project: 'gitweave',
  changedRef: '0162a36ae947629b6fb0be6963bca93c4c96f4c3',
  narrative: 'Establishes an honest baseline for GitWeave.',
  diffStat: '169 files changed, 2281 insertions(+), 26875 deletions(-)',
  acceptanceCriteria: [
    '(WI-1) GIVEN the remote WHEN `git ls-remote origin archive/april-2026` is run THEN the branch exists',
    '(WI-2) GIVEN the tree WHEN `bash scripts/bootstrap.sh` runs THEN it exits 0',
  ],
  testEvidence: [{ name: 'local: python3 -m pytest tests/', result: 'pass' }, { name: 'ci: python3 -m pytest tests/', result: 'pass' }],
  checkpoints: [
    { label: 'Plan 1: WI-1', caption: 'Archive branch exists', command: 'git ls-remote origin archive/april-2026', beforeOutput: 'd93c refs/heads/archive', afterOutput: 'd93c refs/heads/archive', beforeImage: PNG, afterImage: PNG, beforeVideoSrc: '.capture/before/p1.webm', afterVideoSrc: '.capture/after/p1.webm', delta: 'unchanged' },
    { label: 'Plan 4: WI-2', caption: 'bootstrap.sh exits 0 without Docker', command: 'bash scripts/bootstrap.sh', beforeOutput: '  docker ... ok', afterOutput: '\u001b[1mVerifying\u001b[0m', delta: 'changed', deltaExcerpt: '-   docker ... ok\n+ Verifying' },
    { label: 'homepage', caption: 'The home page', beforeImage: PNG, afterImage: PNG, delta: 'unknown' },
  ],
};

const FINDINGS: ReviewFindingsDoc = {
  headSha: 'e0a0a562ca15cde056c5ed55651c38885d9161f8',
  summary: '[WI-1] Deletion is clean. Three leaks remain. [WI-2] Docker removed.',
  whyWhatHow: {
    why: '[WI-1] Spike artefacts failed 317 tests. They obscured the baseline. Nobody used them. [WI-2] Bootstrap required Docker.',
    what: '[WI-1] Deletes metrics/. [WI-2] Drops the docker check.',
    how: '[WI-1] Pure deletions. [WI-2] Two line removals.',
  },
  acEvaluations: [
    { criterion: MODEL.acceptanceCriteria![1], verdict: 'missed', evidence: 'not run at head' },
    { criterion: MODEL.acceptanceCriteria![0], verdict: 'partial', evidence: 'no in-repo proof' },
  ],
  findings: [
    { id: 'WI-1/RF-2', severity: 'minor', category: 'containment', title: 'README lists metrics/' },
    { id: 'WI-1/RF-1', severity: 'major', category: 'containment', title: 'demo guide names a deleted file' },
    { id: 'WI-2/RF-1', severity: 'minor', category: 'boundary', title: 'terraform init needs the network' },
  ],
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  submitMock.mockClear();
  comments.load.current = { cycleId: 'c', comments: [], derivedVerdict: { kind: 'approve' } };
  comments.add.current = { error: 'unset' };
  // jsdom has no modal dialog implementation; the real browser's is what the page uses.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = container): T => {
  const el = scope.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const press = async (sel: string): Promise<void> => { await act(async () => { q<HTMLButtonElement>(sel).click(); }); };

async function renderGate(findings: ReviewFindingsDoc | null = FINDINGS, model: DemoModel = MODEL): Promise<void> {
  await act(async () => {
    root.render(React.createElement(DemoReviewSurface, {
      model, cycleId: CYCLE, initiativeId: INIT,
      reviewFindings: { doc: findings, absent: findings === null, error: false },
      costUsd: 24.9673, bridgeBase: 'http://bridge.test', reflectHref: `/artifact?run=${CYCLE}&type=reflection&mode=view`,
    }));
  });
  await act(async () => {});
}

test('four top-level blocks in decision → review → demo → details order, and nothing rendered twice', async () => {
  await renderGate();
  const top = [...q('[data-component="demo-review-surface"]').children].map((c) => c.getAttribute('data-section'));
  expect(top).toEqual(['gate-decision', 'review', 'demo-comparison', 'demo-details']);
  expect(container.querySelectorAll('[data-component="verdict-form"]').length).toBe(1);
  expect(container.querySelectorAll('[data-demo-region="ac-1"]').length).toBe(1);
});

test('the decision control lives in the first block, beside the labelled narrative and the measured facts', async () => {
  await renderGate();
  const band = q('[data-section="gate-decision"]');
  q('[data-component="verdict-form"] [data-action="approve-and-merge"]', band);
  const story = q('[data-section="demo-narrative"]', band);
  expect(story.textContent).toContain('Establishes an honest baseline for GitWeave.');
  expect(story.textContent).toContain('agent narrative — not evidence');
  expect(q('[data-fact="checkpoints"]', band).textContent).toContain('1 changed');
  expect(q('[data-fact="criteria"]', band).textContent).toMatch(/0 met[\s\S]*1 partial[\s\S]*1 missed/);
  expect(q('[data-fact="findings"]', band).textContent).toContain('1 major');
  expect(q('[data-fact="diff"]', band).textContent).toContain('169 files');
  expect(q('[data-fact="cost"]', band).textContent).toContain('$24.97');
  // The derived verdict counts comments only; the reviewer's open claims are named beside it, never folded in.
  expect(q('[data-section="review-claims"]', band).textContent).toMatch(/1 criterion missed[\s\S]*1 major finding[\s\S]*e0a0a56[\s\S]*0162a36/);
});

test('criteria are the first comment regions in document order, each joined to its own evaluation, wrapping inside its row', async () => {
  await renderGate();
  const regions = [...container.querySelectorAll('[data-demo-region]')].map((r) => r.getAttribute('data-demo-region'));
  expect(regions.slice(0, 2)).toEqual(['ac-1', 'ac-2']);
  expect(regions).toContain('checkpoint-1');
  const ac1 = q('[data-demo-region="ac-1"]');
  expect(ac1.getAttribute('data-ac-verdict')).toBe('partial');
  expect(q('[data-demo-region="ac-2"]').getAttribute('data-ac-verdict')).toBe('missed');
  expect(ac1.textContent).toContain('git ls-remote origin archive/april-2026');
  const crit = q<HTMLElement>('[data-criterion-text]', ac1);
  expect(crit.style.overflowWrap).toBe('anywhere');
  expect(['0', '0px']).toContain(q<HTMLElement>('[data-action="toggle-region"]', ac1).style.minWidth);
});

test('the review panes scroll inside a pane token; the findings pane names a stale review head', async () => {
  await renderGate();
  const findings = q('[data-section="review-findings"]');
  expect(findings.getAttribute('data-findings-count')).toBe('3');
  expect(findings.getAttribute('data-review-stale')).toBe('true');
  expect(findings.textContent).toMatch(/e0a0a56[\s\S]*0162a36/);
  expect([...findings.querySelectorAll('[data-finding-group]')].map((g) => g.getAttribute('data-finding-group'))).toEqual(['WI-1', 'WI-2']);
  expect([...findings.querySelectorAll('[data-finding]')].map((f) => f.getAttribute('data-finding'))).toEqual(['WI-1/RF-1', 'WI-1/RF-2', 'WI-2/RF-1']);
  for (const sel of ['[data-section="ac-verdicts"]', '[data-section="review-findings"]']) {
    expect(q<HTMLElement>(`${sel} [data-pane-body]`).style.height).toBe('var(--pane-md)');
  }
});

test('why · what · how splits per work item into titled, sentence-bounded blocks — never one paragraph per field', async () => {
  await renderGate();
  await press('[data-action="findings-tab"][data-tab="why-what-how"]');
  const www = q<HTMLElement>('[data-section="why-what-how"]');
  expect(www.hidden).toBe(false);
  const groups = www.querySelectorAll('[data-www-group]');
  expect([...groups].map((g) => g.getAttribute('data-www-group'))).toEqual(['WI-1', 'WI-2']);
  const why1 = q('[data-narrative="why"]', groups[0]!);
  expect(why1.querySelectorAll('li').length).toBe(2);
  expect(why1.textContent).not.toContain('Bootstrap required Docker');
  expect(why1.textContent).toContain('1 more');
});

test('a command checkpoint opens on its captured stdout (escapes stripped); a frame-only one on its frame; video on request', async () => {
  await renderGate();
  expect(q('[data-section="demo-comparison"] [data-checkpoint]').getAttribute('data-checkpoint')).toBe('Plan 1: WI-1');
  expect(q('[data-side="before"]').getAttribute('data-media-kind')).toBe('output');
  await press('[data-action="select-checkpoint"][data-checkpoint-index="1"]');
  expect(q('[data-checkpoint-delta]').getAttribute('data-checkpoint-delta')).toBe('changed');
  expect(q('[data-side="after"] pre').textContent).toBe('Verifying');
  expect(q('[data-section="checkpoint-delta"]').textContent).toContain('docker ... ok');
  await press('[data-action="select-checkpoint"][data-checkpoint-index="2"]');
  expect(q('[data-side="before"]').getAttribute('data-media-kind')).toBe('frame');
  await press('[data-action="select-checkpoint"][data-checkpoint-index="0"]');
  await press('[data-side="after"] [data-action="media-mode"][data-media-mode="video"]');
  expect(q<HTMLVideoElement>('[data-side="after"] video').getAttribute('src'))
    .toBe(`http://bridge.test/api/artifact/${encodeURIComponent(CYCLE)}/${encodeURIComponent('.capture/after/p1.webm')}`);
  expect(q('[data-side="before"]').getAttribute('data-media-kind')).toBe('output');
});

test('enlarge opens a <dialog> with both sides and closes again', async () => {
  await renderGate();
  const dialog = q<HTMLDialogElement>('dialog[data-section="evidence-lightbox"]');
  expect(dialog.hasAttribute('open')).toBe(false);
  await press('[data-side="after"] [data-action="enlarge-evidence"]');
  expect(dialog.hasAttribute('open')).toBe(true);
  expect(dialog.querySelectorAll('[data-lightbox-side]').length).toBe(2);
  await press('[data-action="close-lightbox"]');
  expect(dialog.hasAttribute('open')).toBe(false);
});

test('approve submits, and the card turns into the reflect payoff', async () => {
  await renderGate();
  await press('[data-action="approve-and-merge"]');
  expect(submitMock).toHaveBeenCalledWith({ kind: 'approve', initiativeId: INIT, rationale: 'Approved on the visual review — no blocking comments.' });
  expect(q('[data-component="verdict-form"]').getAttribute('data-form-state')).toBe('submitted');
  expect(q<HTMLAnchorElement>('[data-section="gate-decision"] [data-action="open-reflect"]').getAttribute('href'))
    .toBe(`/artifact?run=${CYCLE}&type=reflection&mode=view`);
});

test('an absent review renders the honest one-liner in its pane, not an empty box', async () => {
  await renderGate(null);
  expect(q('[data-section="review-findings"]').getAttribute('data-findings-state')).toBe('absent');
  expect(q('[data-demo-region="ac-1"]').getAttribute('data-ac-verdict')).toBe('unjudged');
});

test('the gate styles use the density tokens only — no bare pixel sizes (D-46 §2)', () => {
  const studio = resolve(__dirname, '../..');
  const gateDir = join(studio, 'components/studio/gate');
  const files = [...readdirSync(gateDir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts')).map((f) => join(gateDir, f)), join(studio, 'components/DemoReviewSurface.tsx')];
  expect(files.length).toBeGreaterThan(3);
  // A size property given a bare number (other than 0) or a string carrying `<n>px`.
  const bare = /\b(?:padding\w*|margin\w*|gap|fontSize|width|height|maxWidth|minWidth|maxHeight|minHeight|top|left|right|bottom|borderRadius|inset)\s*:\s*(?:[1-9]\d*\b|'[^']*\d+px)/;
  const hits = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l, i) => [f, i + 1, l] as const))
    .filter(([, , l]) => bare.test(l))
    .map(([f, n, l]) => `${f.replace(studio, '')}:${n}: ${l.trim()}`);
  expect(hits).toEqual([]);
});

test('a failed comments read never derives approve: both verdict buttons are disabled with the reason', async () => {
  comments.load.current = { error: 'the review comments could not be loaded (HTTP 502)' };
  await renderGate();
  const approve = q<HTMLButtonElement>('[data-action="approve-and-merge"]');
  expect(approve.disabled).toBe(true);
  expect(approve.getAttribute('data-disabled-reason')).toContain('HTTP 502');
  expect(q<HTMLButtonElement>('[data-action="compose-send-back"]').disabled).toBe(true);
  expect(q('[data-comments-load="error"]').textContent).toContain('HTTP 502');
});

test('a refused comment keeps the typed draft open and says so beside the form', async () => {
  comments.add.current = { error: 'HTTP 500' };
  await renderGate();
  await press('[data-section="demo-comparison"] [data-action="comment-region"]');
  const box = q<HTMLTextAreaElement>('[data-section="demo-comparison"] [data-field="comment-body"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'the archive branch is not checked');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await press('[data-section="demo-comparison"] [data-action="add-comment"]');
  expect(q<HTMLTextAreaElement>('[data-section="demo-comparison"] [data-field="comment-body"]').value).toBe('the archive branch is not checked');
  expect(q('[data-section="demo-comparison"] [role="alert"]').textContent).toContain('not saved');
});

test('a comment draft does not follow the operator to another checkpoint', async () => {
  await renderGate();
  await press('[data-section="demo-comparison"] [data-action="comment-region"]');
  expect(container.querySelector('[data-section="demo-comparison"] [data-comment-form]')?.getAttribute('data-region')).toBe('checkpoint-1');
  await press('[data-action="select-checkpoint"][data-checkpoint-index="1"]');
  expect(container.querySelector('[data-section="demo-comparison"] [data-comment-form]')).toBeNull();
});

test('an open blocker on an unselected checkpoint is flagged on its stop, and the jump selects it', async () => {
  comments.load.current = {
    cycleId: 'c',
    comments: [{ id: 'C-1', region: 'checkpoint-2', body: 'docker still required', blocking: true, resolved: false, at: '2026-10-10T07:21:01Z' }],
    derivedVerdict: { kind: 'send-back', rationale: '[checkpoint-2] docker still required', acceptanceCriteria: [] },
  };
  await renderGate();
  expect(q('[data-action="select-checkpoint"][data-checkpoint-index="1"]').getAttribute('data-stop-blocking')).toBe('1');
  expect(q('[data-demo-region^="checkpoint-"]').getAttribute('data-demo-region')).toBe('checkpoint-1');
  await press('[data-action="jump-to-blocking"]');
  expect(q('[data-demo-region^="checkpoint-"]').getAttribute('data-demo-region')).toBe('checkpoint-2');
  q('[data-demo-region="checkpoint-2"]');
  expect(container.querySelector('[data-section="demo-comparison"] [data-comment-resolved="false"] [data-action="resolve-comment"]')).not.toBeNull();
});

test('a non-http PR link in the demo data renders as text, never as a clickable href', async () => {
  await renderGate(FINDINGS, { ...MODEL, summary: { bullets: ['WI-1 [complete] # WI-1: Archive'], prUrl: 'javascript:alert(1)' } });
  const details = q('[data-section="demo-summary"]');
  expect(details.textContent).toContain('javascript:alert(1)');
  expect(details.querySelector('a')).toBeNull();
});
