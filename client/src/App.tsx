import { useEffect, useState } from 'react';
import { DiagnosticsPage } from './DiagnosticsPage';
import { HistoryPage } from './comparison/HistoryPage';
import { RunDetailPage } from './comparison/RunDetailPage';
import { CapturedJobInbox } from './inbox/CapturedJobInbox';
import { ProviderSettings } from './providers/ProviderSettings';
import { ResumeLibrary } from './resumes/ResumeLibrary';
import { DATA_DELETED_EVENT, DataControls } from './settings/DataControls';

type PageId = 'dashboard' | 'resumes' | 'inbox' | 'history' | 'settings' | 'diagnostics';

const navigation: { id: PageId; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Overview', icon: 'O' },
  { id: 'resumes', label: 'Resume library', icon: 'R' },
  { id: 'inbox', label: 'Captured jobs', icon: 'J' },
  { id: 'history', label: 'Comparisons', icon: 'C' },
  { id: 'settings', label: 'Settings', icon: 'S' },
  { id: 'diagnostics', label: 'About & diagnostics', icon: 'D' },
];

const pageTitles: Record<PageId, string> = {
  dashboard: 'Overview',
  resumes: 'Resume library',
  inbox: 'Captured jobs',
  history: 'Comparisons',
  settings: 'Settings',
  diagnostics: 'About & diagnostics',
};

