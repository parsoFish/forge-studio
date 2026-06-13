'use client';

import { useState } from 'react';

type SkillItem = { id: string; name: string; desc?: string };

export function SkillsBind({
  skills, onChange, catalog,
}: {
  skills: string[];
  onChange: (s: string[]) => void;
  catalog: SkillItem[];
}) {
  const [search, setSearch] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragSkillId, setDragSkillId] = useState<string | null>(null);

  const filtered = catalog.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.desc ?? '').toLowerCase().includes(search.toLowerCase())
  );

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
                      const item = catalog.find((c) => c.id === sid);
                      return (
                        <span key={sid} className="chip" data-kind="skill">
                          <span className="dot" />
                          {item?.name ?? sid}
                          <span
                            className="x"
                            onClick={() => removeSkill(sid)}
                            style={{ cursor: 'pointer' }}
                          >×</span>
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
