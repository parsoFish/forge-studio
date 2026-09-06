/**
 * The greenfield CREATE route must mint the project's GitHub remote — bead
 * `forge-8vfn.6.11.27`, T1 ruling 320's companion.
 *
 * WHAT S2 RUN 4 MEASURED. Beat 5 red: `resolution-failing-count` expected 2 got
 * 3, `resolution-user-count` expected 0 got 1. The created project had **no git
 * remote at all** — `git remote -v` empty — and preflight said so by name:
 * "no GitHub remote found — there is no PR surface for the operator to merge".
 * C6 is the clause **#477** was merged to close.
 *
 * WHY #477 DID NOT CLOSE IT. `project-create.ts:471` is
 *
 *     const remoteUrl = input.remote?.create === true ? mintRemote(...) : undefined;
 *
 * and NEITHER production caller passes `remote`:
 *   · the bridge route the operator's "Create project" button hits
 *     (`bridge-studio-project-onboard.ts:200`) sends `manifest`, `forgeRoot`,
 *     `projectsRoot` — no `remote`;
 *   · `apps/forge/cli.ts:530` sends `manifest`, `forgeRoot` — no `remote`.
 *
 * So `mintRemote` is unreachable in production. Its own unit test
 * (`tests/unit/project-create-remote.test.ts`) passes because it calls the
 * function DIRECTLY with an injected `runGh` — which is exactly why 6.11.2's
 * creation half was closed without a story ever proving it. A capability wired,
 * unit-tested against a fake, and never reached by the path the operator takes.
 *
 * THIS TEST DRIVES THE ROUTE, NOT THE FUNCTION, with the story's own request
 * shape (S2 beat 3 fills `create-name`, `create-north-star`, `create-app-type`
 * and presses `create-project`), so it cannot pass while the wiring is absent.
 * `gh` is never touched: the route must reach a `runGh` this test injects, and
 * a test that had to reach the network would be the same mistake one layer up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';

import { type RouteContext } from '@forge/kernel';
import { makeOnboardHandlers } from '../../bridge-studio-project-onboard.ts';
import { projectStartersDir } from '../../project-create.ts';

const FORGE_ROOT = join(import.meta.dirname, '..', '..', '..', '..');

type Captured = { status: number | null; body: string };

function mockRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

const mockReq = () => ({ headers: {} }) as never;

function ctx(forgeRoot: string, body: unknown): RouteContext {
  return { forgeRoot, logsRoot: join(forgeRoot, '_logs'), readBody: async () => body } as RouteContext;
}

/** Write the operator switch this feature is gated behind (ruling 323). */
function setRemoteSwitch(forgeRoot: string, create: boolean): void {
  writeFileSync(join(forgeRoot, 'forge.config.json'), `${JSON.stringify({ projects: { remote: { create } } }, null, 2)}\n`);
}

function forgeRootWithStarters(): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'create-remote-'));
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });
  const dest = join(forgeRoot, 'studio', 'starters', 'projects');
  mkdirSync(dest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), dest, { recursive: true });
  return forgeRoot;
}

/** S2 beat 3's request, as the form sends it. */
const STORY_BODY = {
  name: 'story-S2',
  appType: 'cli',
  northStar: 'A CLI that reports commit churn, so a maintainer can see where the code moves.',
};

test('6.11.27: the CREATE ROUTE mints a remote — the path the operator takes, not the function', async () => {
  const forgeRoot = forgeRootWithStarters();
  setRemoteSwitch(forgeRoot, true);
  const ghCalls: string[][] = [];
  try {
    const { handleProjectsCreate } = makeOnboardHandlers({
      runGh: (args: string[]) => {
        ghCalls.push(args);
        return args[0] === 'auth' ? 'Logged in to github.com' : '';
      },
    } as never);
    const { res, captured } = mockRes();

    const answered = await handleProjectsCreate(
      mockReq(), res, ctx(forgeRoot, STORY_BODY), '/api/studio/projects/create', 'POST',
    );

    assert.equal(answered, true);
    assert.equal(captured.status, 200, `create must succeed; body: ${captured.body}`);

    // THE ASSERTION THAT WAS MISSING. S2 beat 5 reads C6 through the DOM, and
    // C6 passes iff `git remote get-url origin` names a github.com remote. The
    // route must therefore have asked for one.
    assert.ok(
      ghCalls.some((a) => a.includes('repo') && a.includes('create')),
      `the create route must mint a GitHub remote; gh was called with: ${JSON.stringify(ghCalls)}`,
    );

    const body = JSON.parse(captured.body || '{}');
    assert.ok(
      typeof body.remoteUrl === 'string' && body.remoteUrl.includes('github.com'),
      `the response must name the minted remote so the UI can show it; got ${JSON.stringify(body.remoteUrl)}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('323: with the switch OFF — the default — nothing reaches gh and the project is still created', async () => {
  // The positive control, and the reason the switch exists. Minting is an
  // irreversible OUTWARD act: a real repository under the operator's account,
  // attached to an otherwise local routine. A mistyped name must not leave one
  // behind. Creation stays entirely local unless the operator opts in — the
  // same shape the story sweep's DELETE is gated with (ruling 303), so the two
  // halves are symmetrical rather than one free and one guarded.
  const forgeRoot = forgeRootWithStarters();
  setRemoteSwitch(forgeRoot, false);
  const ghCalls: string[][] = [];
  try {
    const { handleProjectsCreate } = makeOnboardHandlers({
      runGh: (args: string[]) => { ghCalls.push(args); return ''; },
    } as never);
    const { res, captured } = mockRes();

    const answered = await handleProjectsCreate(
      mockReq(), res, ctx(forgeRoot, STORY_BODY), '/api/studio/projects/create', 'POST',
    );

    assert.equal(answered, true);
    assert.equal(captured.status, 200, `create must still succeed with the switch off; body: ${captured.body}`);
    assert.deepEqual(ghCalls, [], 'the default must not leave the machine');

    const body = JSON.parse(captured.body || '{}');
    assert.ok(!('remoteUrl' in body), 'no remote, no key — never a present-and-empty field claiming a repo exists');
    assert.equal(body.id, 'story-s2', 'and the project itself is created exactly as before');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('323: an ABSENT config is the same as off — the switch fails closed', async () => {
  // A missing or unparseable config must never be read as consent to create a
  // repository. `loadConfig` returns {} for both, and {} must mean OFF.
  const forgeRoot = forgeRootWithStarters();
  const ghCalls: string[][] = [];
  try {
    const { handleProjectsCreate } = makeOnboardHandlers({
      runGh: (args: string[]) => { ghCalls.push(args); return ''; },
    } as never);
    const { res, captured } = mockRes();
    await handleProjectsCreate(mockReq(), res, ctx(forgeRoot, STORY_BODY), '/api/studio/projects/create', 'POST');
    assert.equal(captured.status, 200);
    assert.deepEqual(ghCalls, [], 'no config must not mean "yes"');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
