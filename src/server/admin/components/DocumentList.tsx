import { useState, useEffect } from 'react';
import type { AdminApi, KnowledgeDocument } from '../api';

const TYPE_LABELS: Record<string, string> = {
  runbook: 'Runbook',
  postmortem: 'Postmortem',
  architecture: 'Architecture',
  ownership: 'Ownership',
  known_issue: 'Known Issue',
  environment: 'Environment',
  playbook: 'Playbook',
  faq: 'FAQ',
};

interface DocumentListProps {
  api: AdminApi;
}

export function DocumentList({ api }: DocumentListProps) {
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getServices()
      .then(setServices)
      .catch(() => {});
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getDocuments(typeFilter || undefined)
      .then((d) => {
        if (cancelled) return;
        if (serviceFilter) {
          d = d.filter((doc) => doc.services.includes(serviceFilter));
        }
        setDocs(d);
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
  }, [api, typeFilter, serviceFilter]);

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return;
    try {
      await api.deleteDocument(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (error) return <div className="error-banner">{error}</div>;

  return (
    <div>
      <h1 className="page-title">Documents</h1>

      <div className="filters">
        <select
          className="select"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
        >
          <option value="">All services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Services</th>
              <th>Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr
                key={doc.id}
                className="table-row-clickable"
                onClick={() => {
                  window.location.hash = `/documents/${encodeURIComponent(doc.id)}`;
                }}
              >
                <td className="doc-title-cell">{doc.title}</td>
                <td>
                  <span className={`badge badge-${doc.type}`}>
                    {TYPE_LABELS[doc.type] || doc.type}
                  </span>
                </td>
                <td className="services-cell">{doc.services.join(', ') || '-'}</td>
                <td className="date-cell">
                  {doc.updatedAt ? new Date(doc.updatedAt).toLocaleDateString() : '-'}
                </td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(doc.id, doc.title);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {docs.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-state">
                  No documents found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
