import { useCallback, useEffect, useState } from 'react';
import { api, JobStatus, JobSummary } from '../api';
import { JobCard } from './JobCard';
import { JobDrawer } from './JobDrawer';

interface Props {
  status?: JobStatus;
  sources: Record<string, string>;
  onChange: () => void;
  showFilters?: boolean;
  empty: string;
}

export function JobsView({ status, sources, onChange, showFilters, empty }: Props) {
  const [items, setItems] = useState<JobSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [minScore, setMinScore] = useState(60);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError('');
    api
      .jobs({ status, minScore: showFilters ? minScore : undefined, q: q || undefined })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(e.message));
  }, [status, minScore, q, showFilters]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const changed = () => {
    load();
    onChange();
  };

  return (
    <section>
      {showFilters && (
        <div className="filters">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or company" aria-label="Search" />
          <label className="range">
            Min score <strong>{minScore}</strong>
            <input type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
          </label>
          <span className="muted">{total} jobs</span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {items === null && !error && <p className="muted pad">Loading…</p>}
      {items?.length === 0 && <p className="muted pad">{empty}</p>}
      <div className="grid">
        {items?.map((j) => <JobCard key={j.id} job={j} sourceLabel={sources[j.source] ?? j.source} onOpen={() => setOpenId(j.id)} onChange={changed} />)}
      </div>
      {openId && <JobDrawer id={openId} sourceLabel={(s) => sources[s] ?? s} onClose={() => setOpenId(null)} onChange={changed} />}
    </section>
  );
}
