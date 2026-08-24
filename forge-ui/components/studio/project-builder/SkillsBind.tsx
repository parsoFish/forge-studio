'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  offeredSkills,
  filterSkillCatalog,
  resolveSkillBinding,
  type SkillItem,
} from '@/lib/project-skills-bind';

export function SkillsBind({
  skills, onChange, catalog, localSkills = [],
}: {
  skills: string[];
  onChange: (s: string[]) => void;
  /** The forge-wide library (`GET /api/studio/catalog`). */
  catalog: SkillItem[];
  /**
   * W8-C3 (projects-06): the ids of skills that live INSIDE this project
   * (`.forge/skills/<id>/SKILL.md`), derived per request by the bridge. Without
   * these the picker is forge-wide only, so a project-local skill that is
   * unbound can never be re-bound.
   */
  localSkills?: readonly string[];
}) {
  const [search, setSearch] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragSkillId, setDragSkillId] = useState<string | null>(null);

  // ONE offered set, derived from every real source; the library lists it and
  // every chip resolves against it. That is what makes "the picker cannot
  // offer this back" (projects-06) and "this chip is lying" (projects-43) the
  // same fact, judged in one place instead of two.
  const offered = offeredSkills(catalog, localSkills);
  const filtered = filterSkillCatalog(offered, search);

  function addSkill(id: string) {
    if (skills.includes(id)) return;
    onChange([...skills, id]);
  }

  function removeSkill(id: string) {
    onChange(skills.filter((s) => s !== id));
  }

  return (
    <section>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        Relevant Skills <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        {/* P2: author a new skill in-platform. */}
        <Link href="/skills/new" data-action="author-skill" style={{ fontSize: 10.5, color: 'var(--ember)', textDecoration: 'none', whiteSpace: 'nowrap' }}>+ author a skill</Link>
      </div>
      <div className="panel">
        <div className="panel-head"><span>Skills agents should load when working this project</span></div>
        <div className="panel-body">
          <div style={{ display: 'flex', gap: 16 }}>
            {/* Library */}
            <div style={{ width: 220, flexShrink: 0 }}>
              <input
                className="input"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search skills…"
                style={{ marginBottom: 8, fontSize: 13 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 220, overflowY: 'auto' }}>
                {filtered.map((sk) => (
                  <div
                    key={sk.id}
                    draggable
                    data-skill-id={sk.id}
                    data-skill-source={sk.source ?? 'forge'}
                    onDragStart={() => setDragSkillId(sk.id)}
                    onDragEnd={() => setDragSkillId(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', background: 'var(--panel-2)',
                      border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
                      cursor: 'grab', userSelect: 'none', fontSize: 12.5,
                    }}
                    title={sk.desc}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--violet)', flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden' }}>
                      {sk.name}
                      {sk.desc && <span style={{ display: 'block', fontSize: 11, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{sk.desc}</span>}
                    </span>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '2px 7px', fontSize: 11, marginLeft: 'auto', flexShrink: 0 }}
                      onClick={() => addSkill(sk.id)}
                      title="Add to project"
                    >+</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Drop zone */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, color: 'var(--faint)', marginBottom: 6, fontStyle: 'italic' }}>Drag skills here, or click + in the library</div>
              <div
                className={`drop-zone${isDragOver ? ' drag-over' : ''}`}
                data-accepts="skill"
                data-count={skills.length}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setIsDragOver(false);
                  if (dragSkillId) addSkill(dragSkillId);
                }}
              >
                {skills.length === 0
                  ? <span className="placeholder">Drop skills here — agents will load these when working this project</span>
                  : skills.map((sid) => {
                      // W8-C3 (projects-43): resolved against the OFFERED set,
                      // not against `catalog` with a `?? sid` fallback. The
                      // fallback was the defect: it rendered an unresolvable
                      // binding as its own raw id, which reads as a healthy chip.
                      const binding = resolveSkillBinding(sid, offered);
                      return (
                        <span
                          key={sid}
                          className="chip"
                          data-kind="skill"
                          data-skill-id={sid}
                          data-resolved={binding.resolved ? 'ok' : 'missing'}
                          data-skill-source={binding.source}
                          title={binding.resolved
                            ? (binding.source === 'project' ? `${binding.label} — lives in this project (.forge/skills)` : binding.label)
                            : `${sid} — missing: no skill with this id exists forge-wide or in this project`}
                          style={binding.resolved ? undefined : { borderColor: 'var(--ember)', color: 'var(--ember)' }}
                        >
                          <span className="dot" style={binding.resolved ? undefined : { background: 'var(--ember)' }} />
                          {binding.label}
                          {!binding.resolved && (
                            <span style={{ fontSize: 10.5, marginLeft: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>missing</span>
                          )}
                          {binding.resolved && binding.source === 'project' && (
                            <span style={{ fontSize: 10.5, marginLeft: 6, color: 'var(--faint)' }}>project</span>
                          )}
                          {/* W7-B6 (projects-07): a REAL button — keyboard-
                              reachable, announced ("Remove skill X") — not a
                              click-only bare span. */}
                          <button
                            type="button"
                            className="x"
                            aria-label={binding.resolved ? `Remove skill ${binding.label}` : `Remove missing skill ${sid}`}
                            onClick={() => removeSkill(sid)}
                            style={{ cursor: 'pointer', background: 'none', border: 'none', color: 'inherit', font: 'inherit', padding: 0 }}
                          >×</button>
                        </span>
                      );
                    })
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
