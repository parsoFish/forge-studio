/**
 * Tests for `packages/kernel/discovery-roots.ts` — SEAM F1 (operator ruling,
 * item 81): a SECOND discovery root, package-owned, alongside the existing
 * hardcoded `studio/flows/` and `skills/` roots. See that module's docstring
 * for the design.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { flowRoots, skillRoots, resolveIdAcrossRoots, listIdsAcrossRoots } from '../../discovery-roots.ts';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'kernel-discovery-roots-'));
}

describe('flowRoots', () => {
  it('lists studio/flows first, then every package flows/ dir, sorted by package name', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
      mkdirSync(join(root, 'packages', 'zeta-pkg', 'flows'), { recursive: true });
      mkdirSync(join(root, 'packages', 'alpha-pkg', 'flows'), { recursive: true });
      // A package with no flows/ dir contributes no root.
      mkdirSync(join(root, 'packages', 'no-flows-pkg'), { recursive: true });

      assert.deepEqual(flowRoots(root), [
        join(root, 'studio', 'flows'),
        join(root, 'packages', 'alpha-pkg', 'flows'),
        join(root, 'packages', 'zeta-pkg', 'flows'),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is [studio/flows] alone when no packages/ dir exists', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
      assert.deepEqual(flowRoots(root), [join(root, 'studio', 'flows')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not follow a symlinked packages/<pkg> directory', () => {
    const root = tmpRoot();
    const outside = tmpRoot();
    try {
      mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
      mkdirSync(join(root, 'packages'), { recursive: true });
      mkdirSync(join(outside, 'flows'), { recursive: true });
      symlinkSync(outside, join(root, 'packages', 'evil'), 'dir');

      assert.deepEqual(flowRoots(root), [join(root, 'studio', 'flows')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not follow a symlinked packages/<pkg>/flows leaf inside a real package dir', () => {
    const root = tmpRoot();
    const outside = tmpRoot();
    try {
      mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
      mkdirSync(join(root, 'packages', 'evil'), { recursive: true });
      symlinkSync(outside, join(root, 'packages', 'evil', 'flows'), 'dir');

      assert.deepEqual(flowRoots(root), [join(root, 'studio', 'flows')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('skillRoots', () => {
  it('lists skills/ first, then every package skills/ dir', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'skills'), { recursive: true });
      mkdirSync(join(root, 'packages', 'demo-pkg', 'skills'), { recursive: true });

      assert.deepEqual(skillRoots(root), [join(root, 'skills'), join(root, 'packages', 'demo-pkg', 'skills')]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('resolveIdAcrossRoots', () => {
  it('returns null when no root has the id', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'studio', 'flows'), { recursive: true });
      const result = resolveIdAcrossRoots(flowRoots(root), 'missing', ['flow.yaml']);
      assert.equal(result, null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves an id present in exactly one root', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'packages', 'demo-pkg', 'flows', 'b'), { recursive: true });
      writeFileSync(join(root, 'packages', 'demo-pkg', 'flows', 'b', 'flow.yaml'), 'x: 1', 'utf8');
      mkdirSync(join(root, 'studio', 'flows'), { recursive: true });

      const result = resolveIdAcrossRoots(flowRoots(root), 'b', ['flow.yaml']);
      assert.ok(result);
      assert.equal(result!.root, join(root, 'packages', 'demo-pkg', 'flows'));
      assert.equal(result!.path, join(root, 'packages', 'demo-pkg', 'flows', 'b', 'flow.yaml'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('THROWS, naming both paths, when the same id resolves under two roots (never "first wins")', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'studio', 'flows', 'dup'), { recursive: true });
      writeFileSync(join(root, 'studio', 'flows', 'dup', 'flow.yaml'), 'x: 1', 'utf8');
      mkdirSync(join(root, 'packages', 'demo-pkg', 'flows', 'dup'), { recursive: true });
      writeFileSync(join(root, 'packages', 'demo-pkg', 'flows', 'dup', 'flow.yaml'), 'x: 2', 'utf8');

      assert.throws(
        () => resolveIdAcrossRoots(flowRoots(root), 'dup', ['flow.yaml']),
        (err: Error) =>
          err.message.includes(join(root, 'studio', 'flows', 'dup', 'flow.yaml')) &&
          err.message.includes(join(root, 'packages', 'demo-pkg', 'flows', 'dup', 'flow.yaml')),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('listIdsAcrossRoots', () => {
  it('unions real directory names across every root, sorted', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'studio', 'flows', 'a'), { recursive: true });
      mkdirSync(join(root, 'packages', 'demo-pkg', 'flows', 'b'), { recursive: true });

      assert.deepEqual(listIdsAcrossRoots(flowRoots(root)), ['a', 'b']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('THROWS, naming both roots, when the same directory name exists under two roots', () => {
    const root = tmpRoot();
    try {
      mkdirSync(join(root, 'studio', 'flows', 'dup'), { recursive: true });
      mkdirSync(join(root, 'packages', 'demo-pkg', 'flows', 'dup'), { recursive: true });

      assert.throws(
        () => listIdsAcrossRoots(flowRoots(root)),
        (err: Error) =>
          err.message.includes(join(root, 'studio', 'flows')) &&
          err.message.includes(join(root, 'packages', 'demo-pkg', 'flows')),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
