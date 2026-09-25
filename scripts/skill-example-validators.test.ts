/**
 * skill-example-validators.test.ts — M7 findings row 54: "a skill's worked
 * example is its specification". Every `SKILL.md` under `skills/` that
 * carries a worked example of a real, machine-validated format is swept here
 * through
 * that format's REAL validator (never a re-implementation) — so a skill doc
 * can drift out of sync with its own format and nothing notices, the way
 * `project-manager/SKILL.md`'s WI-3/WI-4 examples silently dropped
 * `quality_gate_cmd` after it became a hard-required field
 * (`packages/flows/work-item.ts`'s `validateWorkItem`).
 *
 * SWEEP RESULT (2026-09-25, `_1.0/cull/m7-c-findings-pass3.md` row 54, full
 * repo grep for "Example"/"worked example"/fenced blocks across every
 * `SKILL.md` under `skills/`):
 *
 *   skills/project-manager/SKILL.md       -> packages/flows/work-item.ts
 *     (parseWorkItem/validateWorkItem) — FAIL (both worked examples omitted
 *     `quality_gate_cmd`, required since 2026-05-24) — FIXED in this PR.
 *   skills/project-brain-builder/SKILL.md -> packages/knowledge/brain-lint.ts
 *     (lintThemeFiles / checkFrontmatter) — FAIL-shaped: `category` was the
 *     one sibling field NOT wrapped in the block's own `<...>` placeholder
 *     convention (a bare pipe-list reads as a literal value where every
 *     other field reads as "fill this in") — FIXED in this PR (bracket-wrap,
 *     content unchanged). The field SET was always complete; the fix is
 *     placeholder-convention consistency, not a schema gap.
 *   skills/demo-design/SKILL.md           -> packages/projects/
 *     project-config-validate.ts (parseSkills) — PASS, no fix needed.
 *   skills/adversarial-review/SKILL.md    -> packages/flows/flow-artifacts.ts
 *     (validateReviewFindings) — PASS structurally: every field the real
 *     schema requires is present and correctly shaped. The three enum
 *     fields (findings[].severity, findings[].category,
 *     acEvaluations[].verdict) are deliberate quoted "one of these"
 *     placeholders — the SAME convention every opaque field in the same
 *     block uses (`"..."`) — so a literal parse of exactly those three is
 *     expected to fail and is not asserted here; no fix needed.
 *   skills/architect/SKILL.md             -> no forge-side validator (the
 *     `options:` block documents the harness's own AskUserQuestion tool
 *     shape, not a forge package format) — not swept. Also fenced from this
 *     lane's edits (open PR #832) regardless.
 *   skills/brain-query/SKILL.md           -> no forge-side validator (the
 *     `answers` object is interpolated into a prompt as free text —
 *     `brainQueryResults: string` — never JSON-parsed or schema-checked by
 *     any forge package) — not swept.
 *   Every other skill's SKILL.md (brain-fix, brain-lint, brain-maintenance,
 *     demo, forge-onboard-project, project-scoped-review, reflector, …)
 *     carries no worked example of a machine-validated format — only CLI
 *     usage lines, free-text templates, or prose "for example" mentions —
 *     not swept.
 *
 * Each swept format gets TWO tests below: the real skill doc's CURRENT
 * example (must keep passing — this is what catches future drift) plus one
 * synthetic negative-control fixture (a hand-broken instance the SAME real
 * validator must still catch) — proving the check has teeth, not just a
 * green rubber stamp that happens to agree with today's doc.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { parseWorkItem, validateWorkItem } from '@forge/flows/work-item.ts';
import { validateReviewFindings } from '@forge/flows/flow-artifacts.ts';
import { lintThemeFiles, type Finding } from '@forge/knowledge';
import { parseSkills } from '@forge/projects/testing';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readSkill(name: string): string {
  return readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
}

/** First fenced ```<lang> block in `source`. */
function extractFence(source: string, lang: string): string {
  const m = new RegExp('```' + lang + '\\n([\\s\\S]*?)\\n```').exec(source);
  assert.ok(m, `no \`\`\`${lang} fence found`);
  return m![1];
}

// ---------------------------------------------------------------------------
// project-manager: WI-3 / WI-4 frontmatter -> packages/flows/work-item.ts
// ---------------------------------------------------------------------------

