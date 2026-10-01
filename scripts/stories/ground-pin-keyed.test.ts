/**
 * Row 171 (forge-8vfn.8.5.7) — the ground pin is keyed by ground project.
 *
 * `FORGE_GROUND_PIN` was ONE value per invocation, so a run that selects more
 * than one costed story could not pass preflight either way (measured on M7-E
 * row 6, $0 each): without it S10's real ground `gitpulse` refused ("no
 * FORGE_GROUND_PIN was given"); with gitpulse's pin S2 refused, because its
 * story-minted ground `story-s2` "could not be measured, so it cannot be
 * compared with the declared FORGE_GROUND_PIN". One number cannot describe
 * two grounds. The pin is now `FORGE_GROUND_PIN_<project>`, the bare form is
 * refused when more than one costed story is selected (no silent fallback onto
 * every ground), and a ground in the story's own `story-<id>` namespace — the
 * one `sweep.mjs` owns and removes — never consults a pin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundPinEnvName, groundPinVerdicts, GROUND_PIN_ENV } from './preflight.mjs';

const GITPULSE_PIN = 'ec4bce9b545cef63';
const s10 = { id: 'S10', ground: { project: 'gitpulse', realSpawn: true, budget_usd: 44 } };
const s2 = { id: 'S2', ground: { project: 'story-s2', realSpawn: true, budget_usd: 25 } };
const s4 = { id: 'S4', ground: { project: 'story-s4', fixture: 'node-cli-with-tests', realSpawn: true, budget_usd: 25 } };
const s8 = { id: 'S8', ground: { project: 'story-s8', fixture: 'node-library', realSpawn: false, budget_usd: 0 } };

/** gitpulse measures at its pin; a story-minted ground does not exist yet, so it measures null. */
const measure = (project) => (project === 'gitpulse' ? GITPULSE_PIN : null);

test('the keyed variable is FORGE_GROUND_PIN_<project>, with non-identifier characters as _', () => {
  assert.equal(groundPinEnvName('gitpulse'), 'FORGE_GROUND_PIN_gitpulse');
  // `export` refuses a name with a hyphen; a ground like this one must still be pinnable from a shell.
  assert.equal(groundPinEnvName('terraform-provider-betterado'), 'FORGE_GROUND_PIN_terraform_provider_betterado');
});

test('THE ROW 6 RUN: all nine with only gitpulse pinned by key passes, and every ground says why', () => {
  const r = groundPinVerdicts([s2, s4, s8, s10], { env: { [groundPinEnvName('gitpulse')]: GITPULSE_PIN }, measure });
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  assert.equal(r.verdicts.length, 4);
  assert.match(r.verdicts.find((v) => v.id === 'S10').reason, new RegExp(GITPULSE_PIN));
  assert.match(r.verdicts.find((v) => v.id === 'S2').reason, /story-minted/);
});

test('the BARE global is refused when more than one costed story is selected — no silent fallback', () => {
  const r = groundPinVerdicts([s2, s10], { env: { [GROUND_PIN_ENV]: GITPULSE_PIN }, measure });
  assert.equal(r.ok, false);
  assert.match(r.reason, /FORGE_GROUND_PIN_gitpulse/, 'name the keyed form the caller should use instead');
  assert.match(r.reason, /2 costed stories/);
  assert.doesNotMatch(r.reason, /FORGE_GROUND_PIN_story_s2/, 'a story-minted ground is never named as needing a pin');
});

test('the bare global still pins a ONE-costed-story run (S8 is costless and does not count)', () => {
  const r = groundPinVerdicts([s8, s10], { env: { [GROUND_PIN_ENV]: GITPULSE_PIN }, measure });
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
});

test('bare and keyed both given and DISAGREEING is refused, never resolved by precedence', () => {
  const r = groundPinVerdicts([s10], {
    // The keyed pin MATCHES the ground, so only the disagreement check can refuse this — not the compare.
    env: { [GROUND_PIN_ENV]: '0000000000000000', [groundPinEnvName('gitpulse')]: GITPULSE_PIN },
    measure,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason, /0000000000000000/);
  assert.match(r.reason, new RegExp(GITPULSE_PIN));
});

test('a real ground with NO keyed pin still refuses, naming the keyed variable', () => {
  const r = groundPinVerdicts([s2, s10], { env: {}, measure });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^S10:/);
  assert.match(r.reason, /FORGE_GROUND_PIN_gitpulse/);
});

test('a keyed pin for ANOTHER ground does not satisfy this one', () => {
  const r = groundPinVerdicts([s10], { env: { [groundPinEnvName('mdtoc')]: GITPULSE_PIN }, measure });
  assert.equal(r.ok, false);
  assert.match(r.reason, /FORGE_GROUND_PIN_gitpulse/);
});

test('a keyed pin that does not match the measured ground is refused with both hashes', () => {
  const r = groundPinVerdicts([s10], { env: { [groundPinEnvName('gitpulse')]: '2343d907ddb5703f' }, measure });
  assert.equal(r.ok, false);
  assert.match(r.reason, /2343d907ddb5703f/);
  assert.match(r.reason, new RegExp(GITPULSE_PIN));
});

test('a story-minted ground is never measured against a pin, even one declared for it', () => {
  // The pin cannot describe a directory the story has not created yet; consulting one is the S2 refusal.
  const r = groundPinVerdicts([s2], { env: { [groundPinEnvName('story-s2')]: GITPULSE_PIN }, measure });
  assert.equal(r.ok, true, r.ok ? '' : r.reason);
  assert.match(r.verdicts[0].reason, /story-minted/);
});

test('only the story\'s OWN namespace is minted: S2 declaring another story\'s ground still needs a pin', () => {
  const borrowed = { id: 'S2', ground: { project: 'story-s20', realSpawn: true, budget_usd: 25 } };
  const r = groundPinVerdicts([borrowed], { env: {}, measure });
  assert.equal(r.ok, false);
});
