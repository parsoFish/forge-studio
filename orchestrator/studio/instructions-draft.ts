/**
 * Deterministic instructions-draft composer (R2-09 D8).
 *
 * `composeInstructionsDraft(input)` turns the Agent Builder's CURRENT
 * (possibly unsaved) definition fields — purpose, composition, brainAccess,
 * interactivity — into a markdown instruction charter. It is a pure function:
 * no SDK call, no network request, no spawned agent, no clock/random read.
 * Identical input always yields a byte-identical `{draft, derivation}`.
 *
 * The one hard rule this module exists to enforce: it must NEVER invent. A
 * field that is absent or empty in `input` is reported as not-declared in
 * BOTH the rendered `draft` text and the `derivation.sources` list — never
 * fabricated, never silently dropped. This is the same "declared data must
 * not fail open" discipline as `materials.ts`, applied to composition instead
 * of a fixed vocabulary: a skill/guard/hook name never appears in the draft
 * unless it is genuinely present in `input.composition`.
 *
 * `derivation` "names itself": `sources` lists every field this module reads
 * (`purpose`, `composition.skills`, `composition.tools`, `composition.mcps`,
 * `composition.guards`, `composition.hooks`, `brainAccess`, `interactivity`)
 * alongside whether it was present, so a caller (or a human reviewing the
 * draft) can tell at a glance which parts of the charter are real declarations
 * and which are stand-in "not declared" prose.
 *
 * Consumed by POST /api/studio/agents/:slug/instructions-draft
 * (cli/bridge-studio-instructions.ts), which composes from the REQUEST BODY
 * (the builder's unsaved state) and never reads the on-disk SKILL.md for
 * this purpose (D9: the draft is never auto-saved, and the on-disk file is
 * touched only to confirm the agent exists).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One field the composer read, and whether it carried a real declaration. */
export interface InstructionsDraftSource {
  field: string;
  present: boolean;
}

/** Self-describing manifest of what the draft was built from (D8). */
export interface InstructionsDraftDerivation {
  sources: InstructionsDraftSource[];
}

export interface InstructionsDraftResult {
  draft: string;
  derivation: InstructionsDraftDerivation;
}

// ---------------------------------------------------------------------------
// Lenient readers — the input is unsaved builder state, not a validated
// AgentDefinition, so every field is read defensively: a malformed shape
// degrades to "absent", it never throws (this module must stay usable on
// half-filled-in builder state) and it never fabricates a value.
// ---------------------------------------------------------------------------

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 2026-08-05 adversarial-review round 2, finding D/11: an empty or
 * whitespace-only string entry used to survive this filter unchanged, so
 * `describeCompositionSection` rendered it as a bare `- ` bullet with
 * nothing real after it. Filtering on `v.trim().length > 0` (not just
 * `typeof v === 'string'`) means every surviving entry has real content —
 * and, critically, the FILTERED length is what `present` (below) reports,
 * so a list that is entirely whitespace collapses to "not declared" instead
 * of disagreeing with what the draft actually rendered.
 */
function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function readComposition(value: unknown): { skills: string[]; tools: string[]; mcps: string[]; guards: string[]; hooks: string[] } {
  const comp =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    skills: readStringArray(comp['skills']),
    tools: readStringArray(comp['tools']),
    mcps: readStringArray(comp['mcps']),
    guards: readStringArray(comp['guards']),
    hooks: readStringArray(comp['hooks']),
  };
}

// ---------------------------------------------------------------------------
// Prose fragments — each one states an honest fact about the input, never a
// guess. The brainAccess fragments deliberately encode ADR-010's policy
// wording so a reader of the draft (or the composed system prompt) learns the
// ACTUAL rule, not a vague "may or may not read the brain".
// ---------------------------------------------------------------------------

/** The only three real ADR-010 brain policies — anything else has no
 *  justified policy to state (2026-08-05 adversarial-review round 2, finding
 *  D/10). */
const VALID_BRAIN_ACCESS = new Set(['none', 'mandatory', 'advisory']);

function describeBrainAccess(brainAccess: string): string {
  switch (brainAccess) {
    case 'none':
      return 'This agent does not read the forge brain (ADR-010) — the planner already encoded every relevant convention into the work items.';
    case 'mandatory':
      return 'This agent is brain-first (ADR-010): it queries the brain before designing, planning, or answering how forge works.';
    case 'advisory':
      return 'This agent may consult the brain — advisory context, not mandatory (ADR-010).';
    default:
      return 'Brain access not declared.';
  }
}

function describeCompositionSection(label: string, items: string[]): string {
  const heading = `### ${label}`;
  if (items.length === 0) {
    return `${heading}\n\nNo ${label.toLowerCase()} declared.`;
  }
  return `${heading}\n\n${items.map((item) => `- ${item}`).join('\n')}`;
}

// ---------------------------------------------------------------------------
// composeInstructionsDraft
// ---------------------------------------------------------------------------

export function composeInstructionsDraft(input: Record<string, unknown>): InstructionsDraftResult {
  const purpose = readTrimmedString(input['purpose']);
  const interactivity = readTrimmedString(input['interactivity']);
  const brainAccessRaw = typeof input['brainAccess'] === 'string' ? input['brainAccess'] : '';
  const composition = readComposition(input['composition']);

  const draft = [
    '# Agent Instructions (draft)',
    '',
    '## Purpose',
    '',
    purpose || 'No purpose declared.',
    '',
    '## Brain Access',
    '',
    describeBrainAccess(brainAccessRaw),
    '',
    '## Interactivity',
    '',
    interactivity || 'No interactivity declared.',
    '',
    '## Composition',
    '',
    describeCompositionSection('Skills', composition.skills),
    '',
    describeCompositionSection('Tools', composition.tools),
    '',
    describeCompositionSection('MCPs', composition.mcps),
    '',
    describeCompositionSection('Guards', composition.guards),
    '',
    describeCompositionSection('Hooks', composition.hooks),
    '',
  ].join('\n');

  const derivation: InstructionsDraftDerivation = {
    sources: [
      { field: 'purpose', present: purpose.length > 0 },
      { field: 'composition.skills', present: composition.skills.length > 0 },
      { field: 'composition.tools', present: composition.tools.length > 0 },
      { field: 'composition.mcps', present: composition.mcps.length > 0 },
      { field: 'composition.guards', present: composition.guards.length > 0 },
      { field: 'composition.hooks', present: composition.hooks.length > 0 },
      // 2026-08-05 adversarial-review round 2, finding D/10: `present` used
      // to be `brainAccessRaw.length > 0`, so an INVALID value (e.g.
      // 'bogus-not-a-real-value') reported `present: true` while
      // `describeBrainAccess` fell through to its default "not declared"
      // prose — the draft and the derivation disagreed about the same
      // input. `present` now means "resolves to one of the three real
      // ADR-010 policies", matching what the draft text actually states.
      { field: 'brainAccess', present: VALID_BRAIN_ACCESS.has(brainAccessRaw) },
      { field: 'interactivity', present: interactivity.length > 0 },
    ],
  };

  return { draft, derivation };
}
