/**
 * W7-FIX-A4 (W7A4-03) — the project↔KB binding is DERIVED (packages/knowledge/kb-sites.ts
 * `projectKbBindings`, "never stored") from kb.yaml `binding.ref`, and the
 * roster hands the derived value to the editor as `project.kb`. The editor
 * must therefore NEVER echo `kb` back on save unless the operator actually
 * changed the binding — the bridge's PUT merge treats a present `kb` key
 * (string OR null) as an explicit rebind and writes it into project.json,
 * where it then permanently shadows the derivation.
 *
 * Wrong implementation this pins against: `saveProject(id, { …, kb })` with
 * `kb` unconditionally present (page.tsx handleSave on main ac7e71e0) — one
 * north-star edit on a derived-kb project froze the derived id into
 * project.json.
 *
 * RUN: npm run test:ui -- lib/project-save-payload.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildProjectSavePayload } from './project-save-payload';

const FIELDS = {
  name: 'trafficGame',
  northStar: 'A traffic game.',
  instructions: 'Keep it green.',
  demoProcess: [],
  skills: [],
};

describe('buildProjectSavePayload (W7A4-03)', () => {
  it('omits the `kb` KEY entirely when the operator did not touch the binding — even though the editor holds the derived value', () => {
    const payload = buildProjectSavePayload({ ...FIELDS, kb: 'trafficGame', kbTouched: false });
    expect(Object.prototype.hasOwnProperty.call(payload, 'kb')).toBe(false);
    expect(payload).toEqual(FIELDS);
  });

  it('omits `kb` when untouched and the editor holds null (an unbound project must not be written as kb: null either)', () => {
    const payload = buildProjectSavePayload({ ...FIELDS, kb: null, kbTouched: false });
    expect('kb' in payload).toBe(false);
  });

  it('includes `kb` (string) only when the operator explicitly rebound it', () => {
    const payload = buildProjectSavePayload({ ...FIELDS, kb: 'forge-dev', kbTouched: true });
    expect(payload.kb).toBe('forge-dev');
  });

  it('includes `kb: null` when the operator explicitly UNBOUND it (null is a real answer once touched)', () => {
    const payload = buildProjectSavePayload({ ...FIELDS, kb: null, kbTouched: true });
    expect('kb' in payload).toBe(true);
    expect(payload.kb).toBeNull();
  });

  it('trims the text fields the same way the editor always did (behaviour-preserving)', () => {
    const payload = buildProjectSavePayload({ ...FIELDS, name: '  x  ', northStar: ' y ', instructions: ' z ', kb: null, kbTouched: false });
    expect(payload.name).toBe('x');
    expect(payload.northStar).toBe('y');
    expect(payload.instructions).toBe('z');
  });
});

// ---------------------------------------------------------------------------
// Structural guard: the editor's Save path MUST route through the helper with
// a real `kbTouched` — a page that rebuilds `{ …, kb }` inline reintroduces
// the write-back no matter how correct the helper is.
// ---------------------------------------------------------------------------
describe('projects/[id]/page.tsx save path (W7A4-03 structural guard)', () => {
  const src = readFileSync(resolve(__dirname, '..', 'app', 'projects', '[id]', 'page.tsx'), 'utf8');

  it('imports buildProjectSavePayload and passes kbTouched from KbBind onChange', () => {
    expect(src).toMatch(/import \{ buildProjectSavePayload \} from '@\/lib\/project-save-payload'/);
    expect(src).toMatch(/buildProjectSavePayload\(\{[\s\S]*?kbTouched[\s\S]*?\}\)/);
    // KbBind's onChange is the ONLY place kbTouched flips to true.
    expect(src).toMatch(/<KbBind[\s\S]*?onChange=\{\(v\) => \{[^}]*setKbTouched\(true\)/);
  });

  it('never hands saveProject an inline object literal carrying `kb`', () => {
    const inline = /saveProject\(\s*id\s*,\s*\{[^}]*\bkb\b/;
    expect(src).not.toMatch(inline);
  });
});
