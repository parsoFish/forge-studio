/**
 * Tests for orchestrator/pr-verdict.ts (P3 — PR-comment verdict provider).
 *   - parseVerdictComment grammar (approve / send-back / non-verdict)
 *   - makePrCommentVerdict: posts a prompt, polls, returns the operator's
 *     verdict; ignores its own prompt/ack sentinels + pre-baseline comments
 *   - throws when no PR can be resolved
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePrCommentVerdict, parseVerdictComment, type GhRunner } from './pr-verdict.ts';
import type { PrRef } from './pr.ts';
import type { VerdictContext } from './file-verdict.ts';

const PR: PrRef = { owner: 'o', repo: 'r', number: 7, url: 'https://github.com/o/r/pull/7' };

function ctx(roundNumber = 1): VerdictContext {
  return {
    initiativeId: 'INIT-2026-05-18-x',
    worktreePath: '/tmp/wt',
    manifestPath: '/tmp/m.md',
    prDescriptionPath: '/tmp/wt/.forge/pr-description.md',
    demoBundleDir: '/tmp/wt/.forge/demos/INIT-2026-05-18-x',
    workItems: [],
    diffSummary: '',
    roundNumber,
  };
}

const noSleep = async (): Promise<void> => {};

test('parseVerdictComment: approve forms', () => {
  assert.deepEqual(parseVerdictComment('forge: approve\nlooks great'), {
    kind: 'approve',
    rationale: 'forge: approve\nlooks great',
  });
  assert.equal(parseVerdictComment('/approve')?.kind, 'approve');
});

test('parseVerdictComment: send-back with ACs', () => {
  const v = parseVerdictComment(
    'forge: send-back\nmissing tests\n- GIVEN a saturated map WHEN it runs THEN no two cars overlap',
  );
  assert.equal(v?.kind, 'send-back');
  if (v?.kind === 'send-back') {
    assert.equal(v.feedback.length, 1);
    assert.equal(v.feedback[0].then, 'no two cars overlap');
  }
});

test('parseVerdictComment: send-back WITHOUT ACs is not actionable (null)', () => {
  assert.equal(parseVerdictComment('forge: send-back\nplease fix it'), null);
});

test('parseVerdictComment: a normal comment is not a verdict', () => {
  assert.equal(parseVerdictComment('nice work, one question about the demo'), null);
});

test('makePrCommentVerdict: returns approve from a fresh operator comment', async () => {
  const calls: string[][] = [];
  let listCount = 0;
  const gh: GhRunner = (args) => {
    calls.push(args);
    if (args[0] === 'api') {
      listCount += 1;
      // Baseline + first poll: only pre-existing + our prompt. Second poll:
      // operator's approve appears (id 99).
      if (listCount <= 2) {
        return [
          JSON.stringify({ id: 1, login: 'someone', body: 'old chatter' }),
          JSON.stringify({ id: 50, login: 'forge-bot', body: '<!-- forge:verdict-prompt -->\nround 1' }),
        ].join('\n');
      }
      return [
        JSON.stringify({ id: 1, login: 'someone', body: 'old chatter' }),
        JSON.stringify({ id: 50, login: 'forge-bot', body: '<!-- forge:verdict-prompt -->\nround 1' }),
        JSON.stringify({ id: 99, login: 'operator', body: 'forge: approve\nship it' }),
      ].join('\n');
    }
    return ''; // `gh pr comment`
  };
  const getVerdict = makePrCommentVerdict({
    worktreePath: '/tmp/wt',
    initiativeId: 'INIT-2026-05-18-x',
    gh,
    resolvePr: () => PR,
    sleep: noSleep,
    pollIntervalMs: 1,
  });
  const v = await getVerdict(ctx(1));
  assert.equal(v.kind, 'approve');
  // It posted a prompt comment and an ack comment.
  const commentPosts = calls.filter((c) => c[0] === 'pr' && c[1] === 'comment');
  assert.equal(commentPosts.length, 2, 'one prompt + one ack');
  // argv = ['pr','comment','<n>','--body','<body>'] → body is index 4
  assert.match(commentPosts[0][4], /verdict-prompt/);
  assert.match(commentPosts[1][4], /verdict-ack/);
});

test('makePrCommentVerdict: ignores pre-baseline comments (no false early return)', async () => {
  let listCount = 0;
  const gh: GhRunner = (args) => {
    if (args[0] !== 'api') return '';
    listCount += 1;
    // A pre-existing approve (id 5) exists BEFORE the prompt — must be
    // ignored (it predates this round). Operator's real reply is id 200.
    const base = [JSON.stringify({ id: 5, login: 'operator', body: 'forge: approve (from a previous round)' })];
    if (listCount >= 3) {
      base.push(JSON.stringify({ id: 200, login: 'operator', body: 'forge: send-back\n- GIVEN x WHEN y THEN z' }));
    }
    return base.join('\n');
  };
  const getVerdict = makePrCommentVerdict({
    worktreePath: '/tmp/wt',
    initiativeId: 'INIT-2026-05-18-x',
    gh,
    resolvePr: () => PR,
    sleep: noSleep,
    pollIntervalMs: 1,
  });
  const v = await getVerdict(ctx(2));
  assert.equal(v.kind, 'send-back');
});

test('makePrCommentVerdict: throws when no open PR', async () => {
  const getVerdict = makePrCommentVerdict({
    worktreePath: '/tmp/wt',
    initiativeId: 'INIT-2026-05-18-x',
    gh: () => '',
    resolvePr: () => null,
    sleep: noSleep,
  });
  await assert.rejects(() => getVerdict(ctx(1)), /no open PR/);
});

test('makePrCommentVerdict: honours timeoutMs', async () => {
  let t = 0;
  const getVerdict = makePrCommentVerdict({
    worktreePath: '/tmp/wt',
    initiativeId: 'INIT-2026-05-18-x',
    gh: (args) => (args[0] === 'api' ? '' : ''), // never any verdict comment
    resolvePr: () => PR,
    sleep: noSleep,
    now: () => (t += 1000),
    timeoutMs: 1500,
    pollIntervalMs: 1,
  });
  await assert.rejects(() => getVerdict(ctx(1)), /timed out/);
});
