#!/usr/bin/env -S node --experimental-strip-types
// The `forge` command. Declared in package.json `bin`, so `npm link`
// (or a global install) puts `forge` on PATH pointing here. This is a
// thin launcher: it runs Node with --experimental-strip-types (TS runs
// directly, no build step) and hands off to the real CLI in
// orchestrator/cli.ts. Every `forge <subcommand>` in the docs goes
// through this file.
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
await import(resolve(here, '..', 'orchestrator', 'cli.ts'));
