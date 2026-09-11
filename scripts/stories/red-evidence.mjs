/**
 * On a RED story run, read the ground before the trailing sweep removes it.
 *
 * Bead `forge-8vfn.6.11.42` (T1 ruling 356b). S2 run 8 went red at beat 12: the
 * architect logged `interview round 2 — 2 question(s) for the operator` at
 * 21:12:30 and the page did not present `question-freetext` for 7 m 40 s.
 * Whether the questions were WRITTEN late or RENDERED late is the whole
 * question — and it could not be answered, because the trailing sweep removed
 * `projects/story-s2` before anything read `_architect/<sid>/questions.json`.
 * The sweep was working exactly as designed; nothing had asked it to wait.
 *
 * So on a red run the ground is read FIRST, into `_logs/` — outside the
 * directory the sweep removes, which is why `_logs/_architect-<sid>/
 * events.jsonl` is the one thing that survived run 8 and is the reason this
 * lands there rather than under `demos/`.
 *
 * THE MTIMES ARE THE POINT, not the contents. "Written 21:12:30, rendered
 * 21:20:10" and "written 21:20:10" hold byte-identical JSON and are different
 * defects, so every captured file's mtime is recorded EXPLICITLY in a manifest
 * rather than left to whatever a copy happens to preserve.
 *
 * A GREEN run captures nothing and sweeps exactly as before: a capture that
 * fired on every run would quietly turn the sweep off, which is the failure
 * this module would otherwise introduce while fixing another.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { productFixturePathsFor } from './sweep.mjs';

/**
 * Where a red run's ground is read to — under `_logs/`, never under the ground,
 * and under THIS RUN's own stamp.
 *
 * Bead `forge-8vfn.6.11.50` (T1 ruling 368). Without the stamp every run of a
 * story wrote into one directory, so run 9's captured session dir sat beside
 * run 10's with only `MTIMES.txt` rewritten — and the two were distinguishable
 * only by reading a session id out of the JSON. Evidence that quietly mixes two
 * runs is worse than no evidence, because it reads as one run.
 *
 * `runStamp` is required rather than defaulted: a default would be computed at
 * call time, and the ground capture and the DOM capture happen at different
 * moments, so they would land in different directories and split one run's
 * evidence in half.
 */
export function redEvidenceDir(root, storyId, runStamp) {
  return join(root, '_logs', '_story-red-evidence', storyId, runStamp);
}

/**
 * The grounds the trailing sweep is ABOUT to remove — asked of the sweep's own
 * definition rather than re-derived.
 *
 * Re-deriving it from `story.ground.project` was wrong and the green-path proof
 * caught it: `proof` declares its ground as `mdtoc`, which the sweep never
 * touches, while what it actually removes is `projects/story-proof`. A capture
 * keyed on the declared ground would have read a directory that was never at
 * risk and preserved nothing of the one that was — the same
 * two-notions-of-one-thing shape `handleFor` exists to prevent between the
 * repeat's gate and its act.
 */
function groundsAboutToBeSwept(storyId, root) {
  const projectsRoot = join(root, 'projects');
  return productFixturePathsFor(storyId, root).filter(
    (p) => p.startsWith(projectsRoot + '/') && existsSync(p) && statSync(p).isDirectory(),
  );
}

