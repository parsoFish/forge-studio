/**
 * forge-nk1y.32 — gitweave I2's work items at the Kickoff gate as Studio is
 * served them: a slice of the plan, plus WI-13/14 added at the gate with their
 * `kickoff` fields. WI-14's files_in_scope holds the live entry verbatim (two
 * paths typed on one line).
 */
export const KICKOFF_INIT = 'INIT-2026-10-11-i2-apply-engine-terraform-retired';
export const WI14_LINE = 'tests/test_docs_no_terraform_tokens.py .github/copilot-context.md';
export const AC14 = {
  given: 'the repository after I2 (infra/ removed)',
  when: '`python3 -m pytest tests/test_docs_no_terraform_tokens.py` runs',
  then: 'no tokens',
};
export const KICKOFF_WIS = [
  { id: 'WI-9a', dependsOn: [] },
  { id: 'WI-10', dependsOn: ['WI-9a'] },
  { id: 'WI-11', dependsOn: [] },
  { id: 'WI-12', dependsOn: ['WI-11'] },
  {
    id: 'WI-13',
    dependsOn: ['WI-12'],
    kickoff: {
      summary: 'Reset before apply',
      acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
      qualityGateCmd: ['pytest'],
      filesInScope: ['tests/a.py'],
      creates: [],
      dependsOn: ['WI-12'],
    },
  },
  {
    id: 'WI-14',
    dependsOn: ['WI-9a', 'WI-10', 'WI-11'],
    kickoff: {
      summary: 'No Terraform references left in agent context or docs',
      acceptanceCriteria: [AC14],
      qualityGateCmd: ['python3', '-m', 'pytest', 'tests/test_docs_no_terraform_tokens.py'],
      filesInScope: [WI14_LINE],
      creates: [],
      dependsOn: ['WI-9a', 'WI-10', 'WI-11'],
    },
  },
];
