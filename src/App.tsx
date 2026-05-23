import { useEffect, useState } from 'react';
import AppRouter from './app/AppRouter';
import UpdateNotifier from './app/UpdateNotifier';
import AppShell from './components/AppShell';
import { trackAppOpen, trackConfigUsage, trackPageView } from './shared/analytics/analytics';
import type { SectionId } from './shared/types/navigation';
import { workspaceStorage } from './shared/storage/workspaceStorage';
import AuthPage from './features/user-center/pages/AuthPage';
import type { UserProfile } from './features/user-center/types';

const defaultSection: SectionId = 'project-management';
const USER_TOKEN_KEY = 'bidmind:web:user-token';

function isSectionId(value: string | undefined): value is SectionId {
  return value === 'project-management'
    || value === 'technical-plan'
    || value === 'business-bid'
    || value === 'knowledge-base'
    || value === 'duplicate-check'
    || value === 'rejection-check'
    || value === 'bid-opportunity'
    || value === 'user-center'
    || value === 'developer-test'
    || value === 'settings';
}

function App() {
  const [activeSection, setActiveSection] = useState<SectionId>(() => {
    const saved = workspaceStorage.load()?.activeSection;
    return isSectionId(saved) ? saved : defaultSection;
  });
  const [activeProjectId, setActiveProjectId] = useState(() => workspaceStorage.load()?.activeProjectId || '');
  const [developerMode, setDeveloperMode] = useState(false);
  const [userToken, setUserToken] = useState(() => localStorage.getItem(USER_TOKEN_KEY) || '');
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authHydrated, setAuthHydrated] = useState(false);

  useEffect(() => {
    trackAppOpen();

    void window.bidmind?.config.load()
      .then((config) => {
        setDeveloperMode(Boolean(config?.developer_mode));
        trackConfigUsage({}, config);
      })
      .catch((error) => console.warn('读取开发者模式失败', error));
  }, []);

  useEffect(() => {
    let canceled = false;
    if (!userToken) {
      setCurrentUser(null);
      setAuthHydrated(true);
      return () => {
        canceled = true;
      };
    }

    void window.bidmind?.user.me(userToken)
      .then((result) => {
        if (canceled) return;
        if (result?.user) {
          setCurrentUser(result.user);
        } else {
          localStorage.removeItem(USER_TOKEN_KEY);
          setUserToken('');
          setCurrentUser(null);
        }
      })
      .catch(() => {
        if (canceled) return;
        localStorage.removeItem(USER_TOKEN_KEY);
        setUserToken('');
        setCurrentUser(null);
      })
      .finally(() => {
        if (!canceled) {
          setAuthHydrated(true);
        }
      });

    return () => {
      canceled = true;
    };
  }, [userToken]);

  useEffect(() => {
    trackPageView(activeSection);
  }, [activeSection]);

  useEffect(() => {
    return workspaceStorage.subscribe((state) => {
      const nextProjectId = String(state.activeProjectId || '');
      if (nextProjectId !== activeProjectId) {
        setActiveProjectId(nextProjectId);
      }
      if (isSectionId(state.activeSection) && state.activeSection !== activeSection) {
        setActiveSection(state.activeSection);
      }
    });
  }, [activeProjectId, activeSection]);

  useEffect(() => {
    if (!developerMode && activeSection === 'developer-test') {
      setActiveSection(defaultSection);
      workspaceStorage.save({ activeSection: defaultSection });
    }
  }, [activeSection, developerMode]);

  const handleSectionChange = (section: SectionId) => {
    setActiveSection(section);
    workspaceStorage.save({ activeSection: section });
  };

  const handleOpenProject = (projectId: string, section: 'technical-plan' | 'business-bid') => {
    setActiveProjectId(projectId);
    setActiveSection(section);
    workspaceStorage.save({
      activeProjectId: projectId,
      activeSection: section,
    });
  };

  const handleAuthSuccess = ({ token, user }: { token: string; user: UserProfile }) => {
    localStorage.setItem(USER_TOKEN_KEY, token);
    setUserToken(token);
    setCurrentUser(user);
    if (activeSection === 'settings' || activeSection === 'developer-test') {
      setActiveSection(defaultSection);
      workspaceStorage.save({ activeSection: defaultSection });
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(USER_TOKEN_KEY);
    setUserToken('');
    setCurrentUser(null);
    setActiveSection(defaultSection);
    workspaceStorage.save({ activeSection: defaultSection });
  };

  if (!authHydrated) {
    return (
      <div className="app-loading-mask">
        <span>正在初始化账号信息...</span>
      </div>
    );
  }

  if (!currentUser || !userToken) {
    return (
      <AuthPage onAuthSuccess={handleAuthSuccess} />
    );
  }

  return (
    <>
      <UpdateNotifier />
      <AppShell
        activeSection={activeSection}
        currentUser={currentUser}
        developerMode={developerMode}
        onSectionChange={handleSectionChange}
      >
        <AppRouter
          activeSection={activeSection}
          activeProjectId={activeProjectId}
          onOpenProject={handleOpenProject}
          onDeveloperModeChange={setDeveloperMode}
          user={currentUser}
          userToken={userToken}
          onUserChange={setCurrentUser}
          onLogout={handleLogout}
        />
      </AppShell>
    </>
  );
}

export default App;
