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

interface DocumentViewProps {
  api: AdminApi;
  id: string;
}

export function DocumentView({ api, id }: DocumentViewProps) {
  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getDocument(id)
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  const handleDelete = async () => {
    if (!doc || !confirm(`Delete "${doc.title}"?`)) return;
    try {
      await api.deleteDocument(id);
      window.location.hash = '/documents';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (error) return <div className="error-banner">{error}</div>;
  if (!doc) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="doc-header">
        <div>
          <h1 className="page-title">{doc.title}</h1>
          <div className="doc-meta">
            <span className={`badge badge-${doc.type}`}>{TYPE_LABELS[doc.type] || doc.type}</span>
            {doc.services.map((s) => (
              <span key={s} className="badge badge-service">
                {s}
              </span>
            ))}
            {doc.author && <span className="meta-text">by {doc.author}</span>}
            {doc.updatedAt && (
              <span className="meta-text">
                Updated {new Date(doc.updatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="doc-actions">
          <a href={`#/documents/${encodeURIComponent(id)}/edit`} className="btn btn-primary">
            Edit
          </a>
          <button className="btn btn-ghost btn-danger" onClick={handleDelete}>
            Delete
          </button>
        </div>
      </div>

      {doc.tags.length > 0 && (
        <div className="tags-row">
          {doc.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}

      {doc.sourceUrl && (
        <p className="source-link">
          Source:{' '}
          <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
            {doc.sourceUrl}
          </a>
        </p>
      )}

      <div className="doc-content">
        <pre>{doc.content}</pre>
      </div>
    </div>
  );
}