test('skills/project-manager/SKILL.md: both "Concrete examples" WI blocks parse and validate clean (row 54)', () => {
  const src = readSkill('project-manager');
  const section = src.slice(src.indexOf('## Concrete examples'));
  const blocks = [...section.matchAll(/```yaml\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
  assert.equal(blocks.length, 2, 'expected exactly the WI-3 and WI-4 worked examples');
  for (const block of blocks) {
    const wi = parseWorkItem(block);
    const errors = validateWorkItem(wi);
    assert.deepEqual(errors, [], `worked example must pass validateWorkItem, got: ${errors.join('; ')}`);
  }
});

test('validateWorkItem: a WI missing quality_gate_cmd is rejected (negative control — proves the check above would catch row 54\'s original defect)', () => {
  const broken = [
    '---',
    'work_item_id: WI-9',
    'initiative_id: INIT-2026-01-01-example',
    'status: pending',
    'depends_on: []',
    'acceptance_criteria:',
    '  - given: "x"',
    '    when:  "y"',
    '    then:  "z"',
    'files_in_scope:',
    '  - src/x.ts',
    'estimated_iterations: 1',
    '---',
    '',
    '# WI-9: fixture',
    '',
  ].join('\n');
  const wi = parseWorkItem(broken);
  const errors = validateWorkItem(wi);
  assert.ok(
    errors.some((e) => e.includes('quality_gate_cmd')),
    `expected a quality_gate_cmd error, got: ${JSON.stringify(errors)}`,
  );
});

// ---------------------------------------------------------------------------
// project-brain-builder: theme frontmatter -> packages/knowledge/brain-lint.ts
// ---------------------------------------------------------------------------

function lintFrontmatterBlock(block: string): Finding[] {
  const root = mkdtempSync(join(tmpdir(), 'skill-example-brain-lint-'));
  try {
    const themesDir = join(root, 'brain', 'projects', 'row54-fixture', 'themes');
    mkdirSync(themesDir, { recursive: true });
    const file = join(themesDir, 'example.md');
    writeFileSync(file, `${block}\n`);
    return lintThemeFiles(root, [file]).filter((f) => f.check === 'checkFrontmatter');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('skills/project-brain-builder/SKILL.md: the theme worked example declares every required frontmatter field (row 54)', () => {
  const src = readSkill('project-brain-builder');
  const block = extractFence(src, 'markdown');
  const findings = lintFrontmatterBlock(block);
  const missingField = findings.filter((f) => f.message.startsWith('missing required frontmatter field'));
  assert.deepEqual(missingField, [], `worked example must declare every required field, got: ${JSON.stringify(missingField)}`);
  // `category` is a deliberate "pick one of these five" placeholder (the
  // <...> convention every sibling field in this block uses, per row 54's
  // fix) — it never parses as a literal ALLOWED_CATEGORIES member, and that
  // one "not in whitelist" finding is expected here, not a regression.
  const other = findings.filter(
    (f) => !f.message.startsWith('missing required frontmatter field') && !f.message.includes('not in whitelist'),
  );
  assert.deepEqual(other, [], `unexpected checkFrontmatter finding(s): ${JSON.stringify(other)}`);
});

test('lintThemeFiles/checkFrontmatter: a theme missing a required field is rejected (negative control)', () => {
  const broken = [
    '---',
    'title: fixture',
    'category: pattern',
    'created_at: 2026-01-01T00:00:00Z',
    'updated_at: 2026-01-01T00:00:00Z',
    '---',
    '',
    'body',
    '',
  ].join('\n');
  const findings = lintFrontmatterBlock(broken);
  assert.ok(
    findings.some((f) => f.message === 'missing required frontmatter field: description'),
    `expected a missing-description finding, got: ${JSON.stringify(findings)}`,
  );
});

// ---------------------------------------------------------------------------
// demo-design: project.json `skills` chip -> packages/projects/project-config-validate.ts
// ---------------------------------------------------------------------------

test('skills/demo-design/SKILL.md: the project.json skills-chip worked example parses via parseSkills (row 54)', () => {
  const src = readSkill('demo-design');
  const block = extractFence(src, 'json');
  const parsed = JSON.parse(block) as { skills: unknown };
  assert.deepEqual(parseSkills(parsed.skills), ['demo-design']);
});

test('parseSkills: a non-string entry is rejected (negative control)', () => {
  assert.throws(() => parseSkills([123]), /skills\[0\] must be a string/);
});

// ---------------------------------------------------------------------------
// adversarial-review: review-findings.json -> packages/flows/flow-artifacts.ts
// ---------------------------------------------------------------------------

test('skills/adversarial-review/SKILL.md: the review-findings.json worked example is structurally complete under validateReviewFindings (row 54)', () => {
  const src = readSkill('adversarial-review');
  const block = extractFence(src, 'json');
  const raw = JSON.parse(block) as { lenses: string[]; acEvaluations: Array<{ criterion: string }> };
  const expected = {
    lenses: raw.lenses,
    criteria: raw.acEvaluations.map((e) => e.criterion),
    scope: 'the initiative',
  };
  const errors = validateReviewFindings(raw, expected);
  // The three enum fields (findings[].severity, findings[].category,
  // acEvaluations[].verdict) are deliberate "one of these" placeholders —
  // quoted pipe-lists, the SAME convention every opaque field in this block
  // uses ("..."). A literal parse of those three is expected to fail; any
  // OTHER error would mean the example's FIELD SET (not its placeholder
  // values) has drifted from the real schema, which this test does catch.
  const structural = errors.filter((e) => !e.includes('.severity') && !e.includes('.category') && !e.includes('.verdict'));
  assert.deepEqual(structural, [], `unexpected structural error(s): ${JSON.stringify(structural)}`);
});

test('validateReviewFindings: a findings entry missing its evidence array is rejected (negative control)', () => {
  const broken = {
    initiative_id: 'INIT-2026-01-01-example',
    cycleId: 'c1',
    baseRef: 'main',
    headSha: 'abc123',
    reviewedAt: '2026-01-01T00:00:00Z',
    summary: 'fixture',
    lenses: ['correctness'],
    acEvaluations: [{ criterion: 'x', verdict: 'met', evidence: 'y' }],
    whyWhatHow: { why: 'a', what: 'b', how: 'c' },
    findings: [{ id: 'RF-1', severity: 'major', category: 'correctness', title: 't', detail: 'd' }],
  };
  const errors = validateReviewFindings(broken, { lenses: ['correctness'], criteria: ['x'], scope: 'the initiative' });
  assert.ok(
    errors.some((e) => e.includes('evidence must be a non-empty array')),
    `expected an evidence error, got: ${JSON.stringify(errors)}`,
  );
});
