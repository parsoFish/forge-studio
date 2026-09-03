/**
 * start-default-repo-path-guard.test.ts — bead forge-8vfn.5.51.
 *
 * THE GAP. All four `/start` arms accept an optional `projectRepoPath` and
 * default it to `<projectsRoot>/<body.project>` when absent. The instructions
 * and demo arms resolve that default through `resolveGuardedPath` and 400 on
 * failure — fixes tagged `forge-osz` and `forge-4vt`, whose own comments say the
 * containment they replaced was "an accident of SOURCE ORDER". The architect and
 * project-brain arms never got the back-port and still build it raw.
 *
 * WHY THIS IS A SOURCE / ORDERING GATE AND NOT A WIRE TEST — measured, not
 * assumed. A wire-level control was written first and PASSED against the
 * unfixed arms: `POST /api/architect/start` and `POST /api/project-brain/start`
 * with `project: '../../etc'` and no `projectRepoPath` already answer
 * `400 {"error":"invalid project"}` and create nothing outside the root,
 * because `guardedSessionDir` runs earlier and performs an equivalent
 * per-segment check on `body.project`. A control that a fix cannot change is not
 * a control, so it was reworked rather than kept.
 *
 * That incidental protection is exactly the problem. `guardedSessionDir` exists
 * to validate the SESSION directory, not this field; nothing downstream
 * re-validates (`instructions-runner.ts` calls
 * `mkdirSync(status.project_repo_path)` with no second check); and a reordering,
 * or a fifth `/start`-shaped route copied from architect, silently reopens it.
 * So the assertion is structural, the same shape and for the same stated reason
 * as `cli/instructions-start-read-guard.test.ts`: the oracle is not observable
 * through the wire, and a structural claim is the only honest RED-AT-BASE one.
 *
 * RED AT BASE: both assertions below fail on the arms as they stand before
 * 5.51. That was verified before the fix was written, not after.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ARMS = [
  {
    kind: 'architect',
    file: 'bridge-studio-architect.ts',
    startMarker: "url === '/api/architect/start'",
    endMarker: "url === '/api/architect/answer'",
  },
  {
    kind: 'project-brain',
    file: 'bridge-studio-project-brain.ts',
    startMarker: "url === '/api/project-brain/start'",
    endMarker: "url === '/api/project-brain/brief'",
  },
  // The two that already have the fix — included so this gate proves it is
  // asserting something real rather than a property every arm happens to have.
  {
    kind: 'instructions',
    file: 'bridge-studio-instructions.ts',
    startMarker: "url === '/api/instructions/start'",
    endMarker: "url === '/api/instructions/brief'",
  },
  {
    kind: 'demo-builder',
    file: 'bridge-studio-demo.ts',
    startMarker: "url === '/api/demo-builder/start'",
    endMarker: "url === '/api/demo-builder/brief'",
  },
] as const;

function armBlock(file: string, startMarker: string, endMarker: string): string {
  const src = readFileSync(join(import.meta.dirname, '..', '..', file), 'utf8');
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `could not locate the ${startMarker} handler in ${file}`);
  const end = src.indexOf(endMarker, start);
  assert.ok(end > start, `could not bound the ${startMarker} handler in ${file}`);
  return src.slice(start, end);
}

for (const arm of ARMS) {
  test(`${arm.kind}/start resolves its DEFAULT project_repo_path through a containment guard`, () => {
    const block = armBlock(arm.file, arm.startMarker, arm.endMarker);
    assert.ok(
      block.includes('resolveGuardedPath(ctx.projectsRoot, [body.project])'),
      `${arm.kind}/start builds its default project_repo_path from body.project without resolving it through ` +
        'resolveGuardedPath. It is not exploitable while guardedSessionDir happens to run first — but that guard ' +
        'validates the SESSION dir, not this field, nothing downstream re-validates before mkdirSync, and a ' +
        'reordering or a copied fifth route reopens it. See forge-osz / forge-4vt.',
    );
  });

  test(`${arm.kind}/start does NOT fold body.project into projectsRoot unguarded`, () => {
    const block = armBlock(arm.file, arm.startMarker, arm.endMarker);
    assert.ok(
      !block.includes('join(ctx.projectsRoot, body.project)'),
      `${arm.kind}/start still folds the raw body.project into projectsRoot. The guarded resolution must REPLACE ` +
        'that expression, not sit beside it — a guard whose result is then discarded is decorative.',
    );
  });
}
