import type { SectionId } from '../shared/types/navigation';
import BidOpportunityPage from '../features/bid-opportunity/pages/BidOpportunityPage';
import BusinessBidPage from '../features/business-bid/pages/BusinessBidPage';
import DeveloperTestPage from '../features/developer/pages/DeveloperTestPage';
import DuplicateCheckPage from '../features/duplicate-check/pages/DuplicateCheckPage';
import KnowledgeBasePage from '../features/knowledge-base/pages/KnowledgeBasePage';
import ProjectManagementPage from '../features/project-management/pages/ProjectManagementPage';
import RejectionCheckPage from '../features/rejection-check/pages/RejectionCheckPage';
import SettingsPage from '../features/settings/pages/SettingsPage';
import TechnicalPlanHome from '../features/technical-plan/pages/TechnicalPlanHome';
import UserCenterPage from '../features/user-center/pages/UserCenterPage';
import type { UserProfile } from '../features/user-center/types';

interface AppRouterProps {
  activeSection: SectionId;
  onDeveloperModeChange: (developerMode: boolean) => void;
  activeProjectId: string;
  onOpenProject: (projectId: string, section: 'technical-plan' | 'business-bid') => void;
  user: UserProfile | null;
  userToken: string;
  onUserChange: (user: UserProfile) => void;
  onLogout: () => void;
}

function AppRouter({
  activeSection,
  onDeveloperModeChange,
  activeProjectId,
  onOpenProject,
  user,
  userToken,
  onUserChange,
  onLogout,
}: AppRouterProps) {
  switch (activeSection) {
    case 'project-management':
      return <ProjectManagementPage activeProjectId={activeProjectId} onOpenProject={onOpenProject} />;
    case 'technical-plan':
      return <TechnicalPlanHome />;
    case 'business-bid':
      return <BusinessBidPage />;
    case 'knowledge-base':
      return <KnowledgeBasePage />;
    case 'duplicate-check':
      return <DuplicateCheckPage />;
    case 'rejection-check':
      return <RejectionCheckPage />;
    case 'bid-opportunity':
      return <BidOpportunityPage />;
    case 'user-center':
      return user ? <UserCenterPage user={user} token={userToken} onUserChange={onUserChange} onLogout={onLogout} /> : null;
    case 'developer-test':
      return <DeveloperTestPage />;
    case 'settings':
      return <SettingsPage onDeveloperModeChange={onDeveloperModeChange} />;
    default:
      return null;
  }
}

export default AppRouter;
