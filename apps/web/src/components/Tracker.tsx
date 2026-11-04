import { useEffect, useState } from 'react';
import { api, Application, APPLICATION_STATUSES, ApplicationStatus } from '../api';
import { ScoreBadge } from './JobCard';

const label = (s: ApplicationStatus) => s.charAt(0) + s.slice(1).toLowerCase();

export function Tracker({ sources, onChange }: { sources: Record<string, string>; onChange: () => void }) {
  const [rows, setRows] = useState<Application[] | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<ApplicationStatus | 'ALL'>('ALL');

  const load = () =>
    api
      .applications()
      .then(setRows)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const update = async (id: string, body: { status?: ApplicationStatus; notes?: string }) => {
    try {
      const updated = await api.updateApplication(id, body);
      setRows((r) => r?.map((x) => (x.id === id ? { ...x, ...updated, job: x.job } : x)) ?? null);
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const undo = async (id: string) => {
    if (!confirm('Remove this from your applied list?')) return;
    try {
      await api.removeApplication(id);
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const shown = rows?.filter((r) => filter === 'ALL' || r.status === filter) ?? [];
  const counts = APPLICATION_STATUSES.map((s) => [s, rows?.filter((r) => r.status === s).length ?? 0] as const);

  return (
    <section>
      <div className="filters">
        <button className={filter === 'ALL' ? 'pill active' : 'pill'} onClick={() => setFilter('ALL')}>
          All {rows?.length ?? 0}
        </button>
        {counts
          .filter(([, n]) => n > 0)
          .map(([s, n]) => (
            <button key={s} className={filter === s ? `pill active ${s}` : `pill ${s}`} onClick={() => setFilter(s)}>
              {label(s)} {n}
            </button>
          ))}
      </div>
      {error && <p className="error">{error}</p>}
      {rows === null && !error && <p className="muted pad">Loading…</p>}
      {rows?.length === 0 && <p className="muted pad">No applications yet. Click “I applied ✓” on a job after you apply.</p>}

      {shown.length > 0 && (
        <div className="table-wrap">
          <table className="tracker">
            <thead>
              <tr>
                <th>Score</th>
                <th>Role</th>
                <th>Applied</th>
                <th>Status</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <ScoreBadge score={r.job?.score ?? null} />
                  </td>
                  <td>
                    <a href={r.job?.url} target="_blank" rel="noreferrer" className="strong">
                      {r.job?.title}
                    </a>
                    <div className="muted small">
                      {r.job?.company} · {r.job?.location} · via {sources[r.job?.source ?? ''] ?? r.job?.source}
                    </div>
                  </td>
                  <td className="nowrap">{new Date(r.appliedAt).toLocaleDateString()}</td>
                  <td>
                    <select value={r.status} onChange={(e) => update(r.id, { status: e.target.value as ApplicationStatus })} aria-label="Status">
                      {APPLICATION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {label(s)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      defaultValue={r.notes ?? ''}
                      placeholder="Add a note"
                      onBlur={(e) => e.target.value !== (r.notes ?? '') && update(r.id, { notes: e.target.value })}
                      aria-label="Notes"
                    />
                  </td>
                  <td>
                    <button className="btn ghost small" onClick={() => undo(r.id)} title="Undo">
                      Undo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
