/**
 * wi-spec-compiler — deterministic core (ADR 037 decision items 1+2).
 *
 * Sequenced in `runOnePmPass` (project-manager.ts) right after
 * `appendStandingAcs` and before `validateWorkItemSet` — the same seam
 * `appendStandingAcs` already occupies, extended: parse constraint sources →
 * inject matching clauses verbatim → compile resolvable hidden-coupling
 * edges → enforce the `creates:` mandatory-with-escape + sizing invariants.
 * The LLM assist pass (ADR 037 decision item 3, `skills/wi-spec-compiler/`)
 * is explicitly out of scope here — this module is pure code, no SDK.
 *
 * Failure semantics (no silent paths):
 * - A failed spec-file write REVERTS the in-memory item (memory stays
 *   consistent with disk), surfaces on the `writeErrors` channel (folded
 *   into the PM pass's setErrors), and emits an error-level event.
 * - Success telemetry (`injected` entries / `compiledEdges` / the
 *   `pm.constraint-injected` + `pm.coupling-edge-compiled` events) is
 *   recorded ONLY after the corresponding write succeeded.
 * - Malformed constraint sources THROW out of `compileWorkItemSpecs`
 *   (via `loadProjectConstraintBlocks`); `runOnePmPass` catches and funnels
 *   the message into its normal failure outcome.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { EventLogger } from '../logging.ts';
import type { InitiativeManifest } from '../manifest.ts';
import {
  detectHiddenCoupling,
  serializeWorkItem,
  validateWorkItemSet,
  type CouplingPair,
  type WorkItem,
} from '../work-item.ts';
import {
  loadProjectConstraintBlocks,
  selectorMatches,
  type ConstraintBlock,
  type ConstraintMatchContext,
} from '../constraint-blocks.ts';
import { ralphSpecLintWorkItems } from './ralph-spec-lint.ts';

/** ADR 037: sizing bound on a WI's `creates:` list — the evidence base is the
 * migration-checklist cycles' oversized WIs (docs/decisions/037-compiled-wi-contracts.md). */
export const MAX_WI_CREATE_PATHS = 5;

// ---------- 1. constraint injection ----------

export type InjectedClause = {
  workItemId: string;
  /** The clause's stable id (the idempotency anchor key). */
  clauseId: string;
  sourceFile: string;
  startLine: number;
  /** `append` = first injection; `replace` = the clause body changed at source
   * and the previously-injected section was rewritten in place. */
  action: 'append' | 'replace';
};

const COMPILED_SECTION_HEADER = '## Compiled constraints (project & brain, ADR 037)';

/**
 * Idempotency anchors key on the clause's stable `id` (NOT its source
 * position — a `sourceFile:startLine` key duplicated the clause on any line
 * shift in the source document). The close marker bounds the injected
 * section so a content edit at source can be replaced in place.
 */
function clauseOpenMarker(id: string): string {
  return `<!-- forge:compiled clause="${id}" -->`;
}

function clauseCloseMarker(id: string): string {
  return `<!-- /forge:compiled clause="${id}" -->`;
}

