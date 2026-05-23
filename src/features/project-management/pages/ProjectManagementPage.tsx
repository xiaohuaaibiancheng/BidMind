import { useEffect, useMemo, useRef, useState } from 'react';
import { workspaceStorage } from '../../../shared/storage/workspaceStorage';
import { useToast } from '../../../shared/ui';
import type { ManagedProject, ProjectStatus, ProjectWorkbenchType, ProjectWorkspaceState } from '../types';

const PROJECT_SUMMARY_COLLAPSED_KEY = 'bidmind:project-management:summary-collapsed:v1';
const PROJECT_LIST_PAGE_SIZE = 24;

const statusMeta: Record<ProjectStatus, { label: string; desc: string; empty: string }> = {
  'in-progress': {
    label: '进行中',
    desc: '正在编制和协同的项目',
    empty: '暂无进行中的项目',
  },
  completed: {
    label: '已完成',
    desc: '已完成交付或归档的项目',
    empty: '暂无已完成项目',
  },
  deleted: {
    label: '已删除',
    desc: '回收站中的项目，可恢复或彻底清理',
    empty: '回收站为空',
  },
};

const workbenchMeta: Record<ProjectWorkbenchType, { label: string; sectionLabel: string }> = {
  'technical-plan': { label: '技术方案项目', sectionLabel: '技术方案' },
  'business-bid': { label: '商务标项目', sectionLabel: '商务标' },
};

interface ProjectManagementPageProps {
  activeProjectId: string;
  onOpenProject: (projectId: string, section: ProjectWorkbenchType) => void;
}

const seedProjects: ManagedProject[] = [
  {
    id: 'proj-seed-001',
    name: '智慧园区综合运维服务项目',
    code: 'YM-2026-001',
    owner: '技术一组',
    workbench: 'technical-plan',
    status: 'in-progress',
    created_at: '2026-05-08T10:00:00.000Z',
    updated_at: '2026-05-22T09:30:00.000Z',
  },
  {
    id: 'proj-seed-002',
    name: '产业园设备采购项目商务响应',
    code: 'YM-2026-004',
    owner: '商务组',
    workbench: 'business-bid',
    status: 'in-progress',
    created_at: '2026-05-11T08:20:00.000Z',
    updated_at: '2026-05-21T16:20:00.000Z',
  },
  {
    id: 'proj-seed-003',
    name: '医院后勤信息化建设项目',
    code: 'YM-2026-006',
    owner: '医疗行业组',
    workbench: 'technical-plan',
    status: 'completed',
    created_at: '2026-04-18T07:10:00.000Z',
    updated_at: '2026-05-17T10:15:00.000Z',
  },
  {
    id: 'proj-seed-004',
    name: '轨道交通站点智慧安防商务标',
    code: 'YM-2026-002',
    owner: '交通行业组',
    workbench: 'business-bid',
    status: 'deleted',
    created_at: '2026-04-01T11:00:00.000Z',
    updated_at: '2026-05-14T02:40:00.000Z',
  },
];

function normalizeState(state: unknown): ProjectWorkspaceState {
  const projects = (state as ProjectWorkspaceState | null)?.projects;
  if (!Array.isArray(projects)) {
    return { projects: [] };
  }

  return {
    projects: projects
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string')
      .map((item) => {
        const status = item.status === 'completed' || item.status === 'deleted' ? item.status : 'in-progress';
        const workbench = item.workbench === 'business-bid' ? 'business-bid' : 'technical-plan';
        return {
          id: item.id,
          name: item.name,
          code: item.code || '',
          owner: item.owner || '',
          workbench,
          status,
          created_at: item.created_at || item.updated_at || new Date().toISOString(),
          updated_at: item.updated_at || item.created_at || new Date().toISOString(),
        } satisfies ManagedProject;
      }),
  };
}

