import { useEffect, useState } from 'react';
import { api, JobDetail } from '../api';
import { ScoreBadge } from './JobCard';

interface Props {
  id: string;
  sourceLabel: (source: string) => string;
  onClose: () => void;
  onChange: () => void;
}

export function JobDrawer({ id, sourceLabel, onClose, onChange }: Props) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api.job(id).then(setJob).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const latest = job?.cvVersions[0];

  const copy = async () => {
    if (!latest) return;
    try {
      await navigator.clipboard.writeText(latest.coverLetter);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy. Select the text and copy it by hand.');
    }
  };

  const remake = async () => {
    setBusy(true);
    setError('');
    try {
      await api.tailor(id);
      await load();
      onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Job details">
        <button className="btn ghost small close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {error && <p className="error">{error}</p>}
        {!job && !error && <p className="muted">Loading…</p>}
        {job && (
          <>
            <div className="job-head">
              <ScoreBadge score={job.score} />
              <div>
                <h2>{job.title}</h2>
                <p className="muted">
                  {job.company} · {job.location} ·{' '}
                  <a href={job.url} target="_blank" rel="noreferrer">
                    Open on {sourceLabel(job.source)} ↗
                  </a>
                </p>
              </div>
            </div>

            <h4>Cover letter</h4>
            {latest ? (
              <>
                <pre className="letter">{latest.coverLetter}</pre>
                <div className="actions">
                  <button className="btn" onClick={copy}>
                    {copied ? 'Copied ✓' : 'Copy cover letter'}
                  </button>
                  <button className="btn ghost" onClick={() => api.downloadCv(job.id, 'CV.pdf').catch((e) => setError(e.message))}>
                    Download CV
                  </button>
                  <button className="btn ghost" disabled={busy} onClick={remake}>
                    {busy ? 'Remaking…' : 'Remake CV'}
                  </button>
                </div>
                <h4>Tailored summary</h4>
                <p>{latest.content.summary}</p>
              </>
            ) : (
              <button className="btn primary" disabled={busy} onClick={remake}>
                {busy ? 'Tailoring… (~20s)' : 'Make CV and cover letter'}
              </button>
            )}

            <h4>Job description</h4>
            <div className="description">{job.description}</div>
          </>
        )}
      </aside>
    </div>
  );
}
