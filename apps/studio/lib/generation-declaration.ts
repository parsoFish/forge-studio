/**
 * The wire shape of a demo-builder generation's DECLARATION (bead
 * forge-mfv5.2.8) — the `demoProcess` steps a generation proposes, which
 * locking it writes into `.forge/project.json`. `session-client.ts`'s
 * generation-gallery parser reads each entry's `declaration` through here: a
 * step list or null, and anything else THROWS rather than being coerced.
 */

/** One `demoProcess` step a generation proposes. */
export type GenerationDeclarationStep = { kind: string; text: string; element?: string };

const isPlainObject = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

export function parseGenerationDeclaration(raw: unknown): GenerationDeclarationStep[] | null {
  if (raw === null) return null;
  if (!Array.isArray(raw)) {
    throw new Error(`missing or invalid "declaration": expected an array or null, got ${JSON.stringify(raw)}`);
  }
  return raw.map((step, i) => {
    if (!isPlainObject(step)) throw new Error(`malformed declaration step[${i}]: expected an object, got ${JSON.stringify(step)}`);
    const { kind, text, element } = step;
    if (typeof kind !== 'string' || typeof text !== 'string') {
      throw new Error(`malformed declaration step[${i}]: "kind" and "text" must be strings, got ${JSON.stringify(step)}`);
    }
    if (element !== undefined && typeof element !== 'string') {
      throw new Error(`malformed declaration step[${i}]: "element" must be a string when present, got ${JSON.stringify(element)}`);
    }
    return { kind, text, ...(element !== undefined ? { element } : {}) };
  });
}
