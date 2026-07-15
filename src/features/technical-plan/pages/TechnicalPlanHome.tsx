import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import DocumentAnalysisPage from './DocumentAnalysisPage';
import BidAnalysisPage from './BidAnalysisPage';
import OutlineEditPage from './OutlineEditPage';
import ContentEditPage from './ContentEditPage';
import { useTechnicalPlanWorkflow } from '../hooks/useTechnicalPlanWorkflow';
import { trackPageView } from '../../../shared/analytics/analytics';
import { FloatingToolbar, ToolbarArrowLeftIcon, ToolbarArrowRightIcon, ToolbarDocumentIcon, useToast } from '../../../shared/ui';
import type { BackgroundTaskState, ContentGenerationOptions, ExportStyleOptions, ExportNumberingFormat, TechnicalPlanStep } from '../types';
import type { OutlineData, OutlineItem, WordExportProgressEvent } from '../../../shared/types';
import { workspaceStorage } from '../../../shared/storage/workspaceStorage';

const steps: TechnicalPlanStep[] = [
  'document-analysis',
  'bid-analysis',
  'outline-generation',
  'content-edit',
  'expand',
];

const stepLabels: Record<TechnicalPlanStep, string> = {
  'document-analysis': '上传招标文件',
  'bid-analysis': '招标文件解析',
  'outline-generation': '目录生成',
  'content-edit': '生成正文',
  expand: '扩写改写',
};

const stepDescriptions: Record<TechnicalPlanStep, string> = {
  'document-analysis': '上传并预览招标文件原文，确认解析内容完整。',
  'bid-analysis': '提取项目概述与技术要求，形成后续生成依据。',
  'outline-generation': '生成可编辑的大纲结构，准备正文编写。',
  'content-edit': '按大纲分章节生成正文、图表与说明。',
  expand: '对已生成章节进行扩写、改写和润色。',
};

const exportStylePresets: Record<'official' | 'compact' | 'academic', ExportStyleOptions> = {
  official: {
    presetId: 'official',
    titleFont: '宋体',
    titleSize: 22,
    headingFont: '黑体',
    headingSize: 16,
    bodyFont: '宋体',
    bodySize: 12,
    lineSpacing: 1.5,
    numberingFormat: 'decimal',
  },
  compact: {
    presetId: 'compact',
    titleFont: '微软雅黑',
    titleSize: 20,
    headingFont: '微软雅黑',
    headingSize: 15,
    bodyFont: '微软雅黑',
    bodySize: 11,
    lineSpacing: 1.3,
    numberingFormat: 'decimal',
  },
  academic: {
    presetId: 'academic',
    titleFont: '仿宋',
    titleSize: 22,
    headingFont: '楷体',
    headingSize: 16,
    bodyFont: '仿宋',
    bodySize: 12,
    lineSpacing: 1.7,
    numberingFormat: 'upper-roman',
  },
};

const defaultExportStyle = exportStylePresets.official;

const numberingFormatLabels: Record<ExportNumberingFormat, string> = {
  decimal: '阿拉伯数字（1.2.3）',
  'upper-roman': '大写罗马（I.II.III）',
  'lower-letter': '小写字母（a.b.c）',
};
const TECHNICAL_PLAN_FLOW_COLLAPSED_KEY = 'bidmind:technical-plan:flow-collapsed:v1';
const TECHNICAL_RUNNING_OVERLAY_STYLE_KEY = 'bidmind:technical-plan:running-overlay-style:v1';

function loadTechnicalPlanFlowCollapsedPreference() {
  try {
    const stored = localStorage.getItem(TECHNICAL_PLAN_FLOW_COLLAPSED_KEY);
    if (stored === null) {
      return true;
    }
    return stored === '1';
  } catch {
    return true;
  }
}

function loadRunningOverlayStylePreference(): 'frosted' | 'focus' {
  try {
    const stored = localStorage.getItem(TECHNICAL_RUNNING_OVERLAY_STYLE_KEY);
    return stored === 'focus' ? 'focus' : 'frosted';
  } catch {
    return 'frosted';
  }
}

const resetState = {
  step: 'document-analysis' as TechnicalPlanStep,
  fileName: '',
  fileContent: '',
  projectOverview: '',
  techRequirements: '',
  bidAnalysisMode: 'key' as const,
  bidAnalysisTasks: {},
  bidAnalysisProgress: 0,
  outlineMode: 'aligned' as const,
  referenceKnowledgeDocumentIds: [] as string[],
  bidAnalysisTask: undefined,
  outlineGenerationTask: undefined,
  contentGenerationTask: undefined,
  contentGenerationOptions: undefined,
  contentGenerationSections: {},
  contentGenerationPlans: {},
  exportStyleOptions: defaultExportStyle,
  outlineData: null,
};

