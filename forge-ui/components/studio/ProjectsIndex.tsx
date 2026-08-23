'use client';

import type { Kb, Project } from '@/lib/studio-client';
import { StudioPage } from '@/components/StudioPage';
import { FetchErrorState } from '@/components/FetchErrorState';
import { ProjectCard } from './LibraryCard';
import { summariseProjectHealth } from '@/lib/projects-index-health';
import type { Cycle, ProjectAttentionItem } from '@/lib/bridge-client';

// ---------------------------------------------------------------------------
// ProjectsIndexBody — the real /projects index (W6-IA-1), replacing the
// 23-line shim that used to redirect straight to the first registered
// project and render dead-end "No projects registered." text when there were
// none.
//
// Pure, props-driven presentational component — no fetch, no `useEffect` —
// so it renders identically under `react-dom/server`'s `renderToStaticMarkup`
// in a unit test (`lib/projects-index-render.test.ts`) and inside the real
// `app/projects/page.tsx` fetch-and-`useState` wrapper (mirrors
// `app/library/page.tsx`'s own `loadAll` shape, scoped to just
// projects+kbs). `ProjectCard` is the SAME component the Library page's
// projects section renders — one card, two shelves.
// ---------------------------------------------------------------------------

export type ProjectsIndexFetchError = { message: string; status?: number };

export function ProjectsIndexBody({
  projects,
  kbs,
  ready,
  error = null,
  onRetry,
  attention,
  cycles,
  activityError = null,
  nowMs,
}: {
  projects: Project[];
  kbs: Kb[];
  ready: boolean;
  /** W7-A1 (crosscut-01): the last fetch's failure — renders the shared
   *  failure state INSTEAD of the "No projects yet" zero-state. */
  error?: ProjectsIndexFetchError | null;
  onRetry?: () => void;
  /**
   * W8-C3 (projects-08): the RAW activity sources, read INDEPENDENTLY of the
   * roster. Both absent = the secondary read has not settled yet.
   * `activityError` = it settled and failed — which degrades one signal and
   * must never take the page down, nor read as a quiet roster.
   */
  attention?: readonly ProjectAttentionItem[];
  cycles?: readonly Cycle[];
  activityError?: ProjectsIndexFetchError | null;
  /** Deterministic "now" for relative times under test. */
  nowMs?: number;
}) {
  // Zero-state is honest: only once the first fetch has actually settled
  // (`ready`) AND the roster is genuinely empty AND the fetch did not fail —
  // an in-flight fetch must never flash a false "no projects" before real
  // data arrives, and a FAILED fetch must never claim there are no projects.
  const isEmpty = ready && !error && projects.length === 0;

  // W8-C3: derived per render off the roster itself — never held in state,
  // never fetched separately, so it cannot drift from what the cards show.
  const health = summariseProjectHealth(projects);

  // A failed secondary read is the newest truth about activity, so it wins.
  // Both sources present = 'ok'; anything less has not settled. Deliberately
  // strict: a half-populated pair would render half the signal as if it were
  // whole, which is the fail-open shape in miniature.
  const activityStatus: 'ok' | 'loading' | 'error' =
    activityError ? 'error' : attention !== undefined && cycles !== undefined ? 'ok' : 'loading';
  const activitySources = activityStatus === 'ok' ? { attention, cycles } : {};

  return (
    <StudioPage
      dataPage="projects-index"
      ready={ready}
      data={{
        'data-project-count': projects.length,
        'data-fetch-status': error ? 'error' : ready ? 'ok' : 'loading',
        // W8-C3: the activity read has its OWN status. Folding it into
        // `data-fetch-status` would make a healthy roster with a failed
        // activity read indistinguishable from a failed roster read.
        'data-activity-status': activityStatus,
      }}
      eyebrow="forge studio"
      title="Projects"
      lede="Every project forge can build. Open one to work its editor and roadmap, or bring a new repo online."
      actions={
        <>
          <a
            className="btn btn-primary"
            href="/projects/new"
            data-action="onboard-project-cta"
            style={{ textDecoration: 'none' }}
          >
            Onboard a project
          </a>
          {/* W7-B6 (projects-09): the greenfield entry exists in the header
              REGARDLESS of roster size — it used to live only in the empty
              state, so an operator with projects never learned it existed. */}
          <a
            className="btn"
            href="/projects/new"
            data-action="create-project-cta"
            style={{ textDecoration: 'none', marginLeft: 8 }}
          >
            Start a greenfield project
          </a>
        </>
      }
    >
      {error ? (
        <div style={{ marginBottom: projects.length > 0 ? 18 : 0 }}>
          <FetchErrorState what="the project roster" error={error.message} status={error.status} onRetry={onRetry} />
        </div>
      ) : null}
      {/* W8-C3: the activity read failed but the roster did not. Say so — a
          silently-missing activity row reads as "nothing is happening on any
          project", which is the exact fail-open story crosscut-01 closed for
          the roster itself. */}
      {activityError ? (
        <div
          data-component="projects-activity-error"
          style={{
            marginBottom: 14, padding: '10px 14px', fontSize: 12.5, color: 'var(--dim)',
            background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
          }}
        >
          Activity and progress are unavailable — {activityError.message}
          {activityError.status !== undefined ? ` (HTTP ${activityError.status})` : ''}. The roster below is
          still live; only the per-project activity signal is missing.
        </div>
      ) : null}
      {error && projects.length === 0 ? null : isEmpty ? (
        <section
          data-section="projects-empty"
          aria-label="No projects yet"
          style={{
            padding: '28px 30px',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            No projects yet
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--dim)', maxWidth: 560, lineHeight: 1.6, margin: 0 }}>
            Onboard an existing repository so a flow can build it, or start a greenfield project
            with no repo checked out yet — both open the same onboarding form.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a
              className="btn btn-primary"
              href="/projects/new"
              data-action="onboard-project-cta"
              style={{ textDecoration: 'none' }}
            >
              Onboard a project
            </a>
            <a
              className="btn"
              href="/projects/new"
              data-action="create-project-cta"
              style={{ textDecoration: 'none' }}
            >
              Start a greenfield project
            </a>
          </div>
        </section>
      ) : (
        <div
          className="card-grid"
          data-section="projects-grid"
          data-count={projects.length}
          /* W8-C3 (projects-08): the roster health rollup, derived from the
             SAME `deriveProjectHealth` each card calls — a summary that could
             disagree with the cards under it is worse than no summary. The
             four counts always sum to `data-count`. */
          data-health-healthy={health.healthy}
          data-health-attention={health.attention}
          data-health-broken={health.broken}
          data-health-unknown={health.unknown}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))', gap: 14 }}
        >
          {projects.map((p, i) => (
            <ProjectCard key={p.id} project={p} kbs={kbs} index={i} nowMs={nowMs} {...activitySources} />
          ))}
        </div>
      )}
    </StudioPage>
  );
}