/** Every `_<kind>` session root a ground carries (`_architect`, `_onboarding`, `_demo`, …). */
function sessionKindDirs(groundDir) {
  try {
    return readdirSync(groundDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('_'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Every file under `dir`, repo-relative, with its mtime — recorded, not inferred. */
function mtimeRows(dir, root, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) mtimeRows(p, root, out);
    else out.push(`${new Date(statSync(p).mtimeMs).toISOString()}  ${relative(root, p)}`);
  }
  return out;
}

/**
 * Read a red run's ground before the sweep. Returns the capture directory, or
 * `null` when there was nothing to do (a green run, a story with no ground, a
 * ground already gone) — none of which is an error.
 *
 * @param {{root: string, storyId: string, project: string|null, red: boolean}} input
 */
export function captureRedEvidence({ root, storyId, red, runStamp }) {
  if (!red) return null;
  const grounds = groundsAboutToBeSwept(storyId, root);
  const rows = [];
  const copies = [];
  for (const groundDir of grounds) {
    for (const kind of sessionKindDirs(groundDir)) {
      const from = join(groundDir, kind);
      rows.push(...mtimeRows(from, root));
      copies.push([from, join(basename(groundDir), kind)]);
    }
  }
  if (copies.length === 0) return null;

  const dest = redEvidenceDir(root, storyId, runStamp);
  mkdirSync(dest, { recursive: true });
  for (const [from, rel] of copies) {
    cpSync(from, join(dest, rel), { recursive: true, preserveTimestamps: true });
  }
  writeFileSync(
    join(dest, 'MTIMES.txt'),
    '# mtimes read from the grounds the trailing sweep was about to remove, BEFORE it ran\n' +
      '# (bead forge-8vfn.6.11.42). The mtime is what separates "written late" from\n' +
      '# "rendered late"; the JSON is identical either way.\n' +
      `${rows.sort().join('\n')}\n`,
  );

  // 718(5) / §15.411: A CAPTURE THAT CANNOT ANSWER "WHEN WAS THIS BORN, AND
  // WHAT DID THE DAEMON SAY" CANNOT ADJUDICATE A CHANNEL WAIT.
  //
  // S10 run 11 reded beat 8 with `no-channel: nothing under _logs/ was created
  // by this press`. Settling whether that was the product or the door needed
  // two facts this capture did not hold: the daemon's own claim lines, and the
  // BIRTH times of `_logs/` dirs. Both were in the tree and neither was in the
  // evidence, so the question went back to a worktree that a restore could have
  // erased first. The answer, when it came, was that the daemon had claimed and
  // started the PM 449 ms BEFORE the beat that was waiting for it.
  //
  // Birth time, not mtime: a dir's mtime moves whenever anything inside it is
  // written, so a long-running cycle's mtime says when it last wrote, not when
  // it began — and "began" is the whole question a channel wait asks.
  try {
    const serveLog = join(root, '_logs', 'daemon', 'serve.log');
    if (existsSync(serveLog)) cpSync(serveLog, join(dest, 'serve.log'), { preserveTimestamps: true });
  } catch { /* the daemon may never have started; its absence is itself a fact the log carries */ }
  try {
    const logsDir = join(root, '_logs');
    const births = readdirSync(logsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        let born = null;
        try { born = statSync(join(logsDir, e.name)).birthtime.toISOString(); } catch { /* unreadable */ }
        return `${born ?? 'birth-unknown'}  ${e.name}`;
      })
      .sort();
    writeFileSync(
      join(dest, 'LOGS-BIRTH.txt'),
      '# BIRTH times of every _logs/ dir, read before the sweep (718(5)).\n' +
        '# Birth, not mtime: a cycle dir mtime moves on every write inside it, so it says\n' +
        '# when the cycle last wrote and never when it STARTED — which is the only thing a\n' +
        '# channel wait is asking. Run 11 needed exactly this to tell the door from the product.\n' +
        `${births.join('\n')}\n`,
    );
  } catch { /* best-effort: a capture that cannot list is still worth the files it copied */ }

  return dest;
}

/**
 * The page's DOM at the moment a beat went red, written into the same place the
 * ground is read to.
 *
 * Ruling 356b asks for it beside the session files for one reason: the session
 * dir says what the PRODUCT had, and the DOM says what the OPERATOR could see.
 * S2 run 8's whole open question is the difference between those two, and no
 * amount of re-reading the JSON afterwards can supply the second half.
 *
 * THE URL IS RECORDED BESIDE IT (bead `forge-8vfn.6.11.48`, T1 ruling 366),
 * because some of what a beat asserts is not in the markup at all. S1 run 10
 * beat 11 failed on one key — `data-plan-mode: expected "gate", got "view"` —
 * and `plan-mode` is the artifact page's URL-RESOLVED mode. The DOM could
 * never answer whether the story arrived at `?mode=view`; only the address
 * can, and nothing was writing it down.
 *
 * Never load-bearing: a page that has already gone (a crashed browser, a closed
 * context) must not turn a recorded red into a crash — and neither must a page
 * that cannot say where it is, so the URL is read defensively and its absence
 * costs the DOM nothing.
 */
export async function captureBeatDom(page, root, storyId, index, act, runStamp) {
  try {
    const dest = redEvidenceDir(root, storyId, runStamp);
    mkdirSync(dest, { recursive: true });
    const html = await page.content();
    let where = '(url unavailable)';
    try {
      if (typeof page.url === 'function') where = String(page.url());
    } catch { /* the URL is evidence, never a requirement */ }
    writeFileSync(
      join(dest, `beat-${index + 1}-dom.html`),
      `<!-- red beat ${index + 1}: ${act} -->\n<!-- url: ${where} -->\n${html}`,
    );
    return join(dest, `beat-${index + 1}-dom.html`);
  } catch {
    return null; // evidence is never load-bearing
  }
}

/** The run's own words for what it read — printed whether or not it read anything (§15.92). */
export function describeRedEvidence(dir, root) {
  if (dir === null) return [];
  // 718(5) / §15.411. THIS LINE USED TO SAY "session files + MTIMES.txt", and
  // that is exactly what the next reader copied into the campaign's evidence
  // dir — me, after run 11. The DOM dumps were already here: `captureBeatDom`
  // wrote `beat-8-dom.html` five milliseconds before the verdict line, and I
  // told T1 the capture could not answer what the DOM said. It could. What it
  // could not do was SAY SO.
  //
  // A capture nobody is told about is a capture nobody takes, so the line now
  // reads the directory and names what is in it. One DOM dump by name plus a
  // count, not a listing that grows with the story.
  let doms = [];
  let extras = [];
  try {
    const entries = readdirSync(dir);
    // NUMERIC, not lexicographic: `.sort()` puts `beat-24` before `beat-8`, so
    // the example named would be the LAST red rather than the first. The first
    // red is the one that matters — everything after it is usually cascade.
    const beatNo = (f) => Number(/^beat-(\d+)-dom\.html$/.exec(f)[1]);
    doms = entries.filter((f) => /^beat-\d+-dom\.html$/.test(f)).sort((a, b) => beatNo(a) - beatNo(b));
    extras = entries.filter((f) => f === 'serve.log' || f === 'LOGS-BIRTH.txt').sort();
  } catch { /* the dir is the thing being described; an unreadable one still gets named */ }
  const held = [
    'session files',
    'MTIMES.txt',
    ...(doms.length > 0
      ? [`${doms.length} DOM dump(s) at the moment of each red, e.g. ${doms[0]}`]
      : []),
    ...extras,
  ];
  return [`[stories] red run: ground read into ${relative(root, dir)} BEFORE the sweep (bead 6.11.42) — ${held.join(', ')}`];
}
