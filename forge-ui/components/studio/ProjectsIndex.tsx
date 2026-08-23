'use client';

import type { Kb, Project } from '@/lib/studio-client';
import { StudioPage } from '@/components/StudioPage';
import { FetchErrorState } from '@/components/FetchErrorState';
import { ProjectCard } from './LibraryCard';
import { summariseProjectHealth } from '@/lib/projects-index-health';

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
}: {
  projects: Project[];
  kbs: Kb[];
  ready: boolean;
  /** W7-A1 (crosscut-01): the last fetch's failure — renders the shared
   *  failure state INSTEAD of the "No projects yet" zero-state. */
  error?: ProjectsIndexFetchError | null;
  onRetry?: () => void;
}) {
  // Zero-state is honest: only once the first fetch has actually settled
  // (`ready`) AND the roster is genuinely empty AND the fetch did not fail —
  // an in-flight fetch must never flash a false "no projects" before real
  // data arrives, and a FAILED fetch must never claim there are no projects.
  const isEmpty = ready && !error && projects.length === 0;

  // W8-C3: derived per render off the roster itself — never held in state,
  // never fetched separately, so it cannot drift from what the cards show.
  const health = summariseProjectHealth(projects);

  return (
    <StudioPage
      dataPage="projects-index"
      ready={ready}
      data={{
        'data-project-count': projects.length,
        'data-fetch-status': error ? 'error' : ready ? 'ok' : 'loading',
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
            <ProjectCard key={p.id} project={p} kbs={kbs} index={i} />
          ))}
        </div>
      )}
    </StudioPage>
  );
}
