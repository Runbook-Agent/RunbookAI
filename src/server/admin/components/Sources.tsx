import { useState, useEffect } from 'react';
import type { AdminApi, SourceInfo } from '../api';

interface SourcesProps {
  api: AdminApi;
}

export function Sources({ api }: SourcesProps) {
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getSources()
      .then((s) => {
        if (!cancelled) setSources(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (error) return <div className="error-banner">{error}</div>;
  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <h1 className="page-title">Knowledge Sources</h1>

      {sources.length === 0 ? (
        <div className="empty-state">No knowledge sources configured</div>
      ) : (
        <div className="sources-grid">
          {sources.map((source, i) => (
            <div key={i} className="source-card">
              <div className="source-header">
                <span className={`badge badge-${source.type}`}>{source.type}</span>
                <span
                  className={`auth-badge ${source.authConfigured ? 'auth-configured' : 'auth-missing'}`}
                >
                  {source.authConfigured ? 'Auth configured' : 'No auth'}
                </span>
              </div>
              <dl className="source-details">
                {source.path && (
                  <>
                    <dt>Path</dt>
                    <dd className="mono">{source.path}</dd>
                  </>
                )}
                {source.repo && (
                  <>
                    <dt>Repository</dt>
                    <dd className="mono">{source.repo}</dd>
                  </>
                )}
                {source.branch && (
                  <>
                    <dt>Branch</dt>
                    <dd>{source.branch}</dd>
                  </>
                )}
                {source.baseUrl && (
                  <>
                    <dt>Base URL</dt>
                    <dd className="mono">{source.baseUrl}</dd>
                  </>
                )}
                {source.spaceKey && (
                  <>
                    <dt>Space Key</dt>
                    <dd>{source.spaceKey}</dd>
                  </>
                )}
                {source.endpoint && (
                  <>
                    <dt>Endpoint</dt>
                    <dd className="mono">{source.endpoint}</dd>
                  </>
                )}
                {source.databaseId && (
                  <>
                    <dt>Database ID</dt>
                    <dd className="mono">{source.databaseId}</dd>
                  </>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
