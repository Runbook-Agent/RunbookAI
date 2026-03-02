import { useState, useEffect } from 'react';
import type { AdminApi, HealthData } from '../api';

const TYPE_LABELS: Record<string, string> = {
  runbook: 'Runbooks',
  postmortem: 'Postmortems',
  architecture: 'Architecture',
  ownership: 'Ownership',
  known_issue: 'Known Issues',
  environment: 'Environment',
  playbook: 'Playbooks',
  faq: 'FAQs',
};

interface DashboardProps {
  api: AdminApi;
}

export function Dashboard({ api }: DashboardProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [serviceCount, setServiceCount] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [h, s, svc] = await Promise.all([api.getHealth(), api.getStats(), api.getServices()]);
        if (cancelled) return;
        setHealth(h);
        setStats(s);
        setServiceCount(svc.length);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!health || !stats) return <div className="loading">Loading...</div>;

  const totalDocs = Object.values(stats).reduce((sum, n) => sum + n, 0);

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>

      <div className="stats-grid">
        <div className="stat-card stat-card-highlight">
          <div className="stat-value">{totalDocs}</div>
          <div className="stat-label">Total Documents</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{serviceCount}</div>
          <div className="stat-label">Services</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{health.version}</div>
          <div className="stat-label">Version</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatUptime(health.uptime)}</div>
          <div className="stat-label">Uptime</div>
        </div>
      </div>

      <h2 className="section-title">Documents by Type</h2>
      <div className="type-grid">
        {Object.entries(stats).map(([type, count]) => (
          <a key={type} href={`#/documents?type=${type}`} className="type-card">
            <span className={`badge badge-${type}`}>{TYPE_LABELS[type] || type}</span>
            <span className="type-count">{count}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
