import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';
import type { SectionId } from '../shared/types/navigation';
import Sidebar from './Sidebar';
import type { UserProfile } from '../features/user-center/types';

interface AppShellProps {
  activeSection: SectionId;
  currentUser: UserProfile;
  children: ReactNode;
  developerMode: boolean;
  onSectionChange: (section: SectionId) => void;
}

function AppShell({
  activeSection,
  currentUser,
  children,
  developerMode,
  onSectionChange,
}: AppShellProps) {
  return (
    <Tooltip.Provider delayDuration={120} skipDelayDuration={80}>
      <div className="app-shell">
        <Sidebar
          activeSection={activeSection}
          developerMode={developerMode}
          currentUser={currentUser}
          onSectionChange={onSectionChange}
        />

        <main className="main-area">
          <section className="content-shell" aria-label="主内容">
            {children}
          </section>
        </main>
      </div>
    </Tooltip.Provider>
  );
}

export default AppShell;
