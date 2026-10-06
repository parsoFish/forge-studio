/**
 * Every example config under docs/schemas/examples/ is a valid project.json.
 * They are copied by people onboarding a project, so an example that the
 * validator rejects teaches the wrong shape (docs-w7 7.10: the betterado
 * example lacked testProcess.local and nothing noticed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateProjectConfig } from '../../project-config.ts';

const EXAMPLES = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'schemas', 'examples');

test('every docs/schemas/examples/*.json passes validateProjectConfig', () => {
  const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length > 0, 'the examples directory is not empty');
  const failures: string[] = [];
  for (const f of files) {
    try {
      validateProjectConfig(JSON.parse(readFileSync(join(EXAMPLES, f), 'utf8')));
    } catch (err) {
      failures.push(`${f}: ${(err as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});