function collectLeafItems(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap((item) => item.children?.length ? collectLeafItems(item.children) : [item]);
}

function countMermaidDiagrams(content: string) {
  const mermaidBlocks = (String(content || '').match(/```mermaid[\s\S]*?```/gi) || []).length;
  const mermaidInkImages = (String(content || '').match(/https:\/\/mermaid\.ink\/img\//gi) || []).length;
  return mermaidBlocks + mermaidInkImages;
}

function countOutlineMermaidDiagrams(items: OutlineItem[]) {
  return collectLeafItems(items).reduce((sum, item) => sum + countMermaidDiagrams(item.content || ''), 0);
}

interface ExportProgressState {
  open: boolean;
  running: boolean;
  progress: number;
  message: string;
  warnings: string[];
  mermaidCount: number;
  error?: string;
}

const initialExportProgress: ExportProgressState = {
  open: false,
  running: false,
  progress: 0,
  message: '',
  warnings: [],
  mermaidCount: 0,
};

const MAX_UI_TASK_LOGS = 80;

function trimTaskLogs(task?: BackgroundTaskState): BackgroundTaskState | undefined {
  if (!task?.logs || task.logs.length <= MAX_UI_TASK_LOGS) {
    return task;
  }

  return { ...task, logs: task.logs.slice(-MAX_UI_TASK_LOGS) };
}

function clearOutlineContent(items: OutlineItem[]): OutlineItem[] {
  return items.map((item) => {
    const { content: _content, children, ...rest } = item;
    return children?.length ? { ...rest, children: clearOutlineContent(children) } : rest;
  });
}

function updateOutlineItemContent(items: OutlineItem[], itemId: string, content: string): OutlineItem[] {
  return items.map((item) => {
    if (item.id === itemId) {
      return { ...item, content };
    }

    return item.children?.length
      ? { ...item, children: updateOutlineItemContent(item.children, itemId, content) }
      : item;
  });
}

function resetGeneratedContent(outlineData: OutlineData): OutlineData {
  return {
    ...outlineData,
    outline: clearOutlineContent(outlineData.outline),
  };
}

function normalizeExportStyleOptions(value: ExportStyleOptions | undefined): ExportStyleOptions {
  if (!value) return defaultExportStyle;
  const preset = value.presetId === 'official' || value.presetId === 'compact' || value.presetId === 'academic' ? value.presetId : 'custom';
  return {
    presetId: preset,
    titleFont: value.titleFont || defaultExportStyle.titleFont,
    titleSize: Number(value.titleSize) || defaultExportStyle.titleSize,
    headingFont: value.headingFont || defaultExportStyle.headingFont,
    headingSize: Number(value.headingSize) || defaultExportStyle.headingSize,
    bodyFont: value.bodyFont || defaultExportStyle.bodyFont,
    bodySize: Number(value.bodySize) || defaultExportStyle.bodySize,
    lineSpacing: Number(value.lineSpacing) || defaultExportStyle.lineSpacing,
    numberingFormat: value.numberingFormat || defaultExportStyle.numberingFormat,
  };
}

function parseTaskStartedAt(task?: BackgroundTaskState): number | null {
  const parsed = Date.parse(String(task?.started_at || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function TechnicalPlanHome() {
  const { state, setState } = useTechnicalPlanWorkflow();
  const { showToast } = useToast();
  const activeProjectId = workspaceStorage.load()?.activeProjectId || '';
  const [activeProjectName, setActiveProjectName] = useState('');
  const [exportProgress, setExportProgress] = useState<ExportProgressState>(initialExportProgress);
  const [exportSettingsOpen, setExportSettingsOpen] = useState(false);
  const [workflowStageCollapsed, setWorkflowStageCollapsed] = useState(loadTechnicalPlanFlowCollapsedPreference);
  const [documentImportRunning, setDocumentImportRunning] = useState(false);
  const [documentImportStartedAt, setDocumentImportStartedAt] = useState<number | null>(null);
  const [runningOverlayCollapsed, setRunningOverlayCollapsed] = useState(false);
  const [runningOverlayTick, setRunningOverlayTick] = useState(() => Date.now());
  const [runningOverlayStyle, setRunningOverlayStyle] = useState<'frosted' | 'focus'>(loadRunningOverlayStylePreference);
  const exportStyleOptions = normalizeExportStyleOptions(state.exportStyleOptions);
  const activeIndex = steps.indexOf(state.step);
  const bidAnalysisReady = Boolean(state.projectOverview && state.techRequirements && state.bidAnalysisProgress === 100);
  const isContentGenerating = state.contentGenerationTask?.status === 'running';
  const isExporting = exportProgress.running;
  const isNextDisabled = activeIndex >= steps.length - 1
    || (state.step === 'document-analysis' && !state.fileContent)
    || (state.step === 'bid-analysis' && !bidAnalysisReady)
    || (state.step === 'outline-generation' && !state.outlineData);
  const nextTooltip = state.step === 'document-analysis' && !state.fileContent
    ? '上传完招标文件后才能进入下一步'
    : state.step === 'bid-analysis' && !bidAnalysisReady
      ? '招标文件解析完成后才能进入目录生成'
      : state.step === 'outline-generation' && !state.outlineData
        ? '目录生成完成后才能进入正文生成'
          : activeIndex >= steps.length - 1
          ? '当前已经是最后一步'
          : `进入${stepLabels[steps[activeIndex + 1]]}`;

  const runningOverlayInfo = documentImportRunning
    ? {
      key: 'document-import',
      badge: '文件解析',
      title: '正在解析招标文件',
      description: '系统正在读取文件并提取正文结构，请稍候。',
      latestLog: '解析完成后会自动更新到当前页面。',
      startedAt: documentImportStartedAt,
    }
    : state.contentGenerationTask?.status === 'running'
      ? {
        key: 'content-generation',
        badge: '正文生成',
        title: '正在生成正文内容',
        description: 'AI 正在按目录叶子小节并发生成正文与图表。',
        latestLog: trimTaskLogs(state.contentGenerationTask)?.logs?.slice(-1)?.[0] || '正文生成任务正在运行。',
        startedAt: parseTaskStartedAt(state.contentGenerationTask),
      }
      : state.outlineGenerationTask?.status === 'running'
        ? {
          key: 'outline-generation',
          badge: '目录生成',
          title: '正在生成技术方案目录',
          description: 'AI 正在抽取评分点并构建目录结构。',
          latestLog: trimTaskLogs(state.outlineGenerationTask)?.logs?.slice(-1)?.[0] || '目录生成任务正在运行。',
          startedAt: parseTaskStartedAt(state.outlineGenerationTask),
        }
        : state.bidAnalysisTask?.status === 'running'
          ? {
            key: 'bid-analysis',
            badge: '信息解析',
            title: '正在解析招标文件信息',
            description: '系统正在提取项目概述、技术要求与关键信息。',
            latestLog: trimTaskLogs(state.bidAnalysisTask)?.logs?.slice(-1)?.[0] || '招标文件解析任务正在运行。',
            startedAt: parseTaskStartedAt(state.bidAnalysisTask),
          }
          : null;
  const runningOverlayVisible = Boolean(runningOverlayInfo);
  const runningOverlayElapsed = runningOverlayInfo?.startedAt
    ? `已运行 ${formatDuration(Math.max(0, runningOverlayTick - runningOverlayInfo.startedAt))}`
    : '任务运行中';

  useEffect(() => {
    if (documentImportRunning) {
      setDocumentImportStartedAt((prev) => prev ?? Date.now());
      return;
    }
    setDocumentImportStartedAt(null);
  }, [documentImportRunning]);

  useEffect(() => {
    if (!runningOverlayVisible) {
      setRunningOverlayCollapsed(false);
      return;
    }
    setRunningOverlayCollapsed(false);
  }, [runningOverlayInfo?.key, runningOverlayVisible]);

  useEffect(() => {
    if (!runningOverlayVisible || runningOverlayCollapsed) {
      return;
    }
    const timer = window.setInterval(() => {
      setRunningOverlayTick(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [runningOverlayCollapsed, runningOverlayVisible]);

  useEffect(() => {
    try {
      localStorage.setItem(TECHNICAL_PLAN_FLOW_COLLAPSED_KEY, workflowStageCollapsed ? '1' : '0');
    } catch {
      // 忽略本地存储不可用场景
    }
  }, [workflowStageCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(TECHNICAL_RUNNING_OVERLAY_STYLE_KEY, runningOverlayStyle);
    } catch {
      // 忽略本地存储不可用场景
    }
  }, [runningOverlayStyle]);

  const updateExportStyleOptions = (partial: Partial<ExportStyleOptions>) => {
    setState((prev) => ({
      ...prev,
      exportStyleOptions: normalizeExportStyleOptions({
        ...normalizeExportStyleOptions(prev.exportStyleOptions),
        ...partial,
      }),
    }));
  };

  const applyExportStylePreset = (presetId: keyof typeof exportStylePresets) => {
    updateExportStyleOptions({
      ...exportStylePresets[presetId],
      presetId,
    });
  };

  useEffect(() => {
    trackPageView(`technical-plan/${state.step}`);
  }, [state.step]);

  useEffect(() => {
    let canceled = false;
    const activeProjectId = workspaceStorage.load()?.activeProjectId;

    if (!activeProjectId) {
      setActiveProjectName('');
      return () => {
        canceled = true;
      };
    }

    void window.bidmind?.workspace.loadProjects()
      .then((state) => {
        if (canceled) return;
        const project = state?.projects?.find((item) => item.id === activeProjectId);
        setActiveProjectName(project?.name || '');
      })
      .catch(() => {
        if (!canceled) {
          setActiveProjectName('');
        }
      });

    return () => {
      canceled = true;
    };
  }, []);

  const switchStep = (step: TechnicalPlanStep) => {
    setState((prev) => ({ ...prev, step }));
  };

  const goToOffset = (offset: number) => {
    const nextStep = steps[activeIndex + offset];
    if (nextStep) {
      switchStep(nextStep);
    }
  };

  useEffect(() => {
    if (!window.bidmind?.tasks) {
      return;
    }

    const unsubscribe = window.bidmind.tasks.onTaskEvent<typeof state>((event) => {
      const eventProjectId = String(event?.project_id || '').trim();
      if (activeProjectId && eventProjectId && eventProjectId !== activeProjectId) {
        return;
      }

      const taskType = (event.task as { type?: string } | undefined)?.type;
      const latestTask = trimTaskLogs(event.task as BackgroundTaskState | undefined);
      const technicalPlan = event.technicalPlan;

      if (!technicalPlan) {
        return;
      }

      setState((prev) => {
        if (taskType === 'bid-analysis') {
          return {
            ...prev,
            bidAnalysisTask: trimTaskLogs(technicalPlan.bidAnalysisTask) || latestTask,
            bidAnalysisTasks: technicalPlan.bidAnalysisTasks || prev.bidAnalysisTasks,
            bidAnalysisProgress: technicalPlan.bidAnalysisProgress ?? prev.bidAnalysisProgress,
            projectOverview: technicalPlan.projectOverview ?? prev.projectOverview,
            techRequirements: technicalPlan.techRequirements ?? prev.techRequirements,
          };
        }

        if (taskType === 'outline-generation') {
          const nextOutlineData = technicalPlan.outlineGenerationTask?.status === 'success' && technicalPlan.outlineData
            ? resetGeneratedContent(technicalPlan.outlineData)
            : prev.outlineData;

          return {
            ...prev,
            outlineGenerationTask: trimTaskLogs(technicalPlan.outlineGenerationTask) || latestTask,
            outlineMode: technicalPlan.outlineMode ?? prev.outlineMode,
            referenceKnowledgeDocumentIds: Array.isArray(technicalPlan.referenceKnowledgeDocumentIds)
              ? technicalPlan.referenceKnowledgeDocumentIds
              : prev.referenceKnowledgeDocumentIds,
            outlineData: nextOutlineData,
            contentGenerationTask: nextOutlineData !== prev.outlineData ? undefined : prev.contentGenerationTask,
            contentGenerationSections: nextOutlineData !== prev.outlineData ? {} : prev.contentGenerationSections,
            contentGenerationPlans: nextOutlineData !== prev.outlineData ? {} : prev.contentGenerationPlans,
          };
        }

        if (taskType === 'content-generation') {
          const shouldSyncOutlineFromContentTask = prev.step === 'content-edit';
          return {
            ...prev,
            contentGenerationTask: latestTask || trimTaskLogs(technicalPlan.contentGenerationTask),
            outlineMode: technicalPlan.outlineMode ?? prev.outlineMode,
            referenceKnowledgeDocumentIds: Array.isArray(technicalPlan.referenceKnowledgeDocumentIds)
              ? technicalPlan.referenceKnowledgeDocumentIds
              : prev.referenceKnowledgeDocumentIds,
            contentGenerationSections: technicalPlan.contentGenerationSections || prev.contentGenerationSections,
            contentGenerationPlans: technicalPlan.contentGenerationPlans || prev.contentGenerationPlans,
            outlineData: shouldSyncOutlineFromContentTask ? (technicalPlan.outlineData || prev.outlineData) : prev.outlineData,
          };
        }

        return prev;
      });
    });
    window.bidmind.tasks.getActiveTasks().catch((error) => {
      console.warn('获取后台任务状态失败', error);
    });

    return unsubscribe;
  }, [activeProjectId, setState]);

  const exportWord = async () => {
    if (!state.outlineData?.outline?.length) {
      showToast('请先生成目录', 'info');
      return;
    }
    setExportSettingsOpen(false);

    const requestId = `export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const mermaidCount = countOutlineMermaidDiagrams(state.outlineData.outline);
    let unsubscribe: (() => void) | undefined;

    try {
      setExportProgress({
        open: true,
        running: true,
        progress: 2,
        message: mermaidCount
          ? `检测到 ${mermaidCount} 张 Mermaid 图，导出时会转换为 Word 图片，可能需要稍等。`
          : '正在准备导出 Word。',
        warnings: [],
        mermaidCount,
      });

      unsubscribe = window.bidmind?.export.onWordExportProgress((event: WordExportProgressEvent) => {
        if (event.requestId && event.requestId !== requestId) {
          return;
        }

        setExportProgress((prev) => ({
          ...prev,
          open: true,
          running: event.phase === 'running',
          progress: event.progress,
          message: event.message,
          warnings: event.warnings || prev.warnings,
          error: event.phase === 'error' ? event.message : undefined,
        }));
      });

      const result = await window.bidmind?.export.exportWord({
        requestId,
        project_name: state.outlineData.project_name,
        outline: state.outlineData.outline,
        export_style_options: exportStyleOptions,
      });
      if (result?.canceled) {
        setExportProgress(initialExportProgress);
        showToast('已取消导出', 'info');
        return;
      }
      setExportProgress((prev) => ({
        ...prev,
        open: true,
        running: false,
        progress: 100,
        message: result?.message || 'Word 已导出，请打开文档核对图片、表格和版式。',
        warnings: result?.warnings || prev.warnings,
      }));
      showToast(result?.message || 'Word 已导出', result?.warnings?.length ? 'info' : 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出 Word 失败';
      setExportProgress((prev) => ({
        ...prev,
        open: true,
        running: false,
        progress: 100,
        message,
        error: message,
      }));
      showToast(message, 'error');
    } finally {
      unsubscribe?.();
    }
  };

  const saveChapterContent = async (item: OutlineItem, content: string) => {
    if (!state.outlineData?.outline?.length) {
      throw new Error('当前没有可保存的目录');
    }

    const updatedOutlineData = {
      ...state.outlineData,
      outline: updateOutlineItemContent(state.outlineData.outline, item.id, content),
    };
    const updatedSections = {
      ...state.contentGenerationSections,
      [item.id]: {
        id: item.id,
        title: item.title || '未命名章节',
        status: content.trim() ? 'success' as const : 'idle' as const,
        content,
        updated_at: new Date().toISOString(),
      },
    };

    setState((prev) => ({
      ...prev,
      outlineData: updatedOutlineData,
      contentGenerationSections: updatedSections,
    }));
    await window.bidmind?.workspace.updateTechnicalPlan({
      outlineData: updatedOutlineData,
      contentGenerationSections: updatedSections,
    });
  };

  const resetContentGeneration = async () => {
    if (!state.outlineData?.outline?.length) {
      throw new Error('当前没有可重新生成的目录');
    }

    const updatedOutlineData = resetGeneratedContent(state.outlineData);
    setState((prev) => ({
      ...prev,
      outlineData: updatedOutlineData,
      contentGenerationTask: undefined,
      contentGenerationSections: {},
      contentGenerationPlans: {},
    }));
    await window.bidmind?.workspace.updateTechnicalPlan({
      outlineData: updatedOutlineData,
      contentGenerationTask: undefined,
      contentGenerationSections: {},
      contentGenerationPlans: {},
    });
    return updatedOutlineData;
  };

  const handleOutlineGenerated = (outlineData: OutlineData) => {
    const updatedOutlineData = resetGeneratedContent(outlineData);
    setState((prev) => ({
      ...prev,
      outlineData: updatedOutlineData,
      contentGenerationTask: undefined,
      contentGenerationSections: {},
      contentGenerationPlans: {},
    }));

    void window.bidmind?.workspace.updateTechnicalPlan({
      outlineData: updatedOutlineData,
      contentGenerationTask: undefined,
      contentGenerationSections: {},
      contentGenerationPlans: {},
    }).catch((error) => {
      showToast(error instanceof Error ? error.message : '保存目录修改失败', 'error');
    });
  };

  const resetTechnicalPlan = () => {
    if (!window.confirm('会清空整个技术方案编写进度，是否确认？')) {
      return;
    }

    setState(resetState);
  };

  const saveContentGenerationOptions = async (contentGenerationOptions: ContentGenerationOptions) => {
    await window.bidmind?.workspace.updateTechnicalPlan({ contentGenerationOptions });
    setState((prev) => ({ ...prev, contentGenerationOptions }));
  };

  const generatedContentCount = state.outlineData?.outline
    ? collectLeafItems(state.outlineData.outline).filter((item) => item.content?.trim()).length
    : 0;

  const navigationActions = state.step === 'content-edit'
    ? [
      {
        id: 'previous-step',
        label: '上一步',
        icon: <ToolbarArrowLeftIcon />,
        disabled: activeIndex <= 0,
        tooltip: activeIndex <= 0 ? '当前已经是第一步' : `返回${stepLabels[steps[activeIndex - 1]]}`,
        onClick: () => goToOffset(-1),
      },
      {
        id: 'export-word',
        label: isExporting ? '导出中...' : '导出 Word',
        icon: <ToolbarDocumentIcon />,
        variant: 'primary' as const,
        disabled: isContentGenerating || isExporting || !state.outlineData,
        tooltip: isContentGenerating ? '正文生成中，完成后再导出' : isExporting ? 'Word 正在导出，请稍候' : generatedContentCount ? '导出当前技术方案正文' : '可导出空目录文档，建议先生成正文',
        onClick: () => setExportSettingsOpen(true),
      },
      {
        id: 'continue-expand',
        label: '继续扩写',
        icon: <ToolbarArrowRightIcon />,
        disabled: !state.outlineData,
        tooltip: '进入扩写改写步骤',
        onClick: () => switchStep('expand'),
      },
    ]
    : [
      {
        id: 'previous-step',
        label: '上一步',
        icon: <ToolbarArrowLeftIcon />,
        disabled: activeIndex <= 0,
        tooltip: activeIndex <= 0 ? '当前已经是第一步' : `返回${stepLabels[steps[activeIndex - 1]]}`,
        onClick: () => goToOffset(-1),
      },
      {
        id: 'next-step',
        label: '下一步',
        icon: <ToolbarArrowRightIcon />,
        variant: 'primary' as const,
        disabled: isNextDisabled,
        tooltip: nextTooltip,
        onClick: () => goToOffset(1),
      },
    ];

  const toolbarGroups = [
    {
      id: 'technical-plan-reset',
      actions: [
        {
          id: 'reset',
          label: '重置',
          variant: 'danger' as const,
          tooltip: '清空当前技术方案流程',
          onClick: resetTechnicalPlan,
        },
        {
          id: 'home',
          label: '项目管理',
          variant: 'secondary' as const,
          tooltip: '返回项目管理页面',
          onClick: () => workspaceStorage.save({ activeSection: 'project-management' }),
        },
      ],
    },
    {
      id: 'technical-plan-navigation',
      actions: navigationActions,
    },
  ];

  return (
    <div className={`page-stack technical-workbench${runningOverlayVisible ? ' is-running-focus' : ''}`}>
      {activeProjectName ? (
        <section className="project-context-banner">
          <span className="section-kicker">当前项目</span>
          <strong>{activeProjectName}</strong>
          <small>来自项目管理页 · 技术方案工作区</small>
        </section>
      ) : null}
      <section className={`workflow-stage-banner ${workflowStageCollapsed ? 'is-collapsed' : ''}`}>
        <div className="workflow-stage-head">
          <div className="workflow-stage-copy">
            <span className="section-kicker">技术方案流程</span>
            <strong>{stepLabels[state.step]}</strong>
            <small>{stepDescriptions[state.step]}</small>
          </div>
          <button
            type="button"
            className="workflow-stage-toggle"
            onClick={() => setWorkflowStageCollapsed((prev) => !prev)}
            aria-expanded={!workflowStageCollapsed}
            aria-label={workflowStageCollapsed ? '展开技术方案流程' : '折叠技术方案流程'}
          >
            <em>{workflowStageCollapsed ? '展开' : '折叠'}</em>
          </button>
        </div>
        {!workflowStageCollapsed && (
          <ol className="workflow-stage-list" aria-label="技术方案当前阶段">
            {steps.map((step, index) => {
              const isActive = state.step === step;
              const isDone = steps.indexOf(state.step) > index;
              return (
                <li key={step} className={isActive ? 'is-active' : isDone ? 'is-done' : ''}>
                  <em>{index + 1}</em>
                  <div>
                    <strong>{stepLabels[step]}</strong>
                    <span>{stepDescriptions[step]}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      {state.step === 'document-analysis' && (
        <DocumentAnalysisPage
          fileName={state.fileName}
          fileContent={state.fileContent}
          onBusyChange={setDocumentImportRunning}
          onFileImported={(fileName, fileContent) => setState((prev) => ({
            ...prev,
            fileName,
            fileContent,
            projectOverview: '',
            techRequirements: '',
            bidAnalysisTasks: {},
            bidAnalysisProgress: 0,
            outlineMode: 'aligned',
            referenceKnowledgeDocumentIds: [],
            bidAnalysisTask: undefined,
            outlineGenerationTask: undefined,
            contentGenerationTask: undefined,
            contentGenerationOptions: undefined,
            contentGenerationSections: {},
            contentGenerationPlans: {},
            outlineData: null,
          }))}
        />
      )}

      {state.step === 'bid-analysis' && (
        <BidAnalysisPage
          fileContent={state.fileContent}
          projectOverview={state.projectOverview}
          techRequirements={state.techRequirements}
          mode={state.bidAnalysisMode}
          tasks={state.bidAnalysisTasks}
          task={state.bidAnalysisTask}
          progress={state.bidAnalysisProgress}
          onModeChange={(mode) => setState((prev) => ({ ...prev, bidAnalysisMode: mode }))}
          onTasksChange={(updater) => setState((prev) => ({ ...prev, bidAnalysisTasks: updater(prev.bidAnalysisTasks) }))}
          onProgressChange={(progress) => setState((prev) => ({ ...prev, bidAnalysisProgress: progress }))}
          onRequiredResultChange={(projectOverview, techRequirements) => setState((prev) => ({
            ...prev,
            projectOverview,
            techRequirements,
          }))}
        />
      )}
      {state.step === 'outline-generation' && (
        <OutlineEditPage
          projectOverview={state.projectOverview}
          techRequirements={state.techRequirements}
          outlineMode={state.outlineMode}
          referenceKnowledgeDocumentIds={state.referenceKnowledgeDocumentIds}
          outlineData={state.outlineData}
          task={state.outlineGenerationTask}
          contentTaskRunning={state.contentGenerationTask?.status === 'running'}
          onOutlineModeChange={(outlineMode) => setState((prev) => ({ ...prev, outlineMode }))}
          onReferenceKnowledgeDocumentsChange={(referenceKnowledgeDocumentIds) => setState((prev) => ({ ...prev, referenceKnowledgeDocumentIds }))}
          onOutlineGenerated={handleOutlineGenerated}
        />
      )}
      {state.step === 'content-edit' && (
        <ContentEditPage
          outlineData={state.outlineData}
          projectOverview={state.projectOverview}
          referenceKnowledgeDocumentIds={state.referenceKnowledgeDocumentIds}
          task={state.contentGenerationTask}
          contentGenerationOptions={state.contentGenerationOptions}
          sections={state.contentGenerationSections}
          onContentGenerationOptionsChange={saveContentGenerationOptions}
          onContentSaved={saveChapterContent}
          onContentReset={resetContentGeneration}
        />
      )}
      {state.step === 'expand' && (
        <section className="empty-panel compact-placeholder">
          <div className="feature-under-development-overlay" role="status" aria-live="polite">
            <strong>正在开发中，敬请期待</strong>
            <span>此功能尚未完成，请先不要使用。</span>
          </div>
          <span className="section-kicker">STEP 05</span>
          <h3>扩写改写</h3>
          <p>后续接入旧方案导入、章节扩写和人工校准。</p>
        </section>
      )}

      <Dialog.Root open={exportSettingsOpen} onOpenChange={setExportSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="export-settings-card">
            <div className="content-regenerate-card-head">
              <span className="section-kicker">导出样式</span>
              <Dialog.Title>Word 样式设置</Dialog.Title>
              <Dialog.Description>可先选预设，再按需自定义字体、字号、标题和序号样式。</Dialog.Description>
            </div>

            <div className="export-settings-body">
              <div className="export-style-preset-grid" role="radiogroup" aria-label="样式预设">
                {(Object.keys(exportStylePresets) as Array<keyof typeof exportStylePresets>).map((presetId) => (
                  <button
                    type="button"
                    key={presetId}
                    role="radio"
                    aria-checked={exportStyleOptions.presetId === presetId}
                    className={`export-style-preset ${exportStyleOptions.presetId === presetId ? 'is-active' : ''}`}
                    onClick={() => applyExportStylePreset(presetId)}
                  >
                    <strong>{presetId === 'official' ? '官方标书风格' : presetId === 'compact' ? '紧凑评审风格' : '学术报告风格'}</strong>
                    <small>{exportStylePresets[presetId].bodyFont} / {exportStylePresets[presetId].bodySize}pt / 行距 {exportStylePresets[presetId].lineSpacing}</small>
                  </button>
                ))}
              </div>

              <div className="export-style-form-grid">
                <label>
                  标题字体
                  <input
                    value={exportStyleOptions.titleFont}
                    onChange={(event) => updateExportStyleOptions({ presetId: 'custom', titleFont: event.target.value })}
                    placeholder="例如：宋体"
                  />
                </label>
                <label>
                  标题字号（pt）
                  <input
                    type="number"
                    min={10}
                    max={48}
                    value={exportStyleOptions.titleSize}
                    onChange={(event) => updateExportStyleOptions({ presetId: 'custom', titleSize: Number(event.target.value) })}
                  />
                </label>
                <label>
                  一级标题字体
                  <input
                    value={exportStyleOptions.headingFont}
                    onChange={(event) => updateExportStyleOptions({ presetId: 'custom', headingFont: event.target.value })}
                    placeholder="例如：黑体"
                  />
                </label>
                <label>
                  一级标题字号（pt）
                  <input
                    type="number"
                    min={10}
                    max={36}
                    value={exportStyleOptions.headingSize}
                    onChange={(event) => updateExportStyleOptions({ presetId: 'custom', headingSize: Number(event.target.value) })}
                  />
                </label>
                <label>
                  正文字体
                  <input
                    value={exportStyleOptions.bodyFont}
                    onChange={(event) => updateExportStyleOptions({ presetId: 'custom', bodyFont: event.target.value })}
                    placeholder="例如：宋体"
                  />
                </label>
                <label>
                  正文字号（pt）
                  <input
                    type="number"
                    min={8}
                    max={28}
                    value={exportStyleOptions.bodySize}
                    onChange={(event) => updateExportStyleOptions({ presetId: 'custom', bodySize: Number(event.target.value) })}
                  />
                </label>
                <label>
                  行距
                  <input
                    type="number"
                    step={0.1}
                    min={1}
                    max={2.4}
                    value={exportStyleOptions.lineSpacing}
                    onChange={(event) => updateExportStyleOptions({ presetId: 'custom', lineSpacing: Number(event.target.value) })}
                  />
                </label>
                <label>
                  序号样式
                  <select
                    value={exportStyleOptions.numberingFormat}
                    onChange={(event) => updateExportStyleOptions({ presetId: 'custom', numberingFormat: event.target.value as ExportNumberingFormat })}
                  >
                    {(Object.keys(numberingFormatLabels) as ExportNumberingFormat[]).map((format) => (
                      <option value={format} key={format}>{numberingFormatLabels[format]}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <div className="content-regenerate-actions">
              <Dialog.Close className="secondary-action" type="button">取消</Dialog.Close>
              <button type="button" className="primary-action" onClick={() => void exportWord()} disabled={isContentGenerating || isExporting}>确认导出</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={exportProgress.open}
        onOpenChange={(open) => {
          if (!open && !exportProgress.running) {
            setExportProgress(initialExportProgress);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="content-regenerate-modal" />
          <Dialog.Content className="export-progress-card">
            <div className="content-regenerate-card-head">
              <span className="section-kicker">Word 导出</span>
              <Dialog.Title>{exportProgress.running ? '正在导出 Word' : exportProgress.error ? '导出失败' : '导出完成'}</Dialog.Title>
              <Dialog.Description>
                {exportProgress.mermaidCount > 0
                  ? `本次包含 ${exportProgress.mermaidCount} 张 Mermaid 图，导出时会通过 mermaid.ink 转换成 Word 图片，速度受网络影响。`
                  : '正在将正文、表格和图片写入 Word 文档。'}
              </Dialog.Description>
            </div>
            <div className="export-progress-body">
              <div className="content-generation-progress-track" aria-label={`Word 导出进度 ${exportProgress.progress}%`}>
                <span style={{ width: `${exportProgress.progress}%` }} />
              </div>
              <p>{exportProgress.message || '正在处理导出任务，请稍候。'}</p>
              {exportProgress.warnings.length > 0 && (
                <div className="export-warning-list">
                  <strong>需要核对</strong>
                  {exportProgress.warnings.slice(0, 4).map((warning) => <small key={warning}>{warning}</small>)}
                  {exportProgress.warnings.length > 4 && <small>还有 {exportProgress.warnings.length - 4} 条图片提示，请打开导出的 Word 核对。</small>}
                </div>
              )}
            </div>
            {!exportProgress.running && (
              <div className="content-regenerate-actions">
                <Dialog.Close className="primary-action" type="button">知道了</Dialog.Close>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <FloatingToolbar groups={toolbarGroups} label="技术方案工具条" />
    </div>
  );
}

export default TechnicalPlanHome;
