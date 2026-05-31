/**
 * Tests for gate auto-derivation (betterado #2). Language detection from the
 * worktree's build manifests + the language-specific scoped-gate recipe whose
 * traps encode the exact failures the betterado run hit.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectProjectLanguage,
  gateRecipeFor,
  deriveGateRecipe,
  renderGateRecipeBlock,
} from './gate-recipes.ts';

function tmp(files: Record<string, string>): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gate-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('detectProjectLanguage: go.mod ⇒ go', () => {
  const p = tmp({ 'go.mod': 'module x\n' });
  try {
    assert.equal(detectProjectLanguage(p.dir), 'go');
  } finally {
    p.cleanup();
  }
});

test('detectProjectLanguage: Cargo.toml ⇒ rust', () => {
  const p = tmp({ 'Cargo.toml': '[package]\n' });
  try {
    assert.equal(detectProjectLanguage(p.dir), 'rust');
  } finally {
    p.cleanup();
  }
});

test('detectProjectLanguage: pyproject.toml ⇒ python', () => {
  const p = tmp({ 'pyproject.toml': '[project]\n' });
  try {
    assert.equal(detectProjectLanguage(p.dir), 'python');
  } finally {
    p.cleanup();
  }
});

test('detectProjectLanguage: package.json + tsconfig ⇒ typescript; package.json alone ⇒ javascript', () => {
  const ts = tmp({ 'package.json': '{}', 'tsconfig.json': '{}' });
  const js = tmp({ 'package.json': '{}' });
  try {
    assert.equal(detectProjectLanguage(ts.dir), 'typescript');
    assert.equal(detectProjectLanguage(js.dir), 'javascript');
  } finally {
    ts.cleanup();
    js.cleanup();
  }
});

test('detectProjectLanguage: no manifest ⇒ unknown', () => {
  const p = tmp({ 'README.md': '# x' });
  try {
    assert.equal(detectProjectLanguage(p.dir), 'unknown');
  } finally {
    p.cleanup();
  }
});

test('detectProjectLanguage: go.mod wins over package.json (primary manifest)', () => {
  const p = tmp({ 'go.mod': 'module x\n', 'package.json': '{}' });
  try {
    assert.equal(detectProjectLanguage(p.dir), 'go');
  } finally {
    p.cleanup();
  }
});

test('gateRecipeFor(go): encodes the three betterado traps + -tags all in the template', () => {
  const r = gateRecipeFor('go');
  assert.deepEqual(r.template.slice(0, 4), ['go', 'test', '-tags', 'all']);
  assert.ok(r.template.includes('-run'), 'template scopes with -run');
  const blob = r.traps.join('\n');
  assert.match(blob, /-tags all.*mandatory|mandatory.*-tags all/i);
  assert.match(blob, /\.\/\.\.\.|test-less sibling|poison/i);
  assert.match(blob, /clean tree|gate-too-loose/i);
});

test('every language recipe warns against the umbrella / clean-tree-pass failure', () => {
  for (const lang of ['typescript', 'javascript', 'python', 'rust', 'unknown'] as const) {
    const r = gateRecipeFor(lang);
    assert.ok(r.template.length > 0, `${lang} has a template`);
    assert.match(r.traps.join('\n'), /clean tree|umbrella|gate-too-loose|existing suite|exist yet/i, `${lang} warns about a hollow gate`);
  }
});

test('deriveGateRecipe: detects from the worktree and renders a prompt block', () => {
  const p = tmp({ 'go.mod': 'module x\n' });
  try {
    const r = deriveGateRecipe(p.dir);
    assert.equal(r.language, 'go');
    const block = renderGateRecipeBlock(r);
    assert.match(block, /Detected language: \*\*go\*\*/);
    assert.match(block, /-tags/);
    assert.match(block, /Traps/);
  } finally {
    p.cleanup();
  }
});
