import { useState, useEffect } from 'react';
import type { AdminApi, KnowledgeDocument } from '../api';

const TYPES = [
  'runbook',
  'postmortem',
  'architecture',
  'ownership',
  'known_issue',
  'environment',
  'playbook',
  'faq',
];

interface DocumentEditProps {
  api: AdminApi;
  id: string;
}

export function DocumentEdit({ api, id }: DocumentEditProps) {
  const [doc, setDoc] = useState<KnowledgeDocument | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [content, setContent] = useState('');
  const [servicesInput, setServicesInput] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .getDocument(id)
      .then((d) => {
        if (cancelled) return;
        setDoc(d);
        setTitle(d.title);
        setType(d.type);
        setContent(d.content);
        setServicesInput(d.services.join(', '));
        setTagsInput(d.tags.join(', '));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.updateDocument(id, {
        title,
        type,
        content,
        services: servicesInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        tags: tagsInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      window.location.hash = `/documents/${encodeURIComponent(id)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (error && !doc) return <div className="error-banner">{error}</div>;
  if (!doc) return <div className="loading">Loading...</div>;

  return (
    <div>
      <h1 className="page-title">Edit Document</h1>

      <form onSubmit={handleSave} className="edit-form">
        {error && <div className="error-banner">{error}</div>}

        <label className="form-label">
          Title
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>

        <label className="form-label">
          Type
          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="form-label">
          Content
          <textarea
            className="textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
          />
        </label>

        <label className="form-label">
          Services (comma-separated)
          <input
            className="input"
            value={servicesInput}
            onChange={(e) => setServicesInput(e.target.value)}
            placeholder="e.g. api-gateway, auth-service"
          />
        </label>

        <label className="form-label">
          Tags (comma-separated)
          <input
            className="input"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="e.g. networking, database"
          />
        </label>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <a href={`#/documents/${encodeURIComponent(id)}`} className="btn btn-ghost">
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
