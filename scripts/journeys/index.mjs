/**
 * journeys/index — the canonical journey registry for scripts/e2e-journey.mjs.
 *
 * JOURNEYS is every declared journey (a `defineJourney()` spec, one module per
 * user story under scripts/journeys/), in the building-blocks throughline order
 * below. RUN_ORDER is the flat `[journeyId, beatId]` execution sequence the
 * runner drives beat-by-beat — each journey's beats now run CONTIGUOUS (no
 * interleaving): home → skills → hooks → templates → connections →
 * stand-up-onboard → stand-up-create → knowledge → agents → flows-author →
 * flows-run → flows-onboard → roadmap → demo-showcase → demo-builder →
 * community
 * (R3-07 — deliberately
 * LAST, see its own RUN_ORDER comment below: it installs a real skill + a
 * real hook, mutating /skills, /hooks and the agent-builder palette counts
 * every earlier journey's own beats pin).
 * (the standalone runtime-adapter journey was retired — its checks were
 * folded into agents' agents-scratch-build beat, which drives the SDK/model
 * picker as part of composing a brand-new agent from scratch.) Two
 * hard orderings this sequence must preserve (verified by reading every
 * journey module, not just assumed):
 *   · stand-up-onboard before flows-author — flows-author's seeded-run beat
 *     (J5) reads the project stand-up-onboard onboards (J4_PROJECT) on disk.
 *   · flows-run (all 29 beats, in file-declared order) before roadmap —
 *     roadmap-tab reads the shared cycle log's work-items-snapshot AFTER
 *     flows-run-approve-merge has moved the manifest into `done/`; roadmap
 *     must not run until every flows-run beat (including the ACT-3 SWAP beats
 *     monitor-deep-dive / detail-reachable / start-run-cta / gate-control,
 *     which stay inside the flows-run journey itself) has completed.
 * home (R6-07) runs FIRST in both JOURNEYS and RUN_ORDER — the operator lands
 * on Home (`/`) before anything else, and it is entirely self-contained so
 * placing it first preserves both hard orderings above untouched. Its own
 * two throwaway scratch projects (HOME_GATED_PROJECT / HOME_ACTIVE_PROJECT,
 * home.mjs — never J4_PROJECT, never mdtoc) are seeded by home-landing
 * (behind its own crash-safe leading sweep) and swept by home-clickthrough's
 * own finally (the last beat that needs them), mirroring demo-showcase's own
 * cross-beat seed/sweep shape.
 * Every other journey (skills, hooks, templates, connections, agents,
 * knowledge, demo-showcase, demo-builder, flows-onboard) is self-contained: templates is pure read-only browsing (no seed, no
 * cleanup — it creates and destroys nothing, mirroring skills-library /
 * skills-detail-package's own read-only precedent (R3-01-F3/F4)); knowledge
 * (R1-06 WI-4 + R4-19-F2) drives FOUR disjoint, create-and-destroy-itself
 * scratch KBs (journey-scratch-kb, journey-scratch-kb-band, journey-scratch-
 * kb-maintain, journey-scratch-kb-cleanup — the maintain one nested one level
 * deeper, under brain/projects/, since that's the ONE containment root
 * checkProjectBrainIndexes scans; none is ever a real project brain like
 * brain/projects/mdtoc), each swept inside its own beat's drive() (the
 * cleanup one's sweep lands in knowledge-kb-cleanup-approve, the LAST beat
 * that needs it — knowledge-kb-cleanup-launch leaves it live across the
 * pair, mirroring the band-scope arc's own multi-beat shape), never
 * brain/cycles, brain/forge-dev, or a real project's central brain — see
 * knowledge.mjs's own header comment for the full discipline; skills-edit
 * restores the real shipped skill it edits,
 * skills-agentic-author removes its staged demo-design artifact + demo
 * sessions, skills-agentic-build/hooks-agentic-build (R4-21 phase 2, T3) each
 * clean up their own authoring session + landed/installed package inline,
 * with cleanSkillArtifacts/cleanHookArtifacts as the crash-safe backstop
 * (journey-fixtures.mjs), agents-scratch-build/agents-builder each clean up their own
 * skill-dir/stashed-SKILL.md, agents-materials-declare cleans its own
 * throwaway scratch agent, flows-author-scratch-build's SCRATCH_FLOW is swept
 * only by the top-level pre-run sweep / finally block in scripts/e2e-
 * journey.mjs (never at the end of the beat's own drive) — flows-author-
 * shelf-return, its next-run sibling beat, deliberately relies on that gap to
 * read the just-authored flow's card back on the library home page,
 * roadmap-recovery cleans its own seeded failed/in-flight
 * initiatives (R4-11-T3 — moved off the retired standalone /recovery
 * journey), demo-showcase's own two mdtoc-scoped clip-only cycles
 * (SHOWCASE_INIT_1/2, journey-fixtures.mjs) are seeded in demo-showcase-entry
 * and demo-showcase-refresh respectively and both swept in
 * demo-showcase-refresh's own finally (the last beat that needs either),
 * leaving mdtoc's canonical cycle history byte-unchanged; its separate
 * SHOWCASE_EMPTY_PROJECT in-flight fixture is fully self-contained to
 * demo-showcase-empty (create + assert + clean in that one beat's own
 * finally); and demo-builder-lock cleans its own seeded state — each at
 * the top/end of their own drive(). skills' created slugs never collide with
 * agents' starter slugs, and skills-create's api-contract-review skill is the
 * throughline artifact: it stays on disk until the runner's finally sweeps it.
 * (R3-01-F3/F4) skills-library and skills-detail-package are read-only browse
 * beats (no seed/cleanup of their own); skills-install-approve installs into
 * its own scratch id (SK_INSTALL_ID, journey-fixtures.mjs) in a temp dir
 * outside the repo and restores both the installed skill dir and its
 * studio/installed-skills.yaml ledger entry to their exact prior state
 * itself, on every path (a try/finally, not just the happy path), via the
 * NARROW cleanSkillInstallArtifacts() sweep — deliberately NOT the broad
 * cleanSkillArtifacts() (which also owns SK_NEW_SLUG/SK_CLIP_SLUG and the
 * edit-beat's stash and would delete skills-create's throughline artifact
 * out from under agents-scratch-build, since this beat runs AFTER
 * skills-create in RUN_ORDER, above). cleanSkillArtifacts (the runner's
 * crash-safe sweep) still covers the install artifacts too, via the same
 * narrow function, for the case where a crash skips this beat's own finally.
 *
 * community (R3-07) installs its own two vendored artifacts
 * (CM_SKILL_ID='dependency-diff-review', CM_HOOK_ID='block-protected-branch-push'
 * — ids local to community.mjs, disjoint from every SK_/HK_ constant above)
 * in one beat (community-skill-install / community-hook-install) and reads
 * them across several later beats before its own try/finally
 * (community-skills-approve-palette, the LAST beat that needs them) sweeps
 * both plus the studio/installed-skills.yaml ledger entry the skill install
 * wrote — restored to its EXACT prior state (including "the file did not
 * exist"), the same stash discipline as SK_INSTALL_LEDGER_PATH above. Because
 * that sweep lives several beats after the mutation, community.mjs exports
 * its own cleanCommunityArtifacts() as a crash-safe backstop, called from
 * scripts/e2e-journey.mjs's own top-level finally alongside
 * cleanSkillArtifacts()/cleanHookArtifacts() — the same reason those two are
 * called there rather than trusted to their own journeys' happy path alone.
 *
 * hooks (R3-03-F4) mirrors skills' own cleanup discipline with its own,
 * disjoint set of ids (HK_NEW_ID/HK_SECURITY_ID/HK_BIND_AGENT_SLUG,
 * journey-fixtures.mjs) — never SK_*, never a skills-pillar path.
 * hooks-library/hooks-detail are read-only browse beats (no seed/cleanup of
 * their own, mirroring skills-library/skills-detail-package). hooks-create
 * authors HK_NEW (studio/hooks/journey-stack-base-guard/) as a throughline
 * WITHIN this journey only — consumed by hooks-bind two beats later, then
 * swept there via the narrow cleanHookCreateArtifacts(). hooks-security
 * authors a SEPARATE, never-bound hook (HK_SECURITY) purely to demonstrate
 * the scan's blocked verdict + the override discipline; it is fully created
 * and swept (package + the studio/hook-approvals.yaml ledger entry, restored
 * to their exact prior state) inside that one beat's own try/finally via the
 * narrow cleanHookSecurityArtifacts() — called again between its main pass
 * and its clip (which reuses the SAME id sequentially rather than a second
 * scratch id, since re-POSTing an existing id 409s and this artifact is
 * never a throughline past this one beat). hooks-bind stashes/restores the
 * real shipped skills/developer-ralph/SKILL.md it binds HK_NEW into (a
 * low-risk pick no other journey module stashes), restoring once between its
 * own main pass and its clip (a "used" chip's drag is refused by
 * CatalogPalette itself, so the clip needs the pre-bind bytes back to drag
 * the same chip again) and once more, alongside cleanHookCreateArtifacts(),
 * in its own finally.
 *
 * agents' own edit-agent arc (R2-09: agents-edit-selector-open through
 * agents-edit-byte-faithful) ALSO stashes/restores skills/developer-ralph/
 * SKILL.md — the same file hooks-bind stashes above, but never concurrently:
 * hooks-bind's own finally fully restores it before hooks completes, well
 * before agents-starters begins, so agents-edit-selector-open's own stash
 * (agents.mjs, module-local, disjoint from hooks.mjs's own stash variable)
 * captures the same pristine, committed bytes either way. Unlike hooks-bind's
 * single-beat stash/restore, this arc's mutation spans FIVE separate beats
 * (agents-edit-catalog-click-add through agents-edit-byte-faithful, which
 * does the arc's own closing restore) — RUN_ORDER runs each beat as an
 * independent `await beat.drive(ctx)` with no per-beat try/catch, so a throw
 * partway through would skip the closing beat entirely. agents.mjs therefore
 * also exports restoreDeveloperRalphSkill() as a crash-safe backstop, called
 * from scripts/e2e-journey.mjs's own top-level finally alongside
 * cleanSkillArtifacts()/cleanHookArtifacts()/cleanCommunityArtifacts() — the
 * same reason those are called there rather than trusted to their own
 * journeys' happy path alone (see community's own paragraph below).
 *
 * agents' batch-D standalone run-view fixtures (agents-run-developer-fixture,
 * agents-run-adversarial-review-entry/-findings) each create-and-destroy
 * their own hand-seeded `_logs/_agent-<slug>-*` directory (DEV_RUN_ID /
 * ADV_RUN_ID, module-local, disjoint from R6_06_STANDALONE_RUN_ID's own
 * fixture above) inside that ONE beat's own try/finally — mirroring hooks-
 * security's create-and-destroy-its-own-throwaway-fixture precedent, never
 * the flow-cycle CYCLE_LOG any flows-run/roadmap beat owns.
 * agents-run-adversarial-review-entry and -findings each seed the SAME
 * ADV_RUN_ID fixture independently (cheap, deterministic, disjoint from
 * every other seeded id) rather than threading state across beats.
 *
 * connections (R3-04) is READ-MOSTLY: connections-library / connections-
 * detail-tool / connections-detail-mcp create and destroy nothing on disk —
 * every count/state they assert is cross-checked against a fresh disk
 * read/real exec this journey performs itself (studio/catalog.yaml, `git
 * --version`, the `_connections/` root), mirroring templates.mjs's own
 * read-only precedent, and connections-detail-mcp's "install" click is a
 * SUPPRESSED no-op under this harness's FORGE_ARCHITECT_NO_SPAWN=1 (D7: no
 * journey may ever perform a real network install) so it leaves no residue
 * either. connections-readiness-block is the one beat with a seed: a
 * brand-new scratch agent (CONN_SCRATCH_SLUG, local to connections.mjs —
 * never an SK_ / HK_ id, nor agents.mjs's own 'journey-scratch-agent') that binds the
 * still-not-installed `memory` MCP purely to prove the readiness panel + Run
 * control block on it; created and swept inside that one beat's own
 * try/finally (plus a leading stale-state sweep, crash-safe, mirroring
 * hooks-create/hooks-security). This shape — create-and-destroy-its-own-
 * throwaway-agent — was chosen over hooks-bind's stash/restore-a-real-
 * shipped-SKILL.md precedent deliberately: developer-ralph (hooks-bind's
 * own stash target) is read here too (connections-detail-tool's used-by
 * cross-check reads its real, UNTOUCHED composition.tools), and connections
 * runs strictly after hooks completes in RUN_ORDER, so never stashing it
 * here avoids a second write path onto a file another journey already owns
 * stashing.
 *
 * flows-onboard (R4-18, batch E) drives its own `onboard-project` OOTB flow.
 * flows-onboard-monitor / flows-onboard-kickoff are read-only browse beats
 * (no seed/cleanup of their own). flows-onboard-gate is the one beat with a
 * seed — its own scratch preflight-RED fixture (`os.tmpdir()`, never inside
 * this repo), its own `_queue/ready-for-review/<id>.md` manifest and its own
 * `_logs/<cycleId>/`, all local ids disjoint from every other journey's
 * (never J4, J5, SK_ or HK_ ids, etc.) — created via a REAL `runFlow()` call (the
 * production `orchestrator/flow-runner.ts`, not a hand-authored event log)
 * and swept inside that one beat's own try/finally, plus a crash-safe
 * leading sweep mirroring hooks-security/connections-readiness-block's own
 * create-and-destroy-its-own-throwaway-fixture precedent.
 */
