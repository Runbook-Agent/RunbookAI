import { useState } from 'react';
import type { AdminApi, RetrievedKnowledge, RetrievedChunk } from '../api';

const TYPE_LABELS: Record<string, string> = {
  runbook: 'Runbooks',
  postmortem: 'Postmortems',
  architecture: 'Architecture',
  known_issue: 'Known Issues',
};

interface SearchProps {
  api: AdminApi;
}

export function Search({ api }: SearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievedKnowledge | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const res = await api.search(query);
      setResults(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const sections: [string, RetrievedChunk[]][] = results
    ? ([
        ['runbook', results.runbooks],
        ['postmortem', results.postmortems],
        ['architecture', results.architecture],
        ['known_issue', results.knownIssues],
      ].filter(([, chunks]) => (chunks as RetrievedChunk[]).length > 0) as [
        string,
        RetrievedChunk[],
      ][])
    : [];

  const totalResults = sections.reduce((sum, [, chunks]) => sum + chunks.length, 0);

  return (
    <div>
      <h1 className="page-title">Search</h1>

      <form onSubmit={handleSearch} className="search-form">
        <input
          className="input search-input"
          placeholder="Search knowledge base..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn btn-primary" disabled={searching}>
          {searching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <div className="error-banner">{error}</div>}

      {results && (
        <div className="search-results">
          <p className="results-count">
            {totalResults} result{totalResults !== 1 ? 's' : ''} found
          </p>

          {sections.map(([type, chunks]) => (
            <div key={type} className="result-section">
              <h2 className="section-title">{TYPE_LABELS[type] || type}</h2>
              {chunks.map((chunk) => (
                <a
                  key={chunk.id}
                  href={`#/documents/${encodeURIComponent(chunk.documentId)}`}
                  className="result-card"
                >
                  <div className="result-header">
                    <span className="result-title">{chunk.title}</span>
                    <span className="result-score">{Math.round(chunk.score * 100)}%</span>
                  </div>
                  <p className="result-content">{chunk.content.slice(0, 200)}...</p>
                  {chunk.services.length > 0 && (
                    <div className="result-services">
                      {chunk.services.map((s) => (
                        <span key={s} className="badge badge-service">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </a>
              ))}
            </div>
          ))}

          {totalResults === 0 && <div className="empty-state">No results found for "{query}"</div>}
        </div>
      )}
    </div>
  );
}
