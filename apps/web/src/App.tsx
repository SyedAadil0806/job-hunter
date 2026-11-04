import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, Stats, token } from './api';
import { JobsView } from './components/JobsView';
import { Login } from './components/Login';
import { Tracker } from './components/Tracker';

type Tab = 'ready' | 'matches' | 'skipped' | 'tracker';

const TABS: { id: Tab; label: string }[] = [
  { id: 'ready', label: 'Ready to apply' },
  { id: 'matches', label: 'All matches' },
  { id: 'tracker', label: 'Applied' },
  { id: 'skipped', label: 'Skipped' },
];

export function App() {
  const [authed, setAuthed] = useState(Boolean(token.get()));
  const [tab, setTab] = useState<Tab>('ready');
  const [stats, setStats] = useState<Stats | null>(null);
  const [sources, setSources] = useState<Record<string, string>>({});

  const refreshStats = useCallback(() => {
    api
      .stats()
      .then(setStats)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          token.clear();
          setAuthed(false);
        }
      });
  }, []);

  useEffect(() => {
    if (!authed) return;
    refreshStats();
    api.sources().then(setSources).catch(() => undefined);
  }, [authed, refreshStats]);

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const count = (t: Tab) =>
    t === 'ready'
      ? stats?.jobs.READY
      : t === 'matches'
        ? (stats?.jobs.SCORED ?? 0) + (stats?.jobs.READY ?? 0)
        : t === 'tracker'
          ? stats?.jobs.APPLIED
          : stats?.jobs.SKIPPED;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>◎</span>
          <span>Job Hunter</span>
        </div>
        {stats?.lastRun && (
          <p className="last-run">
            Last run {new Date(stats.lastRun.startedAt).toLocaleString()} · {stats.lastRun.newJobs} new · {stats.lastRun.scored} scored ·{' '}
            {stats.lastRun.tailored} CVs
            {stats.lastRun.errors.length > 0 && (
              <span className="warn" title={stats.lastRun.errors.join('\n')}>
                {' '}
                · {stats.lastRun.errors.length} warnings
              </span>
            )}
          </p>
        )}
        <button
          className="btn ghost small"
          onClick={() => {
            token.clear();
            setAuthed(false);
          }}
        >
          Log out
        </button>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
            {count(t.id) ? <span className="count">{count(t.id)}</span> : null}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'ready' && <JobsView key="ready" status="READY" sources={sources} onChange={refreshStats} empty="No tailored CVs yet. They appear here after the morning run." />}
        {tab === 'matches' && <JobsView key="matches" sources={sources} onChange={refreshStats} showFilters empty="No scored jobs yet." />}
        {tab === 'skipped' && <JobsView key="skipped" status="SKIPPED" sources={sources} onChange={refreshStats} empty="Nothing skipped." />}
        {tab === 'tracker' && <Tracker sources={sources} onChange={refreshStats} />}
      </main>
    </div>
  );
}