import { journey as home } from './home.mjs';
import { journey as sessionsIndex } from './sessions-index.mjs';
import { journey as skills } from './skills.mjs';
import { journey as hooks } from './hooks.mjs';
import { journey as templates } from './templates.mjs';
import { journey as connections } from './connections.mjs';
import { journey as standUpOnboard } from './stand-up-onboard.mjs';
import { journey as standUpCreate } from './stand-up-create.mjs';
import { journey as knowledge } from './knowledge.mjs';
import { journey as agents } from './agents.mjs';
import { journey as flowsAuthor } from './flows-author.mjs';
import { journey as flowsRun } from './flows-run.mjs';
import { journey as flowsOnboard } from './flows-onboard.mjs';
import { journey as roadmap } from './roadmap.mjs';
import { journey as demoShowcase } from './demo-showcase.mjs';
import { journey as demoBuilder } from './demo-builder.mjs';
import { journey as community } from './community.mjs';

export const JOURNEYS = [
  home,
  sessionsIndex,
  skills,
  hooks,
  templates,
  connections,
  standUpOnboard,
  standUpCreate,
  knowledge,
  agents,
  flowsAuthor,
  flowsRun,
  flowsOnboard,
  roadmap,
  demoShowcase,
  demoBuilder,
  community,
];

