/**
 * forge-mfv5.1.32 — the project page's two declarations: `demoMeans` (what a demo may drive) and the
 * live-acceptance tier (`testProcess.acceptance`). Edited as one-per-line lists; the bridge's one
 * project.json writer validates them again, so this is the page's own named refusal, not the gate.
 */
export type DemoMeans = { commands?: string[]; routes?: string[]; api?: { paths?: string[]; commands?: string[]; ignoreKeys?: string[] } };
export type AcceptanceTier = { match: string; requiresEnv?: string[] };

export type DeclarationsForm = {
  commands: string; routes: string; apiPaths: string; apiCommands: string; ignoreKeys: string;
  match: string; requiresEnv: string;
};
export type Declarations = { ok: true; demoMeans: DemoMeans | null; acceptance: AcceptanceTier | null } | { ok: false; reason: string };

const lines = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean);
const text = (v?: string[]): string => (v ?? []).join('\n');
const some = <K extends string>(k: K, v: string[]): Partial<Record<K, string[]>> => (v.length > 0 ? ({ [k]: v } as Record<K, string[]>) : {});

export function formFromDeclarations(d: { demoMeans?: DemoMeans; acceptance?: AcceptanceTier }): DeclarationsForm {
  const m = d.demoMeans ?? {};
  return {
    commands: text(m.commands), routes: text(m.routes), apiPaths: text(m.api?.paths), apiCommands: text(m.api?.commands), ignoreKeys: text(m.api?.ignoreKeys),
    match: d.acceptance?.match ?? '', requiresEnv: text(d.acceptance?.requiresEnv),
  };
}

export function declarationsFromForm(f: DeclarationsForm): Declarations {
  const api = { ...some('paths', lines(f.apiPaths)), ...some('commands', lines(f.apiCommands)), ...some('ignoreKeys', lines(f.ignoreKeys)) };
  const means: DemoMeans = { ...some('commands', lines(f.commands)), ...some('routes', lines(f.routes)), ...(Object.keys(api).length > 0 ? { api } : {}) };
  const match = f.match.trim();
  const env = lines(f.requiresEnv);
  if (match === '' && env.length > 0) return { ok: false, reason: 'an acceptance tier needs a match — the substring that marks a live-acceptance gate' };
  return {
    ok: true,
    demoMeans: Object.keys(means).length > 0 ? means : null,
    acceptance: match === '' ? null : { match, ...some('requiresEnv', env) },
  };
}

/** What the readiness panel shows: the edited declarations while they are valid, else what is stored. */
export function shownDeclarations(form: DeclarationsForm | null, stored: { demoMeans?: DemoMeans; acceptance?: AcceptanceTier } | null): { demoMeans?: DemoMeans; acceptance?: AcceptanceTier } {
  const edited = form ? declarationsFromForm(form) : null;
  if (edited?.ok) return { ...(edited.demoMeans ? { demoMeans: edited.demoMeans } : {}), ...(edited.acceptance ? { acceptance: edited.acceptance } : {}) };
  return { ...(stored?.demoMeans ? { demoMeans: stored.demoMeans } : {}), ...(stored?.acceptance ? { acceptance: stored.acceptance } : {}) };
}
