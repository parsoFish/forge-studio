/**
 * A screenshot checkpoint's declared interaction (row 4 of forge-nk1y.45): the
 * steps the capture drives on the tree's own page before its final still, and
 * the regions it outlines. Without them a UI "before/after" was a bare page
 * load. Inert data from the planner (D-45), validated by name here — for the
 * plan, and again at the point of use by the capture (`@forge/factory`).
 */

export type BrowserStepDecl = { click: string } | { fill: string; text: string } | { press: string };

const MAX_STEPS = 10;
const MAX_REGIONS = 6;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isLine = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max && !/[\r\n]/.test(v);
const KEY = /^[A-Za-z0-9]+(?:\+[A-Za-z0-9]+)*$/;

function checkStep(step: unknown, at: string, errors: string[]): void {
  const keys = isObject(step) ? Object.keys(step).sort().join(',') : '';
  if (!isObject(step) || !['click', 'fill,text', 'press'].includes(keys)) {
    errors.push(`${at}: must be exactly one of { click } | { fill, text } | { press }`);
    return;
  }
  for (const k of ['click', 'fill'] as const) {
    if (k in step && !isLine(step[k], 120)) errors.push(`${at}.${k}: must be one line of at most 120 characters (a selector)`);
  }
  if ('text' in step && !isLine(step.text, 200)) errors.push(`${at}.text: must be one line of at most 200 characters`);
  if ('press' in step && !(typeof step.press === 'string' && step.press.length <= 30 && KEY.test(step.press))) errors.push(`${at}.press: must be a key name such as Enter or Control+A`);
}

/** Push one named error per problem in a checkpoint's `steps`/`regions`; both are optional. */
export function checkBrowserSteps(steps: unknown, regions: unknown, at: string, errors: string[]): void {
  if (steps !== undefined) {
    if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_STEPS) errors.push(`${at}.steps: must be an array of 1–${MAX_STEPS} steps`);
    else steps.forEach((s, i) => checkStep(s, `${at}.steps[${i}]`, errors));
  }
  if (regions !== undefined && !(Array.isArray(regions) && regions.length > 0 && regions.length <= MAX_REGIONS && regions.every((r) => isLine(r, 120)))) {
    errors.push(`${at}.regions: must be an array of 1–${MAX_REGIONS} selectors, each one line of at most 120 characters`);
  }
}
