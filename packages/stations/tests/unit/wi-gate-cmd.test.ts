/**
 * forge-mfv5.3.6 (operator ruling 2026-09-12) — `deriveWiGateCmd`, the ONE
 * place a work item's effective per-WI gate is decided
 * (`packages/stations/phases/wi-quality-gate.ts`, called from
 * `developer-loop.ts`'s per-WI dispatch).
 *
 * Precedence: the WI's own `quality_gate_cmd` > the project's
 * `testProcess.local.perWorkItem` template filled with the WI's package > the
 * project-wide gate. Like ADR 037's deterministic injector, the template only
 * fills an OMITTED field — it never overrides what the plan agent wrote.
 *
 * `{package}` is the common directory of `files_in_scope` ∪ `creates`. When
 * there is none below the repo root the template is NOT used (never widened
 * to the root): the project-wide gate runs and `templateSkipped` names why,
 * so the caller can log it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { EventLogger } from '@forge/kernel';

import { emitWiGateTemplateSkipped } from '../../phases/dev-loop-events.ts';
import { deriveWiGateCmd, wiPackageDir } from '../../phases/wi-quality-gate.ts';

const TEMPLATE = ['go', 'test', '-tags', 'all', '-count=1', './{package}/...'];
const PROJECT_GATE = ['go', 'test', '-tags', 'all', '-count=1', './azuredevops/internal/service/servicehook/...'];
const GIT_DIR = 'azuredevops/internal/service/git';

test('forge-mfv5.3.6 derivation: a file plus a glob in the same directory reduce to that directory', () => {
  assert.equal(wiPackageDir([`${GIT_DIR}/resource_repo.go`, `${GIT_DIR}/*_test.go`]), GIT_DIR);
});

test('forge-mfv5.3.6 derivation: files_in_scope ∪ creates in one package fill the template with ./<dir>/...', () => {
  const got = deriveWiGateCmd({
    wi: { files_in_scope: [`${GIT_DIR}/resource_repo.go`, `${GIT_DIR}/*_test.go`], creates: [`${GIT_DIR}/resource_repo_branch.go`] },
    template: TEMPLATE,
    fallback: PROJECT_GATE,
  });
  assert.deepEqual(got.cmd, ['go', 'test', '-tags', 'all', '-count=1', `./${GIT_DIR}/...`]);
  assert.equal(got.source, 'template');
  assert.equal(got.templateSkipped, undefined);
});

test('forge-mfv5.3.6 derivation: sibling packages reduce to their common parent; a dir/ entry is itself; a glob its static prefix', () => {
  assert.equal(wiPackageDir(['azuredevops/internal/service/git/a.go', 'azuredevops/internal/service/core/b.go']), 'azuredevops/internal/service');
  assert.equal(wiPackageDir(['./azuredevops/internal/service/git/']), GIT_DIR);
  assert.equal(wiPackageDir(['azuredevops/internal/service/*/resource_*.go']), 'azuredevops/internal/service');
});

test('forge-mfv5.3.6 derivation: paths spanning two top-level dirs use the project-wide gate, and name why', () => {
  const paths = [`${GIT_DIR}/resource_repo.go`, 'website/docs/r/git_repository.html.markdown'];
  const got = deriveWiGateCmd({ wi: { files_in_scope: paths }, template: TEMPLATE, fallback: PROJECT_GATE });
  assert.deepEqual(got.cmd, PROJECT_GATE, 'never widened to the repo root — the project-wide gate runs');
  assert.equal(got.source, 'project');
  assert.deepEqual(got.templateSkipped, { reason: 'no-common-package-dir', paths });

  const events: Array<Record<string, unknown>> = [];
  const logger = { emit: (e: Record<string, unknown>) => { events.push(e); return { ...e, event_id: 'e1' }; } } as unknown as EventLogger;
  emitWiGateTemplateSkipped(logger, { initiativeId: 'INIT-1', parentEventId: 'p1', workItemId: 'WI-2', skill: 'developer-ralph', skipped: got.templateSkipped! });
  assert.equal(events.length, 1);
  assert.equal(events[0]!.message, 'gate.template-skipped');
  assert.equal(events[0]!.event_type, 'log');
  assert.deepEqual(events[0]!.metadata, { work_item_id: 'WI-2', reason: 'no-common-package-dir', paths, gate_source: 'project' });
});

test('forge-mfv5.3.6 derivation: a root-level file, an escaping path, or no paths at all never fill the template', () => {
  for (const paths of [['go.mod', `${GIT_DIR}/a.go`], ['../elsewhere/a.go'], ['/abs/a.go'], ['*.go'], []]) {
    const got = deriveWiGateCmd({ wi: { files_in_scope: paths }, template: TEMPLATE, fallback: PROJECT_GATE });
    assert.deepEqual(got.cmd, PROJECT_GATE, `paths ${JSON.stringify(paths)} must not fill the template`);
    assert.equal(got.templateSkipped?.reason, 'no-common-package-dir');
  }
});

test('forge-mfv5.3.6 precedence: an explicit WI gate wins over the template', () => {
  const own = ['go', 'test', '-run', 'TestResourceGitRepository_Branch', `./${GIT_DIR}/...`];
  const got = deriveWiGateCmd({ wi: { quality_gate_cmd: own, files_in_scope: [`${GIT_DIR}/resource_repo.go`] }, template: TEMPLATE, fallback: PROJECT_GATE });
  assert.deepEqual(got.cmd, own);
  assert.equal(got.source, 'work-item');
  assert.equal(got.templateSkipped, undefined);
});

test('forge-mfv5.3.6 precedence: an absent WI gate plus a template yields the filled template', () => {
  const got = deriveWiGateCmd({ wi: { files_in_scope: [`${GIT_DIR}/resource_repo.go`] }, template: TEMPLATE, fallback: PROJECT_GATE });
  assert.deepEqual(got.cmd, ['go', 'test', '-tags', 'all', '-count=1', `./${GIT_DIR}/...`]);
  assert.equal(got.source, 'template');
});

test("forge-mfv5.3.6 precedence: no template yields today's fallback — the project-wide gate, or none", () => {
  const got = deriveWiGateCmd({ wi: { files_in_scope: [`${GIT_DIR}/resource_repo.go`] }, template: undefined, fallback: PROJECT_GATE });
  assert.deepEqual(got.cmd, PROJECT_GATE);
  assert.equal(got.source, 'project');
  assert.equal(got.templateSkipped, undefined, 'no template declared is not a skip');
  assert.equal(deriveWiGateCmd({ wi: { files_in_scope: [] }, template: undefined, fallback: undefined }).cmd, null);
  assert.equal(deriveWiGateCmd({ wi: { quality_gate_cmd: [], files_in_scope: [] }, template: undefined, fallback: [] }).cmd, null, 'an empty argv is absent, as before');
});