export const RUN_ORDER = [
  ['home', 'home-landing'],
  ['home', 'home-projects-index'],
  ['home', 'home-attention'],
  ['home', 'home-clickthrough'],

  // W6-B11 — self-contained (its own disjoint instructions-session fixture,
  // seeded/swept entirely within its own two beats); runs right after home
  // (the "home first" constraint home.mjs's own header documents) and before
  // every other journey, which is the earliest point that preserves both of
  // this registry's two hard orderings (stand-up-onboard before flows-author;
  // flows-run before roadmap) untouched.
  ['sessions-index', 'sessions-index-home-strip'],
  ['sessions-index', 'sessions-index-overflow'],

  ['skills', 'skills-library'],
  ['skills', 'skills-detail-package'],
  ['skills', 'skills-ootb-library'],
  ['skills', 'skills-edit'],
  ['skills', 'skills-create'],
  ['skills', 'skills-install-approve'],
  ['skills', 'skills-agentic-author'],
  ['skills', 'skills-agentic-build'],

  ['hooks', 'hooks-library'],
  ['hooks', 'hooks-detail'],
  ['hooks', 'hooks-create'],
  ['hooks', 'hooks-security'],
  ['hooks', 'hooks-bind'],
  ['hooks', 'hooks-agentic-build'],

  ['templates', 'templates-library'],
  ['templates', 'templates-search'],
  ['templates', 'templates-detail-planning'],
  ['templates', 'templates-detail-scaffold'],

  ['connections', 'connections-library'],
  ['connections', 'connections-detail-tool'],
  ['connections', 'connections-detail-mcp'],
  ['connections', 'connections-readiness-block'],

  ['stand-up-onboard', 'su-onboard-project'],
  ['stand-up-onboard', 'su-onboard-session'],
  ['stand-up-onboard', 'su-onboard-preflight'],

  ['stand-up-create', 'su-create-project'],
  ['stand-up-create', 'su-create-from-template'],
  ['stand-up-create', 'su-create-library'],
  ['stand-up-create', 'su-create-orientation'],
  ['stand-up-create', 'su-create-instructions'],
  ['stand-up-create', 'su-create-project-brain'],
  // W6-B6 post-merge review — a light, self-contained beat: the generic
  // kickoff screen renders project-brain-builder's fixed-strategy chip
  // (never a session-creation path of its own).
  ['stand-up-create', 'su-create-project-brain-kickoff-chip'],
  ['stand-up-create', 'su-create-project-builder'],

  ['knowledge', 'knowledge-graph'],
  ['knowledge', 'knowledge-pin-guidance'],
  ['knowledge', 'knowledge-create-kb'],
  ['knowledge', 'knowledge-ingest'],
  ['knowledge', 'knowledge-lint-index'],
  ['knowledge', 'knowledge-create-kb-band-scope'],
  ['knowledge', 'knowledge-create-kb-band-scope-seed'],
  ['knowledge', 'knowledge-create-kb-band-scope-commit'],
  ['knowledge', 'knowledge-kb-maintain-session'],
  ['knowledge', 'knowledge-kb-cleanup-launch'],
  ['knowledge', 'knowledge-kb-cleanup-approve'],
  ['knowledge', 'knowledge-explore-tabs'],

  ['agents', 'agents-index-roster'],
  ['agents', 'agents-starters'],
  ['agents', 'agents-scratch-build'],
  ['agents', 'agents-builder'],
  ['agents', 'agents-edit-selector-open'],
  ['agents', 'agents-edit-selector-navigate'],
  ['agents', 'agents-edit-catalog-click-add'],
  ['agents', 'agents-edit-dirty'],
  ['agents', 'agents-edit-regenerate-instructions'],
  ['agents', 'agents-edit-save'],
  ['agents', 'agents-edit-byte-faithful'],
  ['agents', 'agents-materials-declare'],
  ['agents', 'agents-kickoff-ceiling-disabled'],
  ['agents', 'agents-kickoff-build-fixture'],
  ['agents', 'agents-kickoff-entry'],
  ['agents', 'agents-kickoff-materials-refused'],
  ['agents', 'agents-kickoff-set-project'],
  ['agents', 'agents-kickoff-attach-material'],
  ['agents', 'agents-kickoff-dispatch'],
  ['agents', 'agents-kickoff-run-view'],
  ['agents', 'agents-kickoff-standing-triggers'],
  ['agents', 'agents-run-reflector-detail'],
  ['agents', 'agents-run-developer-entry'],
  ['agents', 'agents-run-developer-fixture'],
  ['agents', 'agents-run-adversarial-review-entry'],
  ['agents', 'agents-run-adversarial-review-findings'],

  ['flows-author', 'flows-author-new-flow'],
  ['flows-author', 'flows-author-scratch-build'],
  ['flows-author', 'flows-author-seeded-run'],
  ['flows-author', 'flows-author-shelf-return'],

  ['flows-run', 'flows-run-idea'],
  ['flows-run', 'flows-run-grounding'],
  ['flows-run', 'flows-run-questions'],
  ['flows-run', 'flows-run-freetext'],
  ['flows-run', 'flows-run-stall'],
  ['flows-run', 'flows-run-draft-cost'],
  ['flows-run', 'flows-run-roadmap-dag'],
  ['flows-run', 'flows-run-plan-gate'],
  ['flows-run', 'flows-run-send-back'],
  ['flows-run', 'flows-run-approve'],
  ['flows-run', 'flows-run-pm-decompose'],
  ['flows-run', 'flows-run-tdd-red'],
  ['flows-run', 'flows-run-grind'],
  ['flows-run', 'flows-run-dependency-gate'],
  ['flows-run', 'flows-run-demo-review'],
  ['flows-run', 'flows-run-cost-rollup'],
  ['flows-run', 'flows-run-review-comment'],
  ['flows-run', 'flows-run-review-send-back'],
  ['flows-run', 'flows-run-sendback-cap'],
  ['flows-run', 'flows-run-rerun'],
  ['flows-run', 'flows-run-re-review'],
  ['flows-run', 'flows-run-approve-merge'],
  ['flows-run', 'flows-run-reflect'],
  ['flows-run', 'flows-run-reflect-automated'],
  ['flows-run', 'flows-run-monitor-deep-dive'],
  ['flows-run', 'flows-run-detail-reachable'],
  ['flows-run', 'flows-run-drawer-live-tail'],
  ['flows-run', 'flows-run-start-run-cta'],
  ['flows-run', 'flows-run-gate-control'],

  ['flows-onboard', 'flows-onboard-monitor'],
  ['flows-onboard', 'flows-onboard-kickoff'],
  ['flows-onboard', 'flows-onboard-gate'],

  ['roadmap', 'roadmap-tab'],
  ['roadmap', 'roadmap-canvas-controls'],
  ['roadmap', 'roadmap-plan-trigger'],
  ['roadmap', 'roadmap-start-development'],
  ['roadmap', 'roadmap-recovery'],

  ['demo-showcase', 'demo-showcase-entry'],
  ['demo-showcase', 'demo-showcase-render'],
  ['demo-showcase', 'demo-showcase-empty'],
  ['demo-showcase', 'demo-showcase-refresh'],

  // W6-B10 (R1-03-F2 reversed): the demo builder is now the dedicated
  // /sessions/demo/<sid> screen — the same session shell every interactive
  // kind renders through — not an inline project-page panel, so there is no
  // more separate "the same session, on the shared shell" detour beat to
  // register (that WAS the entrypoint, now it's the only one).
  ['demo-builder', 'demo-builder-brief'],
  ['demo-builder', 'demo-builder-generate'],
  ['demo-builder', 'demo-builder-lock'],
  // W6-B6 — a SEPARATE, self-contained session: the generic
  // /sessions/demo/new kickoff screen, registered LAST (self-contained
  // create+cleanup, touches neither demoSid nor the shared .forge/demo/
  // lock the beats above already exercised).
  ['demo-builder', 'demo-builder-kickoff'],

  // community (R3-07) runs LAST, deliberately: it installs a real skill and a
  // real hook into the repo, which changes /skills, /hooks and the
  // agent-builder palette counts — placing it last means it cannot perturb
  // any earlier journey's own pinned counts (skills-library's data-skill-
  // count, hooks-library's data-hook-count, the agent-builder catalog's chip
  // set). Its own two installed artifacts (skills/dependency-diff-review/,
  // studio/hooks/block-protected-branch-push/) are swept by its own beat's
  // try/finally (community-skills-approve-palette) with a crash-safe backstop
  // in scripts/e2e-journey.mjs's own finally (cleanCommunityArtifacts,
  // exported from community.mjs) — see that journey's own header comment.
  ['community', 'community-skills-entry'],
  ['community', 'community-skills-card-signals'],
  ['community', 'community-browse-entry'],
  ['community', 'community-hub-strip'],
  ['community', 'community-sort-freshness'],  // W6-CR-2 sort + freshness badge (between hub-strip and filter-skill, per the beat's own placement)
  ['community', 'community-filter-skill'],
  ['community', 'community-skill-detail-open'],
  ['community', 'community-skill-detail-signals'],
  ['community', 'community-skill-install'],
  ['community', 'community-hook-detail'],
  ['community', 'community-hook-install'],
  ['community', 'community-skills-shelf-return'],
  ['community', 'community-skills-detail-provenance'],
  ['community', 'community-skills-approve-palette'],
  ['community', 'community-connections-entry'],
  ['community', 'community-connections-browse-entry'],
  ['community', 'community-filter-mcp'],
  ['community', 'community-mcp-detail-open'],
  ['community', 'community-mcp-detail-capabilities'],
  ['community', 'community-mcp-install-suppressed'],
  ['community', 'community-return-to-browser'],
  ['community', 'community-connections-local-shelf'],
  ['community', 'community-connections-used-by'],
  // W6-CR-3: the refresh-entry -> session-kickoff beat runs LAST of all —
  // community already runs last of every journey (see the header comment
  // above), and this beat only reads/renders (no live agent spawn belongs
  // in a gate), so it carries no ordering risk to anything before it.
  ['community', 'community-refresh-kickoff'],
];
