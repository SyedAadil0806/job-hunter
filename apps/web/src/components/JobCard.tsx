import { useState } from 'react';
import { api, JobSummary } from '../api';

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="score none">–</span>;
  const tone = score >= 80 ? 'high' : score >= 65 ? 'mid' : 'low';
  return (
    <span className={`score ${tone}`} title="Match score">
      {score}
    </span>
  );
}

export const timeAgo = (iso: string | null) => {
  if (!iso) return '';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 8.64e7);
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
};

interface Props {
  job: JobSummary;
  sourceLabel: string;
  onOpen: () => void;
  onChange: () => void;
}

export function JobCard({ job, sourceLabel, onOpen, onChange }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const hasCv = job._count.cvVersions > 0;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
      if (label !== 'download') onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="card job">
      <div className="job-head">
        <ScoreBadge score={job.score} />
        <div className="job-title">
          <button className="link-btn" onClick={onOpen}>
            <h3>{job.title}</h3>
          </button>
          <p className="muted">
            {job.company} · {job.location}
            {job.isRemote && <span className="chip remote">Remote</span>}
          </p>
        </div>
      </div>

      {job.scoreReason && <p className="reason">{job.scoreReason}</p>}

      <div className="chips">
        {job.matchedSkills.slice(0, 6).map((s) => (
          <span key={s} className="chip ok">
            {s}
          </span>
        ))}
        {job.missingSkills.slice(0, 4).map((s) => (
          <span key={s} className="chip miss" title="You don't have this one">
            {s}
          </span>
        ))}
      </div>
      {job.redFlags.length > 0 && <p className="flags">⚠ {job.redFlags.join(' · ')}</p>}

      <p className="meta">
        <a href={job.url} target="_blank" rel="noreferrer">
          View on {sourceLabel} ↗
        </a>
        <span>{timeAgo(job.postedAt ?? job.createdAt)}</span>
        {job.salary && <span>{job.salary}</span>}
      </p>

      {error && <p className="error small">{error}</p>}

      <div className="actions">
        {hasCv ? (
          <button className="btn" disabled={!!busy} onClick={() => run('download', () => api.downloadCv(job.id, 'CV.pdf'))}>
            {busy === 'download' ? 'Downloading…' : 'Download CV'}
          </button>
        ) : (
          <button className="btn" disabled={!!busy} onClick={() => run('tailor', () => api.tailor(job.id))}>
            {busy === 'tailor' ? 'Tailoring… (~20s)' : 'Make CV'}
          </button>
        )}
        <button className="btn ghost" onClick={onOpen}>
          Cover letter
        </button>
        {job.status === 'SKIPPED' ? (
          <button className="btn ghost" disabled={!!busy} onClick={() => run('unskip', () => api.unskip(job.id))}>
            Restore
          </button>
        ) : (
          <>
            <button className="btn ghost" disabled={!!busy} onClick={() => run('skip', () => api.skip(job.id))}>
              Skip
            </button>
            <button className="btn primary" disabled={!!busy} onClick={() => run('apply', () => api.apply(job.id))} title="Click after you submit the application">
              I applied ✓
            </button>
          </>
        )}
      </div>
    </article>
  );
}
