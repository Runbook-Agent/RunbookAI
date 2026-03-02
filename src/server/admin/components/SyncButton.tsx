import { useState } from 'react';
import type { AdminApi } from '../api';

interface SyncButtonProps {
  api: AdminApi;
}

export function SyncButton({ api }: SyncButtonProps) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);
  const [error, setError] = useState('');

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    setResult(null);
    try {
      const res = await api.sync();
      setResult(res);
      setTimeout(() => setResult(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      setTimeout(() => setError(''), 5000);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <button
        className="btn btn-secondary"
        onClick={handleSync}
        disabled={syncing}
        style={{ width: '100%' }}
      >
        {syncing ? 'Syncing...' : 'Sync Knowledge'}
      </button>
      {result && (
        <p className="sync-result">
          +{result.added} added, {result.updated} updated
        </p>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
