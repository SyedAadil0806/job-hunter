import { useEffect, useState } from 'react';
import { api } from '../api';

const CHECK_EVERY_MS = 30_000;

/** Starts a job search from the dashboard. Hidden until the API has a GitHub key. */
export function RunNow({ onFinished }: { onFinished: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .runNowStatus()
      .then((s) => {
        setEnabled(s.enabled);
        setRunning(s.running);
      })
      .catch(() => undefined);
  }, []);

  // Keep checking only while a run is going.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      api
        .runNowStatus()
        .then((s) => {
          if (s.running) return;
          setRunning(false);
          onFinished();
        })
        .catch(() => undefined);
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [running, onFinished]);

  if (!enabled) return null;

  const start = async () => {
    if (!window.confirm('Start a job search now? It takes about 5 to 15 minutes and uses 3 of your monthly Google searches.')) return;
    setStarting(true);
    setError('');
    try {
      await api.runNow();
      setRunning(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      <button className="btn ghost small" onClick={start} disabled={running || starting}>
        {running ? 'Running…' : starting ? 'Starting…' : 'Run now'}
      </button>
      {error && (
        <p className="error run-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
