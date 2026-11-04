import { FormEvent, useState } from 'react';
import { api, token } from '../api';

export function Login({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.check(value.trim());
      token.set(value.trim());
      onDone();
    } catch (err) {
      setError(
        (err as Error).message === 'Failed to fetch'
          ? 'Could not reach the API. If it is on Render free, wait ~30 seconds for it to wake up and try again.'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="card login-card">
        <h1>Job Hunter</h1>
        <p className="muted">Enter your dashboard token (the DASHBOARD_TOKEN you set on the server).</p>
        <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Token" autoFocus aria-label="Dashboard token" />
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || value.trim().length < 16}>
          {busy ? 'Checking…' : 'Open dashboard'}
        </button>
      </form>
    </div>
  );
}
