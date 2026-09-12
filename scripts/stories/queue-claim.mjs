/**
 * The queue writes a costed run is ANSWERABLE FOR — bead `forge-8vfn.7.6.74`.
 *
 * WHAT THE OLD SWEEP COULD NOT SEE. `productFixturePathsFor` finds residue by
 * STORY ID: `_queue/in-flight/STORY-<id>.md` and `_queue/failed/STORY-<id>.md`,
 * two states out of six, both named after the story. A ground CYCLE mints its
 * work under the INITIATIVE's name — `INIT-<date>-<slug>.md` — into whatever
 * state it reached, so no story-id glob can ever find it. S10 run 14's
 * initiative landed in `ready-for-review` at 04:25:27Z and sat there for
 * thirteen hours.
 *
 * AND `porcelain 0` SAID NOTHING, because `.gitignore:42` is
 * `_queue/ready-for-review/*`. "Porcelain 0" was quoted as clean-tree evidence
 * in the next run's INTENT while the residue was present — a true measurement
 * of the wrong thing. `queueStateVerdict` (§15.430) caught it at $0 on the run
 * after that, which is the backstop working and not a reason to leave the hole.
 *
 * WHY IT IS A WRONG-GREEN. An initiative already resting in `ready-for-review`
 * can satisfy S10 beat 8's `initiative-status` conjunct BEFORE the run
 * dispatches anything. That is a $35 run reporting a pass it did not earn.
 *
 * SO ATTRIBUTION REPLACES THE GLOB. A queue file is this run's when its
 * `created_at` falls inside the run's window, or when its `project` is the
 * story's own ground — the ground belongs to the story, so what is queued
 * against it does too. Everything else is LEFT, and every decision is
 * reported: a file left behind silently is exactly what produced the thirteen
 * hours.
 *
 * CAPTURE-FIRST, ALWAYS. Bytes reach the run's evidence directory before
 * anything is removed, and a capture that throws cancels the removal. The
 * alternative — remove, then capture — turns a full disk into the permanent
 * loss of the only copy of what a $35 run produced.
 *
 * FAIL CLOSED ON WHAT IT CANNOT READ. A manifest whose front matter will not
 * parse, or which carries neither `created_at` nor `project`, is NAMED and
 * LEFT. Removing it would be guessing; leaving it quietly would repeat the
 * defect. Left where it is, the next run's `queueStateVerdict` refuses at $0,
 * which is the correct end state for "I could not tell whose this is".
 *
 * THE STATES ARE READ FROM DISK, NOT FROM A LIST. `scripts/lib/journey-residue.mjs`
 * exports a six-name `QUEUE_STATES` and this deliberately does not import it:
 * a constant cannot see a seventh state someone adds later, and the failure
 * mode of missing one is silence. `queueStateVerdict` enumerates the same way,
 * for the same reason.
 */
import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import matter from 'gray-matter';

/** `INIT-<anything>.md` — the shape a cycle mints. `STORY-*.md` is the story
 *  sweep's business and is reported here rather than judged. */
const INIT_FILE = /^INIT-.+\.md$/;

/** Copy `from` into `<evidenceDir>/<state>/<name>`, creating the directory.
 *  Injected in the doors so the capture-failure branch is reachable. */
function captureToEvidence(from, evidenceDir, state) {
  const dir = join(evidenceDir, state);
  mkdirSync(dir, { recursive: true });
  copyFileSync(from, join(dir, basename(from)));
}

/**
 * `created_at` as epoch ms, or null.
 *
 * BOTH SHAPES ARE REAL, AND I MEASURED WHICH IS WHICH RATHER THAN ASSUMING.
 * `serializeManifest` emits `created_at: '2026-09-12T04:25:27.000Z'` — QUOTED,
 * so gray-matter hands back a string, and the product's own manifests take the
 * string path. An UNQUOTED ISO timestamp is equally valid YAML and js-yaml
 * parses it into a `Date`: that is what a hand-edited manifest, or one written
 * by anything other than this serialiser, looks like.
 *
 * The `Date` branch exists for that second case and is NOT decoration. Without
 * it such a file reads as "no created_at", so a manifest minted squarely inside
 * the run window is either left behind forever or, worse, reported as
 * unattributable — an attribution failure wearing the costume of a missing
 * field. The first draft of this function had the branch and no door for it,
 * and a mutation that deleted the branch passed all ten tests; the door below
 * uses an unquoted fixture whose project is NOT the ground, so `created_at` is
 * the only thing that can claim it.
 */
