/**
 * W8-B6 — the lint that MIRRORS hook dispatch's matcher rule.
 *
 * `hook-dispatch.ts` enforces a declared `matcher` in forge's own
 * `Tool(prefix)` syntax, inside the callback. That syntax needs a tool name to
 * match against, and only `PreToolUse`/`PostToolUse` carry one — the SDK's
 * `SessionEnd`/`SessionStart`/`Notification`/`UserPromptSubmit` inputs have no
 * `tool_name` field at all. So a matcher declared on one of those four can
 * never be honoured, and the hook silently does not fire.
 *
 * That is `declared-data-fails-open` again: a field an operator can type into
 * the authoring form (`forge-ui/app/hooks/new/page.tsx:108`) which changes
 * nothing and is reported nowhere. This repo's own standing lesson — recorded
 * verbatim in `hook-library.ts:329`'s header after the same class appeared a
 * third time — is that **defense-in-depth lint must mirror the dispatch it
 * backstops**, and that a rule production never invokes is inert.
 *
 * So the rule is a pure predicate with THREE callers, and this suite pins all
 * three. Two of them are bridge routes: gating only the create route and
 * leaving the update route open would be the one-of-N shape this whole wave has
 * been paying to close.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import {
  HOOK_LIFECYCLE_EVENTS,
  TOOL_SCOPED_HOOK_EVENTS,
  hookTriggerError,
  lintHookDefinitions,
  type HookLifecycleEvent,
} from './hook-library.ts';

const createdDirs: string[] = [];
after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hook-trigger-'));
  createdDirs.push(dir);
  return dir;
}

function writeHook(root: string, id: string, on: HookLifecycleEvent, matcher?: string): void {
  const dir = join(root, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({
      id,
      name: id,
      description: `Trigger-coherence fixture ${id}.`,
      on,
      ...(matcher !== undefined ? { matcher } : {}),
      script: 'scripts/run.sh',
      permissions: { env: [], read: [], network: false },
    }),
    'utf8',
  );
}

describe('hookTriggerError: the pure rule', () => {
  it('the tool-scoped set is exactly the two events whose SDK hook input carries a tool_name', () => {
    assert.deepEqual([...TOOL_SCOPED_HOOK_EVENTS], ['PreToolUse', 'PostToolUse']);
    for (const ev of TOOL_SCOPED_HOOK_EVENTS) {
      assert.ok((HOOK_LIFECYCLE_EVENTS as readonly string[]).includes(ev), `${ev} must be a real lifecycle event`);
    }
  });

  it('a matcher on a tool-scoped event is fine, on every other event it is an error naming both the event and the matcher', () => {
    for (const ev of HOOK_LIFECYCLE_EVENTS) {
      const err = hookTriggerError(ev, 'Bash(gh pr create)');
      if ((TOOL_SCOPED_HOOK_EVENTS as readonly string[]).includes(ev)) {
        assert.equal(err, undefined, `${ev} must accept a matcher`);
      } else {
        assert.ok(err, `${ev} must reject a matcher — dispatch can never honour it`);
        assert.match(err!, new RegExp(ev));
        assert.match(err!, /Bash\(gh pr create\)/);
      }
    }
  });

  it('no matcher is always fine, and a blank/whitespace matcher counts as none (it is what the authoring form submits for an empty field)', () => {
    for (const ev of HOOK_LIFECYCLE_EVENTS) {
      assert.equal(hookTriggerError(ev, undefined), undefined);
      assert.equal(hookTriggerError(ev, '   '), undefined);
    }
  });
});

describe('lintHookDefinitions surfaces it (kills: a rule that is implemented, unit-tested and inert)', () => {
  it('flags a matcher on a tool-less event, and stays silent on the coherent ones', () => {
    const root = makeRoot();
    writeHook(root, 'bad-session-end-matcher', 'SessionEnd', 'Bash(gh pr create)');
    writeHook(root, 'good-pre-tool-matcher', 'PreToolUse', 'Bash(gh pr create)');
    writeHook(root, 'good-session-end-plain', 'SessionEnd');

    const findings = lintHookDefinitions(root);
    const trigger = findings.filter((f) => f.check === 'hook-library/trigger');

    assert.equal(trigger.length, 1, `expected exactly one trigger finding, got ${JSON.stringify(findings)}`);
    assert.equal(trigger[0]!.object, 'hook:bad-session-end-matcher');
    assert.equal(trigger[0]!.level, 'error');
    assert.match(trigger[0]!.message, /SessionEnd/);
  });

  it('the OOTB hook packages shipped in this install are coherent', () => {
    // pre-pr-security-review declares `matcher: "Bash(gh pr create)"` on
    // PreToolUse, which is exactly the shape the rule permits. If this ever
    // goes red, a shipped hook has become undispatchable — that is the finding.
    const findings = lintHookDefinitions(join(import.meta.dirname, '..', '..'));
    assert.deepEqual(
      findings.filter((f) => f.check === 'hook-library/trigger'),
      [],
    );
  });
});
