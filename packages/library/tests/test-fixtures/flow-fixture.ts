/**
 * flow-fixture.ts — a `FlowSource` over the flow YAML a library test wrote.
 *
 * Library is rank 2 and `@forge/flows` is rank 5, so these tests cannot use
 * the real Flow loader — a test edge is still an edge in the import graph
 * `check-boundaries` reads. This parses only the fields `buildFlowEdgeIndex`
 * consumes (`nodes[].id/agent/label`, `edges[].from/to/artifact`), which is
 * deliberately LESS than the real loader validates: a fixture that
 * re-implemented the validation would be asserting against its own copy.
 *
 * What that leaves unproven — that the REAL loader agrees — is proven at
 * `apps/forge/library-flow-source.test.ts`, which drives the same fixture tree
 * through the real binding. Neither half is sufficient alone.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import yaml from 'js-yaml';

import type { FlowDefinition } from '@forge/contracts/studio/types.ts';
import type { FlowSource } from '../../studio/template-library.ts';

export const fixtureFlowSource: FlowSource = {
  listFlowIds(forgeRoot: string): readonly string[] {
    const dir = join(forgeRoot, 'studio', 'flows');
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'flow.yaml')))
      .map((e) => e.name)
      .sort();
  },
  loadFlowDefinition(flowYamlPath: string): FlowDefinition {
    const doc = yaml.load(readFileSync(flowYamlPath, 'utf8')) as Record<string, unknown> | null;
    if (!doc || typeof doc !== 'object') throw new Error(`fixture flow is not a mapping: ${flowYamlPath}`);
    return doc as unknown as FlowDefinition;
  },
};