function createdAtMs(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Which queue files belong to this run, which do not, and which could not be
 * told apart — with the per-state census either way.
 *
 * @param {{root: string, sinceMs: number, untilMs?: number, groundProject?: string,
 *          evidenceDir: string, capture?: typeof captureToEvidence}} args
 * @returns {{ok: boolean, claimed: {path: string, state: string, reason: string}[],
 *            left: {path: string, state: string, reason: string}[],
 *            unattributable: {path: string, state: string, reason: string}[],
 *            failed: {path: string, error: string}[], lines: string[]}}
 */
export function claimQueueWrites({ root, sinceMs, untilMs = Date.now(), groundProject, evidenceDir, capture = captureToEvidence }) {
  const queue = join(root, '_queue');
  const claimed = [];
  const left = [];
  const unattributable = [];
  const failed = [];
  const lines = [];

  if (!existsSync(queue)) {
    lines.push(`[stories] queue claim: ${queue} DOES NOT EXIST — an absent path is not an empty one (§15.430); nothing was swept and nothing is proven clean`);
    return { ok: false, claimed, left, unattributable, failed, lines };
  }

  let states;
  try {
    states = readdirSync(queue, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (err) {
    lines.push(`[stories] queue claim: ${queue} could not be read (${err?.code ?? err}) — refusing rather than counting zero`);
    return { ok: false, claimed, left, unattributable, failed, lines };
  }

  let ok = true;
  for (const state of states) {
    const dir = join(queue, state);
    let names;
    try {
      names = readdirSync(dir).filter((n) => n !== '.gitkeep');
    } catch (err) {
      ok = false;
      lines.push(`[stories] queue claim: ${dir} could not be read (${err?.code ?? err}) — refusing rather than counting zero`);
      continue;
    }
    // THE CENSUS PRINTS EVERY STATE, INCLUDING THE EMPTY ONES (§15.427). A
    // count recorded only when it is non-zero cannot be told from one nobody
    // took, and "porcelain 0" standing alone is how this bead happened.
    lines.push(`[stories] queue claim: ${state}/ holds ${names.length}${names.length > 0 ? ` — ${names.join(', ')}` : ''}`);

    for (const name of names) {
      const path = join(dir, name);
      if (!INIT_FILE.test(name)) {
        left.push({ path, state, reason: 'not an INIT manifest — the story-id sweep owns this one' });
        lines.push(`[stories] queue claim: LEFT ${path} — not an INIT manifest (the story-id sweep owns it)`);
        continue;
      }
      let data;
      try {
        data = matter(readFileSync(path, 'utf8')).data ?? {};
      } catch (err) {
        ok = false;
        unattributable.push({ path, state, reason: `front matter would not parse: ${err?.message ?? err}` });
        lines.push(`[stories] queue claim: COULD NOT ATTRIBUTE ${path} — front matter would not parse (${err?.message ?? err}); LEFT in place, and the next run's queueStateVerdict will refuse at $0`);
        continue;
      }
      const ms = createdAtMs(data['created_at']);
      const project = typeof data['project'] === 'string' ? data['project'] : null;
      if (ms === null && project === null) {
        ok = false;
        unattributable.push({ path, state, reason: 'neither created_at nor project — nothing to attribute it by' });
        lines.push(`[stories] queue claim: COULD NOT ATTRIBUTE ${path} — it carries neither created_at nor project; LEFT in place`);
        continue;
      }
      const inWindow = ms !== null && ms >= sinceMs && ms <= untilMs;
      const isGround = project !== null && groundProject !== undefined && project === groundProject;
      if (!inWindow && !isGround) {
        left.push({ path, state, reason: `created_at ${data['created_at']} is outside this run and project ${project} is not the ground` });
        lines.push(`[stories] queue claim: LEFT ${path} — created_at ${data['created_at']} is outside this run's window and project ${project} is not this story's ground`);
        continue;
      }
      const reason = inWindow
        ? `created_at ${data['created_at']} falls inside this run`
        : `project ${project} is this story's ground`;
      try {
        capture(path, evidenceDir, state);
      } catch (err) {
        ok = false;
        failed.push({ path, error: String(err?.message ?? err) });
        lines.push(`[stories] queue claim: KEPT ${path} — capture to evidence FAILED (${err?.message ?? err}); a removal whose capture failed destroys the only copy`);
        continue;
      }
      try {
        rmSync(path, { force: true });
      } catch (err) {
        ok = false;
        failed.push({ path, error: String(err?.message ?? err) });
        lines.push(`[stories] queue claim: captured but COULD NOT REMOVE ${path} (${err?.message ?? err})`);
        continue;
      }
      claimed.push({ path, state, reason });
      lines.push(`[stories] queue claim: CLAIMED ${path} — ${reason}; captured to ${join(evidenceDir, state)} before removal`);
    }
  }
  return { ok, claimed, left, unattributable, failed, lines };
}
