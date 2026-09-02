/**
 * The project-contract report shape (ADR 017, ADR 034 — SPEC.md §6 Project).
 *
 * These four types are pure data. They live here rather than beside the
 * preflight implementation because the `ProjectGate` port declares them and a
 * flow reaches the preflight only through that port: "a flow does not import
 * the project package" (SPEC.md §6). Moved verbatim from `cli/preflight.ts`,
 * which re-exports them so its eight importers are unchanged.
 */

export type ClauseId = 'C1' | 'C1b' | 'C2' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C10' | 'BUILD' | 'BRAIN' | 'DEMO' | 'DEMO-SKILL' | 'DEMO-ALIGN' | 'ARTIFACTS' | 'SKILLS' | 'DEPS';

export type ClauseResult = {
  clause: ClauseId;
  title: string;
  /** Hard clauses fail the preflight; advisory clauses only warn. */
  hard: boolean;
  pass: boolean;
  detail: string;
};

export type PreflightReport = {
  projectDir: string;
  projectName: string;
  clauses: ClauseResult[];
  /** True iff every HARD clause passed. Drives the CLI exit code. */
  ok: boolean;
};

export type PreflightOptions = {
  /**
   * Forge root, used to locate the project's brain sub-wiki
   * (`brain/projects/<name>/profile.md`). Defaults to the parent of
   * `orchestrator/` (where this module lives).
   */
  forgeRoot?: string;
  /**
   * Judge the DEPS clause — "the declared gate is RUNNABLE in this ground".
   * Off by default, and that default is the whole point: a project is born
   * contract-green BEFORE anyone has installed its dependencies (R1-03-F1),
   * so evaluating runnability at creation would make "born green" impossible
   * and break a ratified acceptance to satisfy a different one.
   *
   * The moment that matters is CLAIM time — bead `forge-8vfn.5.21`'s own
   * words are "refusing an unprovisioned ground at claim time". That is when
   * a missing `node_modules` stops being a state the operator has not reached
   * yet and becomes the reason a run will die three minutes and a dollar
   * later as `dev-loop.baseline-red`. `packages/flows/claim-validator.ts`
   * sets this; nothing else does.
   */
  requireRunnableGate?: boolean;
};
