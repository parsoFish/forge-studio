/**
 * Bead `forge-a9o9` (T1 rulings 670 / 691) — DENY BY DEFAULT, WITHOUT AN
 * ENUMERATION.
 *
 * WHAT WAS MEASURED. S1 run 5: the demo write pass denied every read door the
 * product knew about and read anyway, through `LSP`, `TaskOutput` and `Skill` —
 * three tools that appear NOWHERE in this repo. Not in an `allowed-tools` list,
 * not in a `disallowed-tools` list, not in any kind's spec. The SDK ships them
 * regardless. #641 closed those three for one pass of one kind; **19 skills
 * carry a deny list, and the complete set of tools the product has ever named
 * in one is twelve**, so every kind still has whatever the next SDK release
 * adds.
 *
 * WHY AN ALLOWLIST AND NOT A LONGER DENY LIST. `packages/kernel/spawn-env.ts`
 * settled this exact class one seam over, for env vars: "A denylist only stops
 * leaks the author already thought of; the env-leak class recurred three times
 * via NEW vars nobody had denylisted yet. An allowlist inverts the failure
 * mode: an unrecognised var is stripped by construction, not by omission."
 * That is the argument here, one layer along, and it is why T1's first wording
 * — the SDK's surface minus the kind's allowed set — was set aside: that is
 * still an enumeration, and it goes stale silently on the next release.
 *
 * WHY IT LIVES IN THE KERNEL. `allowedTools` is advisory and `disallowedTools`
 * is the only enforcement the SDK offers by name, so the enforcement has to be
 * `canUseTool`. The three spawn paths that need it sit in `packages/sessions`,
 * `packages/agents` and `packages/factory`; the kernel is the only layer all
 * three already stand on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toolFenceOptions, type CanUseTool } from '../../tool-fence.ts';

const CALL = (fence: CanUseTool, tool: string) => fence(tool, { a: 1 }, {});

test('forge-a9o9: a tool the kind never declared is DENIED, with no deny list anywhere', () => {
  const denied: string[] = [];
  const { canUseTool } = toolFenceOptions({ allowedTools: ['Read', 'Glob'], onDeny: (t) => denied.push(t) });

  return Promise.all([CALL(canUseTool, 'LSP'), CALL(canUseTool, 'TaskOutput'), CALL(canUseTool, 'Skill')])
    .then((rs) => {
      for (const r of rs) assert.equal(r.behavior, 'deny');
      assert.deepEqual(denied, ['LSP', 'TaskOutput', 'Skill'], 'and each refusal is announced, so a kind can log which door was tried');
      // The three that were MEASURED being used. Nothing names them in the
      // fence — they are denied for not being declared, which is the property
      // that also covers the next three nobody has heard of.
      assert.match((rs[0] as { message: string }).message, /LSP/, 'the refusal names the tool');
      assert.match((rs[0] as { message: string }).message, /not declared/i, 'and says why, so an agent stops hunting instead of trying the next door');
    });
});

test('forge-a9o9: the kind\'s OWN tools still work — unattended operation is the point', async () => {
  const { canUseTool } = toolFenceOptions({ allowedTools: ['Read', 'Glob', 'Write'], onDeny: () => {} });

  for (const tool of ['Read', 'Glob', 'Write']) {
    const r = await CALL(canUseTool, tool);
    assert.equal(r.behavior, 'allow', `${tool} is declared and must pass`);
    assert.deepEqual((r as { updatedInput: unknown }).updatedInput, { a: 1 }, 'unchanged — the fence decides, it does not rewrite');
  }
});

test('forge-a9o9: the three settings arrive together, because a fence is not one setting', () => {
  // `session-write-fence.ts` paid for this: "a fence is three settings, not
  // one". `permissionMode: 'acceptEdits'` auto-accepts the edit tools and
  // `allowedTools` pre-approves every listed name, and either one short-circuits
  // the prompt the callback rides on. Live evidence there: a turn ran with a
  // non-empty writeRoots and still wrote three files outside every root.
  const opts = toolFenceOptions({ allowedTools: ['Read'], onDeny: () => {} });

  assert.equal(opts.permissionMode, 'default', "acceptEdits would short-circuit the callback for the very tools it must gate");
  assert.deepEqual(opts.allowedTools, ['Read'], 'the declared names stay pre-approved, so a normal turn never pauses');
  assert.equal(typeof opts.canUseTool, 'function');
});

test('forge-a9o9: an existing write-root fence COMPOSES — the tool gate runs first, then its rule', async () => {
  // brain-fix and adversarial-review already run fenced. Deny-by-default must
  // not replace that decision, only precede it: undeclared tools never reach
  // the inner fence, and a declared one is still subject to it.
  const seen: string[] = [];
  const inner = {
    permissionMode: 'default' as const,
    allowedTools: ['Read'], // the write-gated names were stripped by the inner builder
    canUseTool: (async (tool: string) => {
      seen.push(tool);
      return tool === 'Write'
        ? { behavior: 'deny' as const, message: 'outside every write root' }
        : { behavior: 'allow' as const, updatedInput: {} };
    }) as CanUseTool,
  };
  const { canUseTool, allowedTools } = toolFenceOptions({ allowedTools: ['Read', 'Write'], onDeny: () => {}, inner });

  assert.deepEqual(allowedTools, ['Read'], "the inner fence's stripped list wins — it stripped those names to make the SDK route them");

  assert.equal((await CALL(canUseTool, 'LSP')).behavior, 'deny');
  assert.deepEqual(seen, [], 'an undeclared tool never reaches the write-root fence');

  assert.equal((await CALL(canUseTool, 'Write')).behavior, 'deny', 'and a DECLARED tool is still subject to the inner rule');
  assert.deepEqual(seen, ['Write'], 'which it reached');
});

test('forge-a9o9: an EMPTY allowed set denies everything rather than allowing everything', () => {
  // The fail-open reading of "no allowlist configured" is the whole bug class
  // this closes. `spawn-env.ts` makes the same choice for env vars.
  const { canUseTool } = toolFenceOptions({ allowedTools: [], onDeny: () => {} });
  return CALL(canUseTool, 'Read').then((r) => assert.equal(r.behavior, 'deny', 'a kind that declares nothing gets nothing'));
});