interface Route {
  page: PageId;
  /** Set for `#history/<runId>`. */
  runId?: string;
}

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Reads `#page` or `#history/<runId>`; anything unrecognised falls back safely. */
export function parseRoute(hash: string): Route {
  const [head = '', id = ''] = hash.replace(/^#/, '').split('/');
  const page = navigation.find((item) => item.id === head)?.id ?? 'dashboard';
  return page === 'history' && RUN_ID_PATTERN.test(id) ? { page, runId: id } : { page };
}

function routeFromHash(): Route {
  return parseRoute(window.location.hash);
}

function BrandMark({ className = '' }: { className?: string }) {
  return (
    <img
      className={`brand-mark ${className}`}
      src="/talentfly-mark.svg"
      alt=""
      aria-hidden="true"
    />
  );
}

function Dashboard({
  onNavigate,
  resumeCount,
}: {
  onNavigate: (page: PageId) => void;
  resumeCount: number | null;
}) {
  return (
    <>
      <section className="welcome-panel">
        <div className="welcome-copy">
          <p className="eyebrow">YOUR CAREER WORKSPACE</p>
          <h2>Make every application more intentional.</h2>
          <p>
            Keep your resumes close. When you find a role worth pursuing, see how your
            experience lines up.
          </p>
          <button className="button button-primary" onClick={() => onNavigate('resumes')}>
            Set up your resume library <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <BrandMark className="welcome-mark" />
          <span className="art-orbit orbit-one" />
          <span className="art-orbit orbit-two" />
          <span className="art-spark spark-one">✦</span>
          <span className="art-spark spark-two">✦</span>
        </div>
      </section>

      <section className="stat-grid" aria-label="Workspace summary">
        <article className="summary-card">
          <span className="summary-icon resume-icon" aria-hidden="true">
            R
          </span>
          <p className="summary-label">Resumes saved</p>
          <p className="summary-value">{resumeCount ?? '—'}</p>
          <button className="text-button" onClick={() => onNavigate('resumes')}>
            Open library <span aria-hidden="true">→</span>
          </button>
        </article>
        <article className="summary-card">
          <span className="summary-icon comparison-icon" aria-hidden="true">
            C
          </span>
          <p className="summary-label">Comparisons</p>
          <p className="summary-value">—</p>
          <button className="text-button" onClick={() => onNavigate('history')}>
            View history <span aria-hidden="true">→</span>
          </button>
        </article>
        <article className="summary-card privacy-card">
          <span className="privacy-indicator" aria-hidden="true" />
          <p className="summary-label">Your data stays yours</p>
          <p className="privacy-copy">
            Your resumes and reports stay in this browser. You choose what to share with an
            AI provider.
          </p>
          <button className="text-button" onClick={() => onNavigate('settings')}>
            Review settings <span aria-hidden="true">→</span>
          </button>
        </article>
      </section>

      <section className="activity-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR WORK</p>
            <h2>Recent comparisons</h2>
          </div>
          <button className="text-button" onClick={() => onNavigate('history')}>
            View all <span aria-hidden="true">→</span>
          </button>
        </div>
        <div className="activity-empty">
          <span className="activity-empty-icon" aria-hidden="true">
            ✦
          </span>
          <p>No comparisons yet</p>
          <span>Your future role-fit reports will show up here.</span>
        </div>
      </section>
    </>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const page = route.page;
  const [settingsKey, setSettingsKey] = useState(0);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [pwaError, setPwaError] = useState<string | null>(null);
  const [resumeCount, setResumeCount] = useState<number | null>(null);

  const navigateTo = (nextPage: PageId) => {
    if (window.location.hash !== `#${nextPage}`) {
      window.history.pushState(null, '', `#${nextPage}`);
    }
    setRoute({ page: nextPage });
  };

  useEffect(() => {
    const syncPage = () => setRoute(routeFromHash());
    const dataDeleted = () => {
      setResumeCount(0);
      setSettingsKey((key) => key + 1);
    };
    const showUpdate = () => setUpdateAvailable(true);
    const showOfflineReady = () => setOfflineReady(true);
    const showPwaError = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : null;
      setPwaError(typeof detail === 'string' ? detail : 'Offline support could not be enabled.');
    };

    window.addEventListener('hashchange', syncPage);
    window.addEventListener('popstate', syncPage);
    window.addEventListener(DATA_DELETED_EVENT, dataDeleted);
    window.addEventListener('talentfly:update-available', showUpdate);
    window.addEventListener('talentfly:offline-ready', showOfflineReady);
    window.addEventListener('talentfly:pwa-error', showPwaError);

    return () => {
      window.removeEventListener('hashchange', syncPage);
      window.removeEventListener('popstate', syncPage);
      window.removeEventListener(DATA_DELETED_EVENT, dataDeleted);
      window.removeEventListener('talentfly:update-available', showUpdate);
      window.removeEventListener('talentfly:offline-ready', showOfflineReady);
      window.removeEventListener('talentfly:pwa-error', showPwaError);
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand-lockup" href="#dashboard" aria-label="TalentFly home">
          <BrandMark />
          <span className="brand-name">Talent<span>Fly</span></span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map((item) => (
            <a
              className={`nav-link${page === item.id ? ' nav-link-active' : ''}`}
              href={`#${item.id}`}
              key={item.id}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigateTo(item.id);
              }}
            >
              <span className={`nav-icon nav-icon-${item.id}`} aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
              {item.id === 'resumes' && <span className="nav-count">{resumeCount ?? '—'}</span>}
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="status-dot" />
            <div>
              <strong>Private by design</strong>
              <span>Stored on this device</span>
            </div>
          </div>
          <div className="sidebar-footer">
            <BrandMark className="footer-mark" />
            <span>Thoughtful moves, made yours.</span>
          </div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <strong>{route.runId ? 'Comparison report' : pageTitles[page]}</strong>
          </div>
          <div className="topbar-right">
            {offlineReady && (
              <span className="offline-badge">
                <span className="status-dot" />
                Ready offline
              </span>
            )}
            <span className="device-badge">
              <span className="device-dot" />
              Local workspace
            </span>
            <div className="avatar" aria-label="Guest workspace">
              G
            </div>
          </div>
        </header>

        <main className="page-content">
          {updateAvailable && (
            <div className="update-banner" role="status">
              <span>A new version of TalentFly is ready.</span>
              <button
                className="text-button"
                onClick={() => window.dispatchEvent(new Event('talentfly:apply-update'))}
              >
                Update now
              </button>
              <button
                className="icon-button"
                aria-label="Dismiss update notice"
                onClick={() => setUpdateAvailable(false)}
              >
                ×
              </button>
            </div>
          )}
          {pwaError && (
            <div className="offline-error" role="alert">
              <span>{pwaError}</span>
              <button
                className="icon-button"
                aria-label="Dismiss offline warning"
                onClick={() => setPwaError(null)}
              >
                ×
              </button>
            </div>
          )}

          <div className="page-title-row">
            <div>
              <p className="eyebrow">TALENTFLY WORKSPACE</p>
              <h1>{route.runId ? 'Comparison report' : pageTitles[page]}</h1>
            </div>
            <span className="local-only-label">
              <span className="status-dot" />
              Your workspace is local
            </span>
          </div>

          {page === 'dashboard' && (
            <Dashboard onNavigate={navigateTo} resumeCount={resumeCount} />
          )}
          {page === 'resumes' && <ResumeLibrary onCountChange={setResumeCount} />}
          {page === 'inbox' && (
            <CapturedJobInbox extensionId={import.meta.env.VITE_TALENTFLY_EXTENSION_ID ?? ''} />
          )}
          {page === 'history' &&
            (route.runId ? (
              <RunDetailPage runId={route.runId} key={route.runId} />
            ) : (
              <HistoryPage />
            ))}
          {page === 'settings' && (
            <>
              <ProviderSettings key={settingsKey} />
              <DataControls />
            </>
          )}
          {page === 'diagnostics' && <DiagnosticsPage />}
        </main>
      </div>
    </div>
  );
}
