import type { AdminApi } from '../api';
import { SyncButton } from './SyncButton';

const NAV_ITEMS = [
  { page: 'dashboard', label: 'Dashboard', hash: '#/' },
  { page: 'documents', label: 'Documents', hash: '#/documents' },
  { page: 'search', label: 'Search', hash: '#/search' },
  { page: 'sources', label: 'Sources', hash: '#/sources' },
];

interface LayoutProps {
  currentPage: string;
  onLogout: () => void;
  api: AdminApi;
  children: React.ReactNode;
}

export function Layout({ currentPage, onLogout, api, children }: LayoutProps) {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">RunbookAI</h2>
          <span className="sidebar-subtitle">Admin</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.page}
              href={item.hash}
              className={`nav-link ${currentPage === item.page || currentPage.startsWith(item.page.replace('s', '')) ? 'active' : ''}`}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <SyncButton api={api} />
          <button
            className="btn btn-ghost"
            onClick={onLogout}
            style={{ width: '100%', marginTop: '8px' }}
          >
            Sign Out
          </button>
        </div>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
