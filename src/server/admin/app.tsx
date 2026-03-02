import { useState, useEffect, useCallback } from 'react';
import { AdminApi } from './api';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { DocumentList } from './components/DocumentList';
import { DocumentView } from './components/DocumentView';
import { DocumentEdit } from './components/DocumentEdit';
import { Search } from './components/Search';
import { Sources } from './components/Sources';

function parseHash(): { page: string; id?: string; action?: string } {
  const hash = window.location.hash.slice(1) || '/';
  const parts = hash.split('/').filter(Boolean);

  if (parts[0] === 'documents' && parts[1] && parts[2] === 'edit') {
    return { page: 'document-edit', id: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === 'documents' && parts[1]) {
    return { page: 'document-view', id: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === 'documents') return { page: 'documents' };
  if (parts[0] === 'search') return { page: 'search' };
  if (parts[0] === 'sources') return { page: 'sources' };
  return { page: 'dashboard' };
}

function LoginScreen({ onLogin }: { onLogin: (key: string) => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    try {
      const api = new AdminApi(key.trim());
      await api.getHealth();
      onLogin(key.trim());
    } catch {
      setError('Invalid API key or server unreachable');
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1 className="login-title">RunbookAI Admin</h1>
        <p className="login-subtitle">Enter your API key to continue</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            className="input"
            placeholder="API Key"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setError('');
            }}
            autoFocus
          />
          {error && <p className="error-text">{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '12px' }}
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

export function App() {
  const [apiKey, setApiKey] = useState<string | null>(() =>
    sessionStorage.getItem('admin_api_key')
  );
  const [route, setRoute] = useState(parseHash);

  const handleHashChange = useCallback(() => {
    setRoute(parseHash());
  }, []);

  useEffect(() => {
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [handleHashChange]);

  const handleLogin = (key: string) => {
    sessionStorage.setItem('admin_api_key', key);
    setApiKey(key);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('admin_api_key');
    setApiKey(null);
  };

  if (!apiKey) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  const api = new AdminApi(apiKey);

  let content: React.ReactNode;
  switch (route.page) {
    case 'documents':
      content = <DocumentList api={api} />;
      break;
    case 'document-view':
      content = <DocumentView api={api} id={route.id!} />;
      break;
    case 'document-edit':
      content = <DocumentEdit api={api} id={route.id!} />;
      break;
    case 'search':
      content = <Search api={api} />;
      break;
    case 'sources':
      content = <Sources api={api} />;
      break;
    default:
      content = <Dashboard api={api} />;
      break;
  }

  return (
    <Layout currentPage={route.page} onLogout={handleLogout} api={api}>
      {content}
    </Layout>
  );
}