function formatDateText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未知时间';
  }
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createProject(name: string, code: string, workbench: ProjectWorkbenchType): ManagedProject {
  const now = new Date().toISOString();
  return {
    id: `proj-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    name,
    code,
    owner: '',
    workbench,
    status: 'in-progress',
    created_at: now,
    updated_at: now,
  };
}

function loadSummaryCollapsedPreference() {
  try {
    return localStorage.getItem(PROJECT_SUMMARY_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function ProjectManagementPage({ activeProjectId, onOpenProject }: ProjectManagementPageProps) {
  const { showToast } = useToast();
  const hydratedRef = useRef(false);
  const lastSyncedProjectIdRef = useRef('');
  const projectListRef = useRef<HTMLDivElement | null>(null);
  const projectListLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const [workspace, setWorkspace] = useState<ProjectWorkspaceState>({ projects: [] });
  const [activeStatus, setActiveStatus] = useState<ProjectStatus>('in-progress');
  const [summaryCollapsed, setSummaryCollapsed] = useState(loadSummaryCollapsedPreference);
  const [projectName, setProjectName] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [projectWorkbench, setProjectWorkbench] = useState<ProjectWorkbenchType>('technical-plan');
  const [keyword, setKeyword] = useState('');
  const [visibleProjectCount, setVisibleProjectCount] = useState(PROJECT_LIST_PAGE_SIZE);

  useEffect(() => {
    let canceled = false;

    void window.bidmind?.workspace.loadProjects()
      .then((state) => {
        if (canceled) return;
        const normalized = normalizeState(state);
        if (normalized.projects.length > 0) {
          setWorkspace(normalized);
        } else {
          setWorkspace({ projects: seedProjects });
        }
        hydratedRef.current = true;
      })
      .catch((error) => {
        if (canceled) return;
        setWorkspace({ projects: seedProjects });
        hydratedRef.current = true;
        showToast(error instanceof Error ? error.message : '读取项目数据失败', 'error');
      });

    return () => {
      canceled = true;
    };
  }, [showToast]);

  const persistWorkspace = async (nextWorkspace: ProjectWorkspaceState, fallbackMessage = '保存项目数据失败') => {
    setWorkspace(nextWorkspace);
    if (!hydratedRef.current) {
      return false;
    }
    try {
      await window.bidmind?.workspace.saveProjects(nextWorkspace);
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : fallbackMessage, 'error');
      return false;
    }
  };

  useEffect(() => {
    try {
      localStorage.setItem(PROJECT_SUMMARY_COLLAPSED_KEY, summaryCollapsed ? '1' : '0');
    } catch {
      // 忽略本地存储不可用场景，保持页面功能可用
    }
  }, [summaryCollapsed]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (lastSyncedProjectIdRef.current === activeProjectId) return;
    const current = workspace.projects.find((item) => item.id === activeProjectId);
    if (current) {
      setActiveStatus(current.status);
      lastSyncedProjectIdRef.current = activeProjectId;
    }
  }, [activeProjectId, workspace.projects]);

  useEffect(() => {
    setVisibleProjectCount(PROJECT_LIST_PAGE_SIZE);
  }, [activeStatus, keyword, workspace.projects.length]);

  const statusCounts = useMemo(() => {
    const counts: Record<ProjectStatus, number> = {
      'in-progress': 0,
      completed: 0,
      deleted: 0,
    };

    workspace.projects.forEach((item) => {
      counts[item.status] += 1;
    });

    return counts;
  }, [workspace.projects]);

  const filteredProjects = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    const list = workspace.projects.filter((item) => item.status === activeStatus);
    if (!search) {
      return list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }
    return list
      .filter((item) => [item.name, item.code, item.owner].join(' ').toLowerCase().includes(search))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [activeStatus, keyword, workspace.projects]);
  const visibleProjects = useMemo(
    () => filteredProjects.slice(0, visibleProjectCount),
    [filteredProjects, visibleProjectCount]
  );
  const hasMoreProjects = visibleProjectCount < filteredProjects.length;

  useEffect(() => {
    if (!hasMoreProjects) return;
    const root = projectListRef.current;
    const target = projectListLoadMoreRef.current;
    if (!root || !target) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleProjectCount((prev) => Math.min(prev + PROJECT_LIST_PAGE_SIZE, filteredProjects.length));
      }
    }, {
      root,
      rootMargin: '120px 0px 220px 0px',
      threshold: 0.01,
    });

    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredProjects.length, hasMoreProjects]);

  const updateProjectStatus = async (projectId: string, nextStatus: ProjectStatus, message: string) => {
    const nextWorkspace: ProjectWorkspaceState = {
      projects: workspace.projects.map((item) => (item.id === projectId
        ? { ...item, status: nextStatus, updated_at: new Date().toISOString() }
        : item)),
    };
    const ok = await persistWorkspace(nextWorkspace);
    if (ok) {
      showToast(message, 'success');
    }
  };

  const removeProject = async (projectId: string) => {
    const currentActiveProjectId = workspaceStorage.load()?.activeProjectId || '';
    const nextWorkspace: ProjectWorkspaceState = {
      projects: workspace.projects.filter((item) => item.id !== projectId),
    };
    const ok = await persistWorkspace(nextWorkspace);
    if (!ok) {
      return;
    }

    if (currentActiveProjectId && currentActiveProjectId === projectId) {
      workspaceStorage.save({ activeProjectId: '' });
    }

    showToast('项目已彻底删除', 'success');
  };

  const handleCreateProject = async (workbench: ProjectWorkbenchType, autoEnter = false) => {
    const name = projectName.trim();
    const code = projectCode.trim();
    if (!name) {
      showToast('请输入项目名称', 'error');
      return;
    }

    const createdProject = createProject(name, code, workbench);
    const nextWorkspace: ProjectWorkspaceState = {
      projects: [createdProject, ...workspace.projects],
    };
    const ok = await persistWorkspace(nextWorkspace);
    if (!ok) {
      return;
    }
    setProjectName('');
    setProjectCode('');
    setProjectWorkbench(workbench);
    setActiveStatus('in-progress');

    if (autoEnter) {
      workspaceStorage.save({
        activeProjectId: createdProject.id,
        activeSection: workbench,
      });
      onOpenProject(createdProject.id, workbench);
      return;
    }

    showToast(`${workbenchMeta[workbench].label}已创建`, 'success');
  };

  const enterProject = (project: ManagedProject) => {
    if (project.status === 'deleted') {
      showToast('回收站项目请先恢复后再进入', 'info');
      return;
    }

    workspaceStorage.save({
      activeProjectId: project.id,
      activeSection: project.workbench,
    });
    onOpenProject(project.id, project.workbench);
  };

  return (
    <div className="project-management-page">
      <section className={`project-management-summary${summaryCollapsed ? ' is-collapsed' : ''}`}>
        <button
          type="button"
          className="project-management-summary-toggle"
          onClick={() => setSummaryCollapsed((prev) => !prev)}
          aria-expanded={!summaryCollapsed}
        >
          <span className="section-kicker">项目管理</span>
          <strong>项目摘要</strong>
          <em>{summaryCollapsed ? '展开' : '折叠'}</em>
        </button>
        {!summaryCollapsed && (
          <div className="project-management-summary-body">
            <p>项目入口统一管理技术方案和商务标，先创建项目，再到下方历史项目区持续推进。</p>
            <div className="project-management-metrics" aria-label="项目统计">
              {(Object.keys(statusMeta) as ProjectStatus[]).map((status) => (
                <article key={status}>
                  <span>{statusMeta[status].label}</span>
                  <strong>{statusCounts[status]}</strong>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="project-create-panel">
        <div className="project-create-card">
          <h3>创建新项目</h3>
          <label className="project-create-name-field">
            项目名称
            <input
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="例如：某某项目技术标"
            />
          </label>
          <label className="project-create-code-field">
            项目编号（可选）
            <input
              type="text"
              value={projectCode}
              onChange={(event) => setProjectCode(event.target.value)}
              placeholder="例如：YM-2026-008"
            />
          </label>
          <div className="project-workbench-selector" role="radiogroup" aria-label="项目类型">
            <button
              type="button"
              role="radio"
              aria-checked={projectWorkbench === 'technical-plan'}
              className={`workbench-chip ${projectWorkbench === 'technical-plan' ? 'is-active' : ''}`}
              onClick={() => setProjectWorkbench('technical-plan')}
            >
              技术方案
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={projectWorkbench === 'business-bid'}
              className={`workbench-chip ${projectWorkbench === 'business-bid' ? 'is-active' : ''}`}
              onClick={() => setProjectWorkbench('business-bid')}
            >
              商务标
            </button>
          </div>
          <div className="project-create-actions">
            <button type="button" className="secondary-action" onClick={() => void handleCreateProject(projectWorkbench)}>仅创建</button>
            <button type="button" className="primary-action" onClick={() => void handleCreateProject(projectWorkbench, true)}>创建并进入</button>
          </div>
        </div>
      </section>

      <section className="project-management-board">
        <header className="project-board-head">
          <div className="project-status-tabs" role="tablist" aria-label="项目状态">
            {(Object.keys(statusMeta) as ProjectStatus[]).map((status) => {
              const active = activeStatus === status;
              return (
                <button
                  key={status}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`project-status-tab ${active ? 'is-active' : ''}`}
                  onClick={() => setActiveStatus(status)}
                >
                  <span>{statusMeta[status].label}</span>
                  <strong>{statusCounts[status]}</strong>
                </button>
              );
            })}
          </div>
          <input
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="project-search-input"
            placeholder="按项目名称 / 编号搜索"
          />
        </header>

        {filteredProjects.length ? (
          <div className="project-card-list" ref={projectListRef}>
            {visibleProjects.map((project) => {
              const isCurrentProject = activeProjectId && activeProjectId === project.id;
              return (
                <article className={`project-card ${isCurrentProject ? 'is-current' : ''}`} key={project.id}>
                  <div className="project-card-main">
                    <div>
                      <h3>{project.name}</h3>
                      <p>
                        {project.code ? `项目编号：${project.code}` : '未设置项目编号'}
                        {project.owner ? ` · 负责人：${project.owner}` : ''}
                      </p>
                    </div>
                    <div className="project-card-meta">
                      <span className="project-workbench-pill">{workbenchMeta[project.workbench].label}</span>
                      <span className={`project-status-pill is-${project.status}`}>
                        {statusMeta[project.status].label}
                      </span>
                    </div>
                  </div>

                  <footer className="project-card-footer">
                    <small>最近更新：{formatDateText(project.updated_at)}</small>
                    <div className="project-card-actions">
                      {project.status !== 'deleted' ? (
                        <button type="button" className="primary-action" onClick={() => enterProject(project)}>
                          进入{workbenchMeta[project.workbench].sectionLabel}
                        </button>
                      ) : null}

                      {project.status === 'in-progress' ? (
                        <>
                          <button type="button" className="secondary-action" onClick={() => void updateProjectStatus(project.id, 'completed', '项目已标记为完成')}>标记完成</button>
                          <button type="button" className="danger-action" onClick={() => void updateProjectStatus(project.id, 'deleted', '项目已移至回收站')}>移至回收站</button>
                        </>
                      ) : null}

                      {project.status === 'completed' ? (
                        <>
                          <button type="button" className="secondary-action" onClick={() => void updateProjectStatus(project.id, 'in-progress', '项目已恢复为进行中')}>重新打开</button>
                          <button type="button" className="danger-action" onClick={() => void updateProjectStatus(project.id, 'deleted', '项目已移至回收站')}>移至回收站</button>
                        </>
                      ) : null}

                      {project.status === 'deleted' ? (
                        <>
                          <button type="button" className="secondary-action" onClick={() => void updateProjectStatus(project.id, 'in-progress', '项目已从回收站恢复')}>恢复项目</button>
                          <button type="button" className="danger-action" onClick={() => void removeProject(project.id)}>彻底删除</button>
                        </>
                      ) : null}
                    </div>
                  </footer>
                </article>
              );
            })}
            {hasMoreProjects && (
              <div className="project-list-load-more" ref={projectListLoadMoreRef}>
                <span>正在加载更多项目...</span>
                <button
                  type="button"
                  onClick={() => setVisibleProjectCount((prev) => Math.min(prev + PROJECT_LIST_PAGE_SIZE, filteredProjects.length))}
                >
                  手动加载更多
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="project-empty-state">
            <strong>{statusMeta[activeStatus].empty}</strong>
            <p>你可以新建项目，或从其他状态切换过来继续管理。</p>
          </div>
        )}
      </section>
    </div>
  );
}

export default ProjectManagementPage;