function clauseSection(block: ConstraintBlock): string {
  return `${clauseOpenMarker(block.id)}\n${block.content}\n${clauseCloseMarker(block.id)}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches one injected clause section; capture group 1 = the injected content. */
function clauseSectionRegExp(id: string): RegExp {
  return new RegExp(
    `${escapeRegExp(clauseOpenMarker(id))}\\n([\\s\\S]*?)\\n${escapeRegExp(clauseCloseMarker(id))}`,
  );
}

/**
 * Inject every constraint clause whose selector matches a WI into that WI's
 * body, verbatim, under one `## Compiled constraints` section. Body-only
 * mutation — frontmatter stays byte-stable via `serializeWorkItem` (the
 * `appendStandingAcs` precedent). Per-clause semantics, keyed on the clause
 * id:
 *   - id absent from the body        → APPEND the clause section
 *   - id present, identical content  → no-op
 *   - id present, different content  → REPLACE the section in place
 * A failed write reverts the item in memory (consistent with disk) and lands
 * on `writeErrors`; `injected` records only successfully-persisted actions.
 */
export function injectConstraintClauses(
  workItemsDir: string,
  items: ReadonlyArray<WorkItem>,
  manifest: InitiativeManifest,
  blocks: ReadonlyArray<ConstraintBlock>,
): { items: WorkItem[]; injected: InjectedClause[]; writeErrors: string[] } {
  if (blocks.length === 0) return { items: items.slice(), injected: [], writeErrors: [] };

  const injected: InjectedClause[] = [];
  const writeErrors: string[] = [];

  const updated = items.map((item) => {
    const ctx: ConstraintMatchContext = {
      wi: item as unknown as Record<string, unknown>,
      manifest: manifest as unknown as Record<string, unknown>,
    };
    const matching = blocks.filter((b) => selectorMatches(b.selector, ctx));
    if (matching.length === 0) return item;

    let body = item.body;
    const actions: InjectedClause[] = [];
    const toAppend: ConstraintBlock[] = [];

    for (const b of matching) {
      const openMarker = clauseOpenMarker(b.id);
      if (!body.includes(openMarker)) {
        toAppend.push(b);
        continue;
      }
      const sectionRe = clauseSectionRegExp(b.id);
      const match = sectionRe.exec(body);
      if (!match) {
        // Open marker present but the bounded section is gone (hand-edited /
        // corrupted). Appending blindly would duplicate the clause; replacing
        // has no bounds to target. Refuse loudly instead of guessing.
        writeErrors.push(
          `${item.work_item_id}: injected marker for clause "${b.id}" found without its close marker — ` +
            `the compiled section was corrupted; fix the WI body (or delete the marker) and re-run`,
        );
        continue;
      }
      if (match[1] === b.content) continue; // identical → idempotent no-op
      // Function replacement so `$`-sequences in clause content are literal.
      body = body.replace(sectionRe, () => clauseSection(b));
      actions.push({
        workItemId: item.work_item_id,
        clauseId: b.id,
        sourceFile: b.sourceFile,
        startLine: b.startLine,
        action: 'replace',
      });
    }

    if (toAppend.length > 0) {
      const sections = toAppend.map((b) => clauseSection(b));
      const hasHeader = body.includes(COMPILED_SECTION_HEADER);
      const addition = hasHeader
        ? sections.join('\n\n')
        : [COMPILED_SECTION_HEADER, '', ...sections].join('\n');
      body = `${body.replace(/\s+$/, '')}\n\n${addition}\n`;
      for (const b of toAppend) {
        actions.push({
          workItemId: item.work_item_id,
          clauseId: b.id,
          sourceFile: b.sourceFile,
          startLine: b.startLine,
          action: 'append',
        });
      }
    }

    if (actions.length === 0) return item;

    const updatedItem: WorkItem = { ...item, body };
    try {
      writeFileSync(join(workItemsDir, `${item.work_item_id}.md`), serializeWorkItem(updatedItem));
    } catch (err) {
      // Disk write failed → revert in memory so state matches disk, and
      // surface the failure on the error channel (never swallow).
      writeErrors.push(
        `${item.work_item_id}: failed to persist injected constraint clause(s) ` +
          `[${actions.map((a) => a.clauseId).join(', ')}]: ${(err as Error).message}`,
      );
      return item;
    }
    injected.push(...actions); // telemetry only AFTER the write succeeded
    return updatedItem;
  });

  return { items: updated, injected, writeErrors };
}

// ---------- 2. creates: mandatory-with-escape + sizing bound ----------

/**
 * ADR 037: `creates:` is mandatory on every WI UNLESS it declares
 * `verification_artifact` (the escape for pure-modification WIs with no new
 * files). Reported set-errors-style (mirrors `validateWorkItemSet`'s
 * `setErrors` message shape) so the PM pipeline can fold these straight into
 * its existing failure path/telemetry without a new outcome shape.
 */
export function validateCompiledWorkItemSet(items: ReadonlyArray<WorkItem>): string[] {
  const errors: string[] = [];
  for (const item of items) {
    const hasCreates = Array.isArray(item.creates) && item.creates.length > 0;
    const hasVerificationArtifact =
      typeof item.verification_artifact === 'string' && item.verification_artifact.length > 0;
    if (!hasCreates && !hasVerificationArtifact) {
      errors.push(
        `${item.work_item_id}: creates is required (ADR 037) unless verification_artifact is set — ` +
          `pure-modification WIs must declare verification_artifact as the creates: escape`,
      );
    }
    if (hasCreates && item.creates!.length > MAX_WI_CREATE_PATHS) {
      errors.push(
        `${item.work_item_id}: creates lists ${item.creates!.length} path(s), exceeding the ADR 037 ` +
          `sizing bound of ${MAX_WI_CREATE_PATHS} — split into smaller work items`,
      );
    }
  }
  return errors;
}

// ---------- 3. hidden-coupling reject → compile ----------

export type CompiledCouplingEdge = {
  dependent: string;
  prerequisite: string;
  sharedFiles: string[];
};

export type CouplingCompileResult = {
  items: WorkItem[];
  /** Edges successfully derived AND persisted to the spec files. */
  compiledEdges: CompiledCouplingEdge[];
  /** Pairs the compiler could not resolve — the PM pass hard-rejects on these, unchanged from pre-ADR-037. */
  unresolved: CouplingPair[];
  /** Spec-file writes that failed — folded into the PM pass's setErrors (loud, never swallowed). */
  writeErrors: string[];
};

const WI_NUMERIC_ID = /^WI-(\d+)$/;

/**
 * `detectHiddenCoupling` upgraded from reject-only to compile-when-derivable
 * (ADR 037). A shared-file overlap with no `depends_on` edge is resolved by
 * WI-id numeric order — the higher-numbered WI gets `depends_on` the lower
 * ("WI-2 gets depends_on WI-1"); on a numeric TIE (e.g. `WI-05` vs `WI-5`,
 * both 5) the order falls back to deterministic LEXICOGRAPHIC id comparison,
 * the greater id becoming the dependent. The edge is persisted to the spec
 * file and the pass continues. Reject remains the fallback for pairs the
 * compiler can't resolve unambiguously: an id outside the `WI-<n>` shape has
 * no derivable order, and if applying the derived batch would close a
 * dependency cycle (only possible interacting with pre-existing reverse
 * edges) the WHOLE batch is discarded — no edges persist, every detected
 * pair reports as unresolved (all-or-nothing keeps disk, memory, and the
 * revalidated DAG trivially consistent).
 */
export function compileHiddenCoupling(
  workItemsDir: string,
  items: ReadonlyArray<WorkItem>,
): CouplingCompileResult {
  const pairs = detectHiddenCoupling(items as WorkItem[]);
  if (pairs.length === 0) {
    return { items: items.slice(), compiledEdges: [], unresolved: [], writeErrors: [] };
  }

  const derived: CompiledCouplingEdge[] = [];
  const unresolved: CouplingPair[] = [];
  for (const pair of pairs) {
    const na = WI_NUMERIC_ID.exec(pair.a);
    const nb = WI_NUMERIC_ID.exec(pair.b);
    if (!na || !nb) {
      unresolved.push(pair); // non-derivable id shape → reject (pre-ADR-037 behavior)
      continue;
    }
    const numA = Number(na[1]);
    const numB = Number(nb[1]);
    let dependent: string;
    let prerequisite: string;
    if (numA !== numB) {
      [dependent, prerequisite] = numA > numB ? [pair.a, pair.b] : [pair.b, pair.a];
    } else {
      // Numeric tie (zero-padding: WI-05 vs WI-5) → deterministic
      // lexicographic id order; the greater id becomes the dependent.
      [dependent, prerequisite] = pair.a > pair.b ? [pair.a, pair.b] : [pair.b, pair.a];
    }
    derived.push({ dependent, prerequisite, sharedFiles: pair.sharedFiles });
  }

  if (derived.length === 0) {
    return { items: items.slice(), compiledEdges: [], unresolved, writeErrors: [] };
  }

  const edgesByDependent = new Map<string, Set<string>>();
  for (const edge of derived) {
    const set = edgesByDependent.get(edge.dependent) ?? new Set<string>();
    set.add(edge.prerequisite);
    edgesByDependent.set(edge.dependent, set);
  }

  const candidateItems: WorkItem[] = items.map((item) => {
    const additions = edgesByDependent.get(item.work_item_id);
    if (!additions) return item;
    const merged = [...new Set([...item.depends_on, ...additions])];
    return { ...item, depends_on: merged };
  });

  // Revalidate the DAG after adding edges (ADR 037): compiled edges must not
  // introduce a cycle. All-or-nothing — if the batch closes a loop, discard
  // every derived edge and report all detected pairs unresolved.
  const { setErrors } = validateWorkItemSet(candidateItems);
  if (setErrors.some((e) => e.includes('dependency cycle'))) {
    return { items: items.slice(), compiledEdges: [], unresolved: pairs.slice(), writeErrors: [] };
  }

  // Persist per changed item. A failed write reverts THAT item in memory
  // (consistent with disk) and drops its edges from the compiled telemetry.
  const writeErrors: string[] = [];
  const failedDependents = new Set<string>();
  const finalItems = candidateItems.map((candidate, idx) => {
    const original = items[idx]!;
    if (candidate === original) return candidate;
    try {
      writeFileSync(join(workItemsDir, `${candidate.work_item_id}.md`), serializeWorkItem(candidate));
      return candidate;
    } catch (err) {
      const added = [...(edgesByDependent.get(candidate.work_item_id) ?? [])];
      writeErrors.push(
        `${candidate.work_item_id}: failed to persist compiled depends_on edge(s) on ` +
          `[${added.join(', ')}]: ${(err as Error).message}`,
      );
      failedDependents.add(candidate.work_item_id);
      return original;
    }
  });

  const compiledEdges = derived.filter((edge) => !failedDependents.has(edge.dependent));
  return { items: finalItems, compiledEdges, unresolved, writeErrors };
}

// ---------- 4. orchestration (the runOnePmPass entry point) ----------

export type WiSpecCompileResult = {
  items: WorkItem[];
  /** Coupling pairs left unresolved — the PM pass hard-rejects on these. */
  unresolvedCoupling: CouplingPair[];
  /** Compiler-stage validation + write failures — folded into the PM pass's setErrors. */
  compileErrors: string[];
  /**
   * ralph-spec-lint downgrades (truncated search / dynamically-named tests):
   * things the lint could not PROVE either way. Surfaced on the `pm.spec-lint`
   * event; never folded into compileErrors, never fail the pass.
   */
  lintWarnings: string[];
};

export type WiSpecCompileOptions = {
  forgeRoot: string;
  projectName: string;
  manifest: InitiativeManifest;
  workItemsDir: string;
  /**
   * The PROJECT's worktree root (NOT forgeRoot) — ralph-spec-lint (ADR 037 /
   * REFINEMENT-PLAN §7) searches it for existing test files. Defaults to two
   * levels up from `workItemsDir` (`<worktree>/.forge/work-items` →
   * `<worktree>`), the nesting `work-item.ts`'s `writeWorkItem` uses; pass
   * explicitly when `workItemsDir` doesn't follow that convention.
   */
  projectRoot?: string;
  /** ralph-spec-lint walk-cap override (defaults to its MAX_FILES_WALKED); primarily a test seam. */
  lintMaxFilesWalked?: number;
  items: ReadonlyArray<WorkItem>;
  logger: EventLogger;
  initiativeId: string;
  parentEventId: string;
};

/**
 * The full deterministic compile stage: load the project's constraint blocks
 * (throws on a malformed source — the caller funnels that into its failure
 * outcome), inject matching clauses (emitting `pm.constraint-injected` per
 * successfully-persisted clause), compile derivable hidden-coupling edges
 * (emitting `pm.coupling-edge-compiled` per persisted edge), then run the
 * ADR 037 `creates:` invariants. Write failures emit
 * `pm.compile-write-failed` (error-level) and land in `compileErrors`.
 */
export function compileWorkItemSpecs(opts: WiSpecCompileOptions): WiSpecCompileResult {
  const { forgeRoot, projectName, manifest, workItemsDir, logger, initiativeId, parentEventId } = opts;

  const blocks = loadProjectConstraintBlocks(forgeRoot, projectName);

  const injection = injectConstraintClauses(workItemsDir, opts.items, manifest, blocks);
  for (const clause of injection.injected) {
    logger.emit({
      initiative_id: initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'log',
      input_refs: [clause.sourceFile],
      output_refs: [join(workItemsDir, `${clause.workItemId}.md`)],
      message: 'pm.constraint-injected',
      metadata: {
        work_item_id: clause.workItemId,
        clause_id: clause.clauseId,
        source_file: clause.sourceFile,
        start_line: clause.startLine,
        action: clause.action,
      },
    });
  }

  // ralph-spec-lint (ADR 037 / REFINEMENT-PLAN §7): after injection, before
  // hidden-coupling compile — neither of those steps touches `quality_gate_cmd`
  // / `creates` / `files_in_scope`, so running the lint here vs. after coupling
  // is equivalent; "after injection" is the sequencing the check was designed
  // against. Deterministic, no SDK — proves whether each WI's named test
  // selector can match an existing test OR a test file in the WI's ENFORCED
  // write set (gateRequiredPaths priority chain); a selector proven to match
  // neither is a vacuous-pass risk (PM names a test function that doesn't
  // exist yet — `go test -run <no-match>` exits 0) and folds straight into
  // compileErrors, same channel every other compile-stage failure uses.
  // Anything the lint CANNOT prove (truncated walk, `.each` dynamic names)
  // is a warning on the pm.spec-lint event, never a pass failure. A bad
  // projectRoot is a call-site config bug → compileError, not a WI verdict.
  const projectRoot = opts.projectRoot ?? resolve(workItemsDir, '..', '..');
  const lint = ralphSpecLintWorkItems(injection.items, {
    projectRoot,
    maxFilesWalked: opts.lintMaxFilesWalked,
  });
  logger.emit({
    initiative_id: initiativeId,
    parent_event_id: parentEventId,
    phase: 'project-manager',
    skill: 'project-manager',
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    message: 'pm.spec-lint',
    metadata: {
      checked: lint.checked,
      flagged: lint.flagged,
      warned: lint.warned,
      warnings: lint.warnings,
      truncated: lint.truncated,
      skipped_files: lint.skippedFiles,
      ...(lint.configError !== null && { config_error: lint.configError }),
    },
  });
  const lintErrors = [
    ...(lint.configError !== null ? [`ralph-spec-lint: ${lint.configError}`] : []),
    ...lint.errors,
  ];

  const coupling = compileHiddenCoupling(workItemsDir, injection.items);
  for (const edge of coupling.compiledEdges) {
    logger.emit({
      initiative_id: initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'log',
      input_refs: [],
      output_refs: [join(workItemsDir, `${edge.dependent}.md`)],
      message: 'pm.coupling-edge-compiled',
      metadata: {
        dependent: edge.dependent,
        prerequisite: edge.prerequisite,
        shared_files: edge.sharedFiles,
      },
    });
  }

  const writeErrors = [...injection.writeErrors, ...coupling.writeErrors];
  for (const error of writeErrors) {
    logger.emit({
      initiative_id: initiativeId,
      parent_event_id: parentEventId,
      phase: 'project-manager',
      skill: 'project-manager',
      event_type: 'error',
      input_refs: [],
      output_refs: [],
      message: 'pm.compile-write-failed',
      metadata: { error },
    });
  }

  const invariantErrors = validateCompiledWorkItemSet(coupling.items);

  return {
    items: coupling.items,
    unresolvedCoupling: coupling.unresolved,
    compileErrors: [...writeErrors, ...invariantErrors, ...lintErrors],
    lintWarnings: lint.warnings,
  };
}
