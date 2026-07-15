import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { FloatingToolbar, isLibreOfficeRequiredMessage, MarkdownRenderer, ToolbarArrowLeftIcon, ToolbarArrowRightIcon, useDocumentParseNotice, useToast } from '../../../shared/ui';
import type { FloatingToolbarGroup } from '../../../shared/ui';
import type { DuplicateAnalysisStatus, DuplicateAnalysisTabId, DuplicateCheckProjectSummary, DuplicateCheckStep, DuplicateCheckWorkspaceState, DuplicateContentAnalysisState, DuplicateHistoryRecord, DuplicateImageAnalysisState, DuplicateMetadataAnalysisState, DuplicateOutlineAnalysisState, LocalFileSelection } from '../../../shared/types';
import { workspaceStorage } from '../../../shared/storage/workspaceStorage';

const guideItems = [
  '同设备、同用户、同一个 WPS 账号、时间相近等问题，一秒锁定。',
  '可选上传招标文件，多份投标文件都引用了招标文件中的内容，不算重复。',
  '图片基于哈希校验，只能识别同一张图片，截图、压缩等相似图片筛不出来。',
];

const dimensions = [
  { title: '元数据', text: '检查设备、账号、编辑时间、作者等隐藏信息。' },
  { title: '目录', text: '比对章节结构和标题顺序，识别模板化复制。' },
  { title: '正文', text: '筛查段落、表格和关键描述的重复内容。' },
  { title: '图片', text: '对原图做哈希校验，定位完全一致的图片。' },
];

const analysisTabs: Array<{
  id: DuplicateAnalysisTabId;
  label: string;
}> = [
  { id: 'metadata', label: '元数据' },
  { id: 'outline', label: '目录' },
  { id: 'content', label: '正文' },
  { id: 'image', label: '图片' },
  { id: 'summary', label: '摘要' },
];

const defaultAnalysisTab: DuplicateAnalysisTabId = 'metadata';
const steps: DuplicateCheckStep[] = ['management', 'upload', 'analysis'];
type DuplicateHistoryViewMode = 'current' | 'history';
type DuplicateHistoryStatusFilter = 'all' | 'success' | 'error' | 'running';
type DuplicateProjectStatusFilter = 'in-progress' | 'completed' | 'deleted';
const DUPLICATE_UPLOAD_GUIDE_COLLAPSED_KEY = 'bidmind:duplicate-check:upload-guide-collapsed:v1';
const DUPLICATE_SUMMARY_FLUSH_INTERVAL_MS = 160;
const stepLabels: Record<DuplicateCheckStep, string> = {
  management: '查重管理',
  upload: '选择标书',
  analysis: '查重结果',
};

const workbenchLabels: Record<'technical-plan' | 'business-bid', string> = {
  'technical-plan': '技术方案',
  'business-bid': '商务标',
};

const projectStatusLabels: Record<'in-progress' | 'completed' | 'deleted', string> = {
  'in-progress': '进行中',
  completed: '已完成',
  deleted: '已删除',
};

const duplicateProjectStatusSections: Record<DuplicateProjectStatusFilter, { label: string; emptyLabel: string }> = {
  'in-progress': { label: '进行中', emptyLabel: '暂无进行中的查重项目' },
  completed: { label: '已完成', emptyLabel: '暂无已完成的查重项目' },
  deleted: { label: '已删除', emptyLabel: '回收站暂无查重项目' },
};

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function createProjectId() {
  return `proj-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function loadUploadGuideCollapsedPreference() {
  try {
    return localStorage.getItem(DUPLICATE_UPLOAD_GUIDE_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function FilePill({ file, onRemove }: { file: LocalFileSelection; onRemove: () => void }) {
  return (
    <article className="duplicate-file-pill">
      <div className="duplicate-file-icon">{file.extension.replace('.', '').slice(0, 4).toUpperCase() || 'DOC'}</div>
      <div className="duplicate-file-info">
        <strong title={file.file_name}>{file.file_name}</strong>
        <span>{formatFileSize(file.size)} · {formatDate(file.modified_at)}</span>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        aria-label={`删除 ${file.file_name}`}
      >
        删除
      </button>
    </article>
  );
}

function statusLabel(status: DuplicateAnalysisStatus) {
  if (status === 'running') return '分析中';
  if (status === 'success') return '已完成';
  if (status === 'error') return '有错误';
  return '待分析';
}

function historyStatusLabel(status: DuplicateAnalysisStatus) {
  if (status === 'success') return '已完成';
  if (status === 'error') return '部分失败';
  if (status === 'running') return '进行中';
  return '待分析';
}

function progressText(progress?: { completed: number; total: number }) {
  if (!progress?.total) return '0/0';
  return `${progress.completed}/${progress.total}`;
}

function fileIndexLabel(index: number) {
  let value = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return label;
}

function buildFileLabelMap(files: LocalFileSelection[]) {
  return new Map(files.map((file, index) => [file.id, fileIndexLabel(index)]));
}

function formatDuplicateSentenceText(normalized: string, sentence: string) {
  const text = normalized || sentence;
  return text.length > 600 ? `${text.slice(0, 600)}...` : text;
}

function formatImageLocationSentence(value: string) {
  return value.length > 72 ? `${value.slice(0, 72)}...` : value;
}

function createDuplicateCheckSignature(files: LocalFileSelection[]) {
  const source = files
    .map((file) => `${file.file_path}|${file.size}|${file.modified_at}`)
    .join('\n');
  const bytes = new TextEncoder().encode(source);
  const words = new Uint32Array(80);
  const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 80; index += 1) {
      words[index] = rotateLeft(words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let index = 0; index < 80; index += 1) {
      let f = 0;
      let k = 0;
      if (index < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (index < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (index < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (rotateLeft(a, 5) + f + e + k + words[index]) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  return [h0, h1, h2, h3, h4].map((value) => value.toString(16).padStart(8, '0')).join('');
}

function rotateLeft(value: number, bits: number) {
  return (value << bits) | (value >>> (32 - bits));
}

function isTerminalStatus(status?: DuplicateAnalysisStatus) {
  return status === 'success' || status === 'error';
}

function createHistoryTitle(bidFiles: LocalFileSelection[]) {
  if (!bidFiles.length) return '未命名查重记录';
  const first = bidFiles[0]?.file_name || '未命名文件';
  if (bidFiles.length === 1) return first;
  return `${first} 等 ${bidFiles.length} 份文件`;
}

function sanitizeDownloadName(value: string) {
  return String(value || 'history')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'history';
}

function downloadText(content: string, fileName: string, mimeType = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildHistoryReport(record: DuplicateHistoryRecord) {
  const metadataRows = record.metadataAnalysis?.rows || [];
  const outlineGroups = record.outlineAnalysis?.duplicateGroups || [];
  const duplicateSentences = record.contentAnalysis?.duplicateSentences || [];
  const duplicateImages = record.imageAnalysis?.duplicateImages || [];
  const duplicateMetadataRows = metadataRows.filter((row) => row.duplicate_file_ids?.length > 1 || row.same_day_file_ids?.length > 1);
  const topOutlineGroups = outlineGroups.slice(0, 15);
  const topDuplicateSentences = duplicateSentences.slice(0, 20);
  const topDuplicateImages = duplicateImages.slice(0, 12);
  const lines = [
    '# 标书查重历史报告',
    '',
    `- 记录名称：${record.title}`,
    `- 更新时间：${formatDate(record.updated_at)}`,
    `- 状态：${historyStatusLabel(record.status)}`,
    `- 招标文件：${record.tenderFileName || '未上传'}`,
    `- 投标文件：${record.bidFileNames.join('、') || '未上传'}`,
    '',
    '## 总览统计',
    `- 元数据重复项：${duplicateMetadataRows.length}`,
    `- 重复目录组：${outlineGroups.length}（已过滤招标目录 ${record.outlineAnalysis?.tenderMatchedItemCount || 0} 项）`,
    `- 重复句子组：${duplicateSentences.length}（已过滤招标引用 ${record.contentAnalysis?.tenderMatchedSentenceCount || 0} 句）`,
    `- 重复图片组：${duplicateImages.length}`,
    '',
  ];

  if (record.aiSummary) {
    lines.push('## 风险摘要', record.aiSummary, '');
  }

  if (duplicateMetadataRows.length) {
    lines.push('## 元数据重点项');
    duplicateMetadataRows.slice(0, 20).forEach((row) => {
      lines.push(`- ${row.label}：${row.duplicate_file_ids.length ? `重复 ${row.duplicate_file_ids.length} 份` : ''}${row.same_day_file_ids.length ? ` 同日 ${row.same_day_file_ids.length} 份` : ''}`.trim());
    });
    lines.push('');
  }

  if (topOutlineGroups.length) {
    lines.push('## 重复目录（Top 15）');
    topOutlineGroups.forEach((group, index) => {
      const outlineTitle = group.title || group.paths?.[group.file_ids?.[0] || '']?.[0] || '未识别目录';
      lines.push(`${index + 1}. ${outlineTitle}（涉及 ${group.file_ids.length} 份文件）`);
    });
    lines.push('');
  }

  if (topDuplicateSentences.length) {
    lines.push('## 重复句子（Top 20）');
    topDuplicateSentences.forEach((item, index) => {
      const sentence = formatDuplicateSentenceText(item.normalized, item.sentence).replace(/\r?\n+/g, ' ');
      lines.push(`${index + 1}. ${sentence}`);
    });
    lines.push('');
  }

  if (topDuplicateImages.length) {
    lines.push('## 重复图片（Top 12）');
    topDuplicateImages.forEach((item, index) => {
      lines.push(`${index + 1}. Hash: ${item.hash}（涉及 ${item.file_ids.length} 份文件）`);
    });
    lines.push('');
  }

  lines.push('---', '由 BidMind 标书查重模块自动导出');
  return lines.join('\n');
}

function buildHistoryRecord(params: {
  signature: string;
  tenderFile: LocalFileSelection | null;
  bidFiles: LocalFileSelection[];
  metadataAnalysis?: DuplicateMetadataAnalysisState;
  outlineAnalysis?: DuplicateOutlineAnalysisState;
  contentAnalysis?: DuplicateContentAnalysisState;
  imageAnalysis?: DuplicateImageAnalysisState;
  prev?: DuplicateHistoryRecord;
}): DuplicateHistoryRecord {
  const now = new Date().toISOString();
  const status: DuplicateAnalysisStatus = params.metadataAnalysis?.status === 'error'
    || params.outlineAnalysis?.status === 'error'
    || params.contentAnalysis?.status === 'error'
    || params.imageAnalysis?.status === 'error'
    ? 'error'
    : 'success';
  return {
    id: params.prev?.id || `dup-history-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    signature: params.signature,
    title: createHistoryTitle(params.bidFiles),
    created_at: params.prev?.created_at || now,
    updated_at: now,
    status,
    tenderFile: params.tenderFile || null,
    bidFiles: params.bidFiles,
    tenderFileName: params.tenderFile?.file_name || '',
    bidFileNames: params.bidFiles.map((file) => file.file_name),
    metadataAnalysis: params.metadataAnalysis,
    outlineAnalysis: params.outlineAnalysis,
    contentAnalysis: params.contentAnalysis,
    imageAnalysis: params.imageAnalysis,
    aiSummary: params.prev?.aiSummary,
    aiSummaryStatus: params.prev?.aiSummaryStatus || 'idle',
    aiSummaryError: params.prev?.aiSummaryError,
  };
}

function upsertHistoryRecord(history: DuplicateHistoryRecord[], nextRecord: DuplicateHistoryRecord) {
  const index = history.findIndex((item) => item.signature === nextRecord.signature);
  if (index < 0) {
    return [nextRecord, ...history].slice(0, 30);
  }
  const cloned = [...history];
  cloned[index] = { ...cloned[index], ...nextRecord };
  return cloned.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 30);
}

function buildAiSummaryPrompt(record: DuplicateHistoryRecord) {
  const metadataRows = record.metadataAnalysis?.rows?.length || 0;
  const outlineGroups = record.outlineAnalysis?.duplicateGroups?.length || 0;
  const duplicateSentences = record.contentAnalysis?.duplicateSentences?.length || 0;
  const duplicateImages = record.imageAnalysis?.duplicateImages?.length || 0;
  const tenderMatches = {
    outline: record.outlineAnalysis?.tenderMatchedItemCount || 0,
    content: record.contentAnalysis?.tenderMatchedSentenceCount || 0,
  };

  return [
    '你是投标查重复核助手，请基于以下查重结果写中文摘要。',
    '输出格式要求：',
    '1）先给“总体结论”（1-2句）；',
    '2）再给“高风险点”最多4条；',
    '3）最后给“整改建议”最多4条；',
    '4）禁止捏造未提供的数据。',
    '',
    `查重文件：${record.bidFileNames.join('、')}`,
    `招标文件：${record.tenderFileName || '未上传'}`,
    `元数据可比项：${metadataRows}`,
    `重复目录组数：${outlineGroups}`,
    `重复句子组数：${duplicateSentences}`,
    `重复图片组数：${duplicateImages}`,
    `被招标内容过滤的目录项：${tenderMatches.outline}`,
    `被招标内容过滤的句子：${tenderMatches.content}`,
  ].join('\n');
}

function normalizeHistoryRecords(records: DuplicateCheckWorkspaceState['historyRecords']): DuplicateHistoryRecord[] {
  if (!Array.isArray(records)) return [];
  return records
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    .map((item) => {
      const bidFiles = Array.isArray(item.bidFiles)
        ? item.bidFiles
        : Array.isArray(item.bidFileNames)
          ? item.bidFileNames.map((name, index) => ({
            id: `${item.id}-legacy-${index}`,
            file_name: name,
            file_path: '',
            extension: '',
            size: 0,
            modified_at: item.updated_at || new Date().toISOString(),
          }))
          : [];
      return {
        ...item,
        tenderFile: item.tenderFile || null,
        bidFiles,
        tenderFileName: item.tenderFileName || item.tenderFile?.file_name || '',
        bidFileNames: item.bidFileNames || bidFiles.map((file) => file.file_name),
        aiSummaryStatus: item.aiSummaryStatus || 'idle',
      };
    });
}

function DuplicateFileCodeBar({ files }: { files: LocalFileSelection[] }) {
  return (
    <div className="duplicate-file-codebar" aria-label="投标文件编号">
      {files.map((file, index) => (
        <span key={file.id} title={file.file_name}>
          <strong>{fileIndexLabel(index)}</strong>{file.file_name}
        </span>
      ))}
    </div>
  );
}

function PaginationControls({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="duplicate-pagination">
      <span>第 {Math.min(page, totalPages)} / {totalPages} 页，共 {total} 条</span>
      <div>
        <button type="button" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>上一页</button>
        <button type="button" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>下一页</button>
      </div>
    </div>
  );
}

function DuplicateProjectManagementPane({
  activeProjectId,
  projects,
  loading,
  keyword,
  statusFilter,
  onKeywordChange,
  onStatusFilterChange,
  onSelectProject,
  onCreateProject,
  onUpdateProjectStatus,
  onRemoveProject,
  onRefresh,
}: {
  activeProjectId: string;
  projects: DuplicateCheckProjectSummary[];
  loading: boolean;
  keyword: string;
  statusFilter: DuplicateProjectStatusFilter;
  onKeywordChange: (value: string) => void;
  onStatusFilterChange: (value: DuplicateProjectStatusFilter) => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (payload: { name: string; code: string; workbench: 'technical-plan' | 'business-bid' }) => void;
  onUpdateProjectStatus: (projectId: string, status: 'in-progress' | 'completed' | 'deleted') => void;
  onRemoveProject: (projectId: string) => void;
  onRefresh: () => void;
}) {
  const [projectName, setProjectName] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [workbench, setWorkbench] = useState<'technical-plan' | 'business-bid'>('technical-plan');
  const filteredProjects = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    return projects
      .filter((project) => project.status === statusFilter)
      .filter((project) => {
        if (!search) return true;
        return [project.project_name, project.project_code, project.project_id].join(' ').toLowerCase().includes(search);
      })
      .sort((a, b) => String(b.last_checked_at || b.updated_at).localeCompare(String(a.last_checked_at || a.updated_at)));
  }, [keyword, projects, statusFilter]);

  const statusCounts = useMemo(() => {
    return projects.reduce<Record<'in-progress' | 'completed' | 'deleted', number>>((acc, project) => {
      acc[project.status] += 1;
      return acc;
    }, { 'in-progress': 0, completed: 0, deleted: 0 });
  }, [projects]);

  const totalProjects = projects.length;

  return (
    <section className="duplicate-management-board">
      <div className="duplicate-page-title duplicate-analysis-title">
        <div>
          <span className="section-kicker">STEP 01</span>
          <h2>查重管理</h2>
        </div>
        <button type="button" className="secondary-action" onClick={onRefresh} disabled={loading}>
          {loading ? '刷新中...' : '刷新列表'}
        </button>
      </div>

      <div className="duplicate-management-metrics">
        <article>
          <span>进行中</span>
          <strong>{statusCounts['in-progress']}</strong>
        </article>
        <article>
          <span>已完成</span>
          <strong>{statusCounts.completed}</strong>
        </article>
        <article>
          <span>已删除</span>
          <strong>{statusCounts.deleted}</strong>
        </article>
      </div>

      <div className="duplicate-management-create">
        <label>
          项目名称
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="例如：智慧园区项目第 3 轮查重"
          />
        </label>
        <label>
          项目编号（可选）
          <input
            value={projectCode}
            onChange={(event) => setProjectCode(event.target.value)}
            placeholder="例如：YM-2026-028"
          />
        </label>
        <div className="duplicate-management-workbench" role="radiogroup" aria-label="项目类型">
          <button type="button" className={workbench === 'technical-plan' ? 'is-active' : ''} onClick={() => setWorkbench('technical-plan')}>技术方案</button>
          <button type="button" className={workbench === 'business-bid' ? 'is-active' : ''} onClick={() => setWorkbench('business-bid')}>商务标</button>
        </div>
        <button
          type="button"
          className="primary-action"
          onClick={() => {
            onCreateProject({
              name: projectName.trim(),
              code: projectCode.trim(),
              workbench,
            });
            setProjectName('');
            setProjectCode('');
          }}
        >
          新建查重项目
        </button>
      </div>

      <div className="duplicate-management-filters">
        <div className="duplicate-management-status-tabs" role="tablist" aria-label="查重项目状态">
          {(Object.keys(duplicateProjectStatusSections) as DuplicateProjectStatusFilter[]).map((status) => {
            const isActive = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`duplicate-management-status-tab ${isActive ? 'is-active' : ''}`}
                onClick={() => onStatusFilterChange(status)}
              >
                <span>{duplicateProjectStatusSections[status].label}</span>
                <strong>{statusCounts[status]}</strong>
              </button>
            );
          })}
        </div>
        <input value={keyword} onChange={(event) => onKeywordChange(event.target.value)} placeholder="搜索项目名称 / 编号 / ID" />
      </div>

      {filteredProjects.length ? (
        <div className="duplicate-management-list">
          {filteredProjects.map((project) => {
            const isActiveProject = project.project_id === activeProjectId;
            const canEnter = project.status !== 'deleted';
            return (
              <article key={project.project_id} className={`duplicate-management-item ${isActiveProject ? 'is-active' : ''}`}>
                <div>
                  <strong>{project.project_name}</strong>
                  <p>
                    {project.project_code ? `编号：${project.project_code}` : '未设置编号'}
                    {' · '}
                    类型：{workbenchLabels[project.workbench]}
                    {' · '}
                    状态：{projectStatusLabels[project.status]}
                  </p>
                  <small>
                    历史记录：{project.history_count} 条
                    {project.last_checked_at ? ` · 最近查重：${formatDate(project.last_checked_at)}` : ' · 暂无查重记录'}
                  </small>
                </div>
                <div className="duplicate-management-item-actions">
                  {canEnter ? (
                    <button type="button" className="secondary-action" onClick={() => onSelectProject(project.project_id)}>
                      {isActiveProject ? '当前项目' : '进入查重'}
                    </button>
                  ) : null}
                  {project.status !== 'deleted' ? (
                    <button
                      type="button"
                      className="danger-action"
                      onClick={() => onUpdateProjectStatus(project.project_id, 'deleted')}
                    >
                      删除项目
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="secondary-action"
                        onClick={() => onUpdateProjectStatus(project.project_id, 'in-progress')}
                      >
                        恢复项目
                      </button>
                      <button
                        type="button"
                        className="danger-action"
                        onClick={() => onRemoveProject(project.project_id)}
                      >
                        彻底删除
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="duplicate-analysis-empty duplicate-management-empty">
          <strong>{totalProjects ? duplicateProjectStatusSections[statusFilter].emptyLabel : '暂无查重项目'}</strong>
          <p>{totalProjects ? '可以切换到其他状态查看项目，或创建新的查重项目。' : '先新建一个查重项目，再进入上传与分析流程。'}</p>
        </div>
      )}
    </section>
  );
}

function DuplicateMetadataPane({ analysis, bidFiles }: { analysis?: DuplicateMetadataAnalysisState; bidFiles: LocalFileSelection[] }) {
  const isRunning = analysis?.status === 'running';
  const isDone = analysis?.status === 'success' || analysis?.status === 'error';
  const rows = analysis?.rows || [];
  const files = analysis?.files?.length ? analysis.files : bidFiles.map((file) => ({ file_id: file.id, file_name: file.file_name, status: 'pending' as const, metadata: [] }));

  return (
    <div className="duplicate-metadata-panel">
      <div className="duplicate-metadata-status-grid">
        <article>
          <span>正文内容提取</span>
          <strong>{progressText(analysis?.contentExtraction)}</strong>
          <small>{statusLabel(analysis?.contentExtraction?.status || 'pending')}</small>
        </article>
        <article>
          <span>元数据提取</span>
          <strong>{progressText(analysis?.metadataExtraction)}</strong>
          <small>{statusLabel(analysis?.metadataExtraction?.status || 'pending')}</small>
        </article>
      </div>

      {!analysis && (
        <div className="duplicate-analysis-empty">
          <strong>等待启动元数据分析</strong>
          <p>首次进入查重结果后，会自动并发执行正文内容提取和投标文件元数据提取。</p>
        </div>
      )}

      {analysis && !rows.length && (
        <div className="duplicate-analysis-empty">
          <strong>{isRunning ? '正在提取元数据' : '暂无可对比元数据'}</strong>
          <p>{analysis.message || '请稍候，文件较多时需要一定时间。'}</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="duplicate-metadata-table-wrap">
          <table className="duplicate-metadata-table">
            <thead>
              <tr>
                <th>元数据项</th>
                {files.map((file) => <th key={file.file_id} title={file.file_name}>{file.file_name}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th>{row.label}</th>
                  {files.map((file) => {
                    const duplicated = row.duplicate_file_ids.includes(file.file_id);
                    const sameDay = row.same_day_file_ids?.includes(file.file_id);
                    return (
                      <td key={file.file_id} className={duplicated ? 'is-duplicate' : sameDay ? 'is-same-day' : undefined}>
                        {row.values[file.file_id] || '-'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isDone && analysis?.contentFiles?.some((file) => file.status === 'error') && (
        <p className="duplicate-analysis-warning">部分文件正文提取失败，可重新选择文件后再分析。</p>
      )}
    </div>
  );
}

function DuplicateOutlinePane({ analysis, bidFiles }: { analysis?: DuplicateOutlineAnalysisState; bidFiles: LocalFileSelection[] }) {
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const labelMap = useMemo(() => buildFileLabelMap(bidFiles), [bidFiles]);
  const files = analysis?.files || [];
  const successfulFiles = files.filter((file) => file.status === 'success');
  const duplicateGroups = analysis?.duplicateGroups || [];
  const totalPages = Math.max(1, Math.ceil(duplicateGroups.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = duplicateGroups.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => setPage(1), [duplicateGroups.length]);

  function getOutlineGroupText(group: DuplicateOutlineAnalysisState['duplicateGroups'][number]) {
    const firstPath = group.file_ids.map((fileId) => group.paths[fileId]?.[0]).find(Boolean);
    return group.type === 'duplicate' && firstPath ? firstPath : group.title || firstPath || '未识别目录';
  }

  async function handleCopyOutline(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制重复目录', 'success');
    } catch {
      showToast('复制重复目录失败', 'error');
    }
  }

  if (!analysis) {
    return <div className="duplicate-analysis-empty"><strong>等待目录分析</strong><p>元数据提取完成后会自动开始目录分析。</p></div>;
  }

  return (
    <div className="duplicate-match-panel">
      <DuplicateFileCodeBar files={bidFiles} />
      {duplicateGroups.length ? (
        <section className="duplicate-match-card">
          <div className="duplicate-match-card-head">
            <strong>重复目录</strong>
            <span>{analysis.message} · 已排除招标目录 {analysis.tenderMatchedItemCount} 项</span>
          </div>
          <div className="duplicate-sentence-list duplicate-outline-list">
            {pageItems.map((group) => {
              const text = getOutlineGroupText(group);
              return (
                <article key={group.id}>
                  <div className="duplicate-sentence-content">
                    <p>
                      {text}
                      <button
                        type="button"
                        className="duplicate-sentence-copy"
                        onClick={() => void handleCopyOutline(text)}
                        aria-label="复制重复目录"
                      >
                        复制
                      </button>
                    </p>
                  </div>
                  <div className="duplicate-file-badges">
                    {group.file_ids.map((fileId) => {
                      const count = group.paths[fileId]?.length || group.item_ids[fileId]?.length || 1;
                      return (
                        <span key={fileId} title={bidFiles.find((file) => file.id === fileId)?.file_name || fileId}>
                          {labelMap.get(fileId) || '?'}{count > 1 ? ` x${count}` : ''}
                        </span>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
          <PaginationControls page={currentPage} pageSize={pageSize} total={duplicateGroups.length} onPageChange={setPage} />
        </section>
      ) : (
        <div className="duplicate-analysis-empty">
          <strong>{analysis.status === 'running' ? '正在分析目录' : '未发现重复目录'}</strong>
          <p>{analysis.status === 'running' ? analysis.message : successfulFiles.length > 0 ? '未发现投标文件之间的目录重复；来自招标文件的目录项已自动排除。' : '暂无可用目录结果。'}</p>
        </div>
      )}
    </div>
  );
}

function DuplicateContentPane({ analysis, bidFiles }: { analysis?: DuplicateContentAnalysisState; bidFiles: LocalFileSelection[] }) {
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const labelMap = useMemo(() => buildFileLabelMap(bidFiles), [bidFiles]);
  const duplicateSentences = analysis?.duplicateSentences || [];
  const totalPages = Math.max(1, Math.ceil(duplicateSentences.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = duplicateSentences.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => setPage(1), [duplicateSentences.length]);

  async function handleCopySentence(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制重复句子', 'success');
    } catch {
      showToast('复制重复句子失败', 'error');
    }
  }

  if (!analysis) {
    return <div className="duplicate-analysis-empty"><strong>等待正文比对</strong><p>正文内容提取完成后会自动开始句子级比对。</p></div>;
  }

  return (
    <div className="duplicate-match-panel">
      <DuplicateFileCodeBar files={bidFiles} />
      {duplicateSentences.length ? (
        <section className="duplicate-match-card">
          <div className="duplicate-match-card-head">
            <strong>重复句子</strong>
            <span>{analysis.message} · 已排除招标引用 {analysis.tenderMatchedSentenceCount} 句</span>
          </div>
          <div className="duplicate-sentence-list">
            {pageItems.map((item) => (
              <article key={item.id}>
                <div className="duplicate-sentence-content">
                  <p>
                    {formatDuplicateSentenceText(item.normalized, item.sentence)}
                    <button
                      type="button"
                      className="duplicate-sentence-copy"
                      onClick={() => void handleCopySentence(item.sentence || item.normalized)}
                      aria-label="复制重复句子"
                    >
                      复制
                    </button>
                  </p>
                </div>
                <div className="duplicate-file-badges">
                  {item.file_ids.map((fileId) => (
                    <span key={fileId} title={bidFiles.find((file) => file.id === fileId)?.file_name || fileId}>
                      {labelMap.get(fileId) || '?'}{item.occurrences[fileId] > 1 ? ` x${item.occurrences[fileId]}` : ''}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
          <PaginationControls page={currentPage} pageSize={pageSize} total={duplicateSentences.length} onPageChange={setPage} />
        </section>
      ) : (
        <div className="duplicate-analysis-empty">
          <strong>{analysis.status === 'running' ? '正在比对正文' : '未发现重复句子'}</strong>
          <p>{analysis.status === 'running' ? analysis.message : '未发现投标文件之间的重复句子；引用招标文件的句子已自动排除。'}</p>
        </div>
      )}
    </div>
  );
}

function DuplicateImagePane({ analysis, bidFiles }: { analysis?: DuplicateImageAnalysisState; bidFiles: LocalFileSelection[] }) {
  const { showToast } = useToast();
  const [page, setPage] = useState(1);
  const pageSize = 24;
  const labelMap = useMemo(() => buildFileLabelMap(bidFiles), [bidFiles]);
  const duplicateImages = analysis?.duplicateImages || [];
  const totalPages = Math.max(1, Math.ceil(duplicateImages.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = duplicateImages.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => setPage(1), [duplicateImages.length]);

  async function handleCopyImageLocation(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制定位线索', 'success');
    } catch {
      showToast('复制定位线索失败', 'error');
    }
  }

  if (!analysis) {
    return <div className="duplicate-analysis-empty"><strong>等待图片比对</strong><p>正文内容提取完成后会自动按图片 hash 比对。</p></div>;
  }

  return (
    <div className="duplicate-match-panel">
      <DuplicateFileCodeBar files={bidFiles} />
      {duplicateImages.length ? (
        <section className="duplicate-match-card">
          <div className="duplicate-match-card-head">
            <strong>重复图片</strong>
            <span>{analysis.message} · 共识别 {analysis.totalImageCount} 张图片</span>
          </div>
          <div className="duplicate-image-grid">
            {pageItems.map((item) => {
              const locationEntries = item.file_ids.flatMap((fileId) => {
                const location = item.locations?.[fileId]?.[0];
                return location ? [{ fileId, location }] : [];
              });
              return (
                <article key={item.id}>
                  <div className="duplicate-image-preview">
                    <img src={item.preview_url} alt={`重复图片 ${item.hash.slice(0, 10)}`} loading="lazy" />
                  </div>
                  <strong>Hash {item.hash.slice(0, 12)}</strong>
                  <div className="duplicate-file-badges">
                    {item.file_ids.map((fileId) => (
                      <span key={fileId} title={bidFiles.find((file) => file.id === fileId)?.file_name || fileId}>
                        {labelMap.get(fileId) || '?'}{item.occurrences[fileId] > 1 ? ` x${item.occurrences[fileId]}` : ''}
                      </span>
                    ))}
                  </div>
                  {locationEntries.length > 0 && (
                    <div className="duplicate-image-locations">
                      {locationEntries.map((entry) => (
                        <div key={entry.fileId} className="duplicate-image-location">
                          <span>{labelMap.get(entry.fileId) || '?'}：{entry.location.directory || '未识别目录'}</span>
                          <p title={entry.location.previous_sentence || undefined}>前文：{entry.location.previous_sentence ? formatImageLocationSentence(entry.location.previous_sentence) : '未提取到图片前文'}</p>
                          <button type="button" onClick={() => void handleCopyImageLocation(entry.location.previous_sentence)} disabled={!entry.location.previous_sentence}>复制定位线索</button>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <PaginationControls page={currentPage} pageSize={pageSize} total={duplicateImages.length} onPageChange={setPage} />
        </section>
      ) : (
        <div className="duplicate-analysis-empty">
          <strong>{analysis.status === 'running' ? '正在比对图片' : '未发现重复图片'}</strong>
          <p>{analysis.status === 'running' ? analysis.message : '未发现投标文件之间完全相同的图片。'}</p>
        </div>
      )}
    </div>
  );
}

function DuplicateSummaryPane({
  record,
  historyViewMode,
  onRegenerateSummary,
}: {
  record: DuplicateHistoryRecord | null;
  historyViewMode: DuplicateHistoryViewMode;
  onRegenerateSummary: (historyId: string) => void;
}) {
  if (historyViewMode === 'history' && !record) {
    return (
      <div className="duplicate-analysis-empty">
        <strong>请选择一条历史记录</strong>
        <p>先在上方历史列表中选择一条记录，再查看对应摘要。</p>
      </div>
    );
  }

  if (!record) {
    return (
      <div className="duplicate-analysis-empty">
        <strong>摘要尚未生成</strong>
        <p>当前结果完成后会自动生成摘要，你也可以切换到历史记录后手动触发。</p>
      </div>
    );
  }

  const summaryStatus = record.aiSummaryStatus || 'idle';
  const statusLabelText = summaryStatus === 'running'
    ? '生成中'
    : summaryStatus === 'error'
      ? '生成失败'
      : record.aiSummary
        ? '已生成'
        : '未生成';
  const duplicateOutlineCount = record.outlineAnalysis?.duplicateGroups?.length || 0;
  const duplicateSentenceCount = record.contentAnalysis?.duplicateSentences?.length || 0;
  const duplicateImageCount = record.imageAnalysis?.duplicateImages?.length || 0;

  return (
    <div className="duplicate-summary-panel">
      <section className="duplicate-summary-meta">
        <article>
          <span>记录名称</span>
          <strong title={record.title}>{record.title}</strong>
        </article>
        <article>
          <span>摘要状态</span>
          <strong>{statusLabelText}</strong>
        </article>
        <article>
          <span>最近更新时间</span>
          <strong>{formatDate(record.updated_at)}</strong>
        </article>
        <article>
          <span>重复总览</span>
          <strong>目录 {duplicateOutlineCount} · 正文 {duplicateSentenceCount} · 图片 {duplicateImageCount}</strong>
        </article>
      </section>

      <section className="duplicate-summary-card">
        <div className="duplicate-summary-card-head">
          <strong>摘要</strong>
          <button
            type="button"
            className="secondary-action"
            onClick={() => onRegenerateSummary(record.id)}
            disabled={summaryStatus === 'running'}
          >
            {summaryStatus === 'running' ? '生成中...' : '重新生成'}
          </button>
        </div>
        <div className="duplicate-summary-content">
          {summaryStatus === 'running' ? (
            record.aiSummary ? (
              <div className="duplicate-summary-streaming">
                <small>正在生成摘要...</small>
                <div className="markdown-viewer duplicate-summary-markdown">
                  <MarkdownRenderer allowRawHtml={false}>
                    {record.aiSummary}
                  </MarkdownRenderer>
                </div>
              </div>
            ) : (
              <p>正在生成摘要，请稍候...</p>
            )
          ) : record.aiSummary ? (
            <div className="markdown-viewer duplicate-summary-markdown">
              <MarkdownRenderer allowRawHtml={false}>
                {record.aiSummary}
              </MarkdownRenderer>
            </div>
          ) : summaryStatus === 'error' ? (
            <p>摘要生成失败：{record.aiSummaryError || '未知错误'}</p>
          ) : (
            <p>暂无摘要内容。你可以点击“重新生成”获取最新总结。</p>
          )}
        </div>
      </section>
    </div>
  );
}

function DuplicateAnalysisPane({
  activeTab,
  onTabChange,
  metadataAnalysis,
  outlineAnalysis,
  contentAnalysis,
  imageAnalysis,
  bidFiles,
  onRerun,
  historyRecords,
  filteredHistoryRecords,
  selectedHistoryId,
  selectedHistoryRecord,
  historyViewMode,
  onSelectHistory,
  onHistoryViewModeChange,
  historyKeyword,
  onHistoryKeywordChange,
  historyStatusFilter,
  onHistoryStatusFilterChange,
  onDeleteHistoryRecord,
  onClearHistoryRecords,
  onExportHistoryRecord,
  onRegenerateSummary,
  summaryRecord,
}: {
  activeTab: DuplicateAnalysisTabId;
  onTabChange: (tab: DuplicateAnalysisTabId) => void;
  metadataAnalysis?: DuplicateMetadataAnalysisState;
  outlineAnalysis?: DuplicateOutlineAnalysisState;
  contentAnalysis?: DuplicateContentAnalysisState;
  imageAnalysis?: DuplicateImageAnalysisState;
  bidFiles: LocalFileSelection[];
  onRerun: () => void;
  historyRecords: DuplicateHistoryRecord[];
  filteredHistoryRecords: DuplicateHistoryRecord[];
  selectedHistoryId: string;
  selectedHistoryRecord: DuplicateHistoryRecord | null;
  historyViewMode: DuplicateHistoryViewMode;
  onSelectHistory: (historyId: string) => void;
  onHistoryViewModeChange: (mode: DuplicateHistoryViewMode) => void;
  historyKeyword: string;
  onHistoryKeywordChange: (value: string) => void;
  historyStatusFilter: DuplicateHistoryStatusFilter;
  onHistoryStatusFilterChange: (value: DuplicateHistoryStatusFilter) => void;
  onDeleteHistoryRecord: (historyId: string) => void;
  onClearHistoryRecords: () => void;
  onExportHistoryRecord: (historyId: string) => void;
  onRegenerateSummary: (historyId: string) => void;
  summaryRecord: DuplicateHistoryRecord | null;
}) {
  const activeItem = analysisTabs.find((item) => item.id === activeTab) || analysisTabs[0];
  const metadataStatus = metadataAnalysis?.status || 'pending';
  const metadataProgress = metadataAnalysis?.status === 'success' || metadataAnalysis?.status === 'error'
    ? 100
    : metadataAnalysis?.metadataExtraction?.total
      ? Math.round((metadataAnalysis.metadataExtraction.completed / metadataAnalysis.metadataExtraction.total) * 100)
      : 0;
  const analysisRunning = metadataStatus === 'running' || outlineAnalysis?.status === 'running' || contentAnalysis?.status === 'running' || imageAnalysis?.status === 'running';
  const hasHistoryRecords = historyRecords.length > 0;

  return (
    <section className="duplicate-analysis-panel">
      <div className="duplicate-page-title duplicate-analysis-title">
        <div>
          <span className="section-kicker">STEP 03</span>
          <h2>查重结果</h2>
        </div>
        <div className="duplicate-analysis-title-actions">
          {historyViewMode === 'current' && hasHistoryRecords ? (
            <button type="button" className="secondary-action" onClick={() => onHistoryViewModeChange('history')}>
              查看历史记录
            </button>
          ) : null}
          {historyViewMode === 'history' ? (
            <button type="button" className="secondary-action" onClick={() => onHistoryViewModeChange('current')}>
              返回当前结果
            </button>
          ) : (
            <button type="button" className="secondary-action" onClick={onRerun} disabled={!bidFiles.length || analysisRunning}>
              重新查重
            </button>
          )}
        </div>
      </div>

      {historyViewMode === 'history' ? (
        <>
          <div className="duplicate-history-head">
            <div className="duplicate-history-toggle" role="tablist" aria-label="查重视图切换">
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className=""
                onClick={() => onHistoryViewModeChange('current')}
              >
                当前结果
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={true}
                className="is-active"
                onClick={() => onHistoryViewModeChange('history')}
                disabled={!historyRecords.length}
              >
                历史记录
              </button>
            </div>
            {selectedHistoryRecord ? (
              <span className="duplicate-history-caption">
                正在查看：{selectedHistoryRecord.title}
              </span>
            ) : (
              <span className="duplicate-history-caption">请选择一条历史记录</span>
            )}
          </div>

          <section className="duplicate-history-workspace">
            {hasHistoryRecords ? (
              <>
                <div className="duplicate-history-tools">
                  <label>
                    <span>关键词</span>
                    <input
                      value={historyKeyword}
                      onChange={(event) => onHistoryKeywordChange(event.target.value)}
                      placeholder="搜索文件名或摘要关键字"
                    />
                  </label>
                  <label>
                    <span>状态</span>
                    <select
                      value={historyStatusFilter}
                      onChange={(event) => onHistoryStatusFilterChange(event.target.value as DuplicateHistoryStatusFilter)}
                    >
                      <option value="all">全部</option>
                      <option value="success">已完成</option>
                      <option value="error">部分失败</option>
                      <option value="running">进行中</option>
                    </select>
                  </label>
                  <div className="duplicate-history-tools-meta">
                    共 {historyRecords.length} 条，当前 {filteredHistoryRecords.length} 条
                  </div>
                </div>

                {filteredHistoryRecords.length ? (
                  <div className="duplicate-history-list" aria-label="查重历史记录">
                    {filteredHistoryRecords.map((item) => (
                      <article key={item.id} className={`duplicate-history-item ${selectedHistoryId === item.id ? 'is-active' : ''}`}>
                        <button
                          type="button"
                          className="duplicate-history-item-main"
                          onClick={() => onSelectHistory(item.id)}
                        >
                          <strong>{item.title}</strong>
                          <span>{historyStatusLabel(item.status)}</span>
                          <small>{new Date(item.updated_at).toLocaleString('zh-CN', { hour12: false })}</small>
                        </button>
                        <div className="duplicate-history-item-actions">
                          <button type="button" onClick={() => onExportHistoryRecord(item.id)}>导出</button>
                          <button type="button" className="is-danger" onClick={() => onDeleteHistoryRecord(item.id)}>删除</button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="duplicate-analysis-empty duplicate-history-empty">
                    <strong>没有匹配的历史记录</strong>
                    <p>请调整关键词或筛选状态后重试。</p>
                  </div>
                )}

                <div className="duplicate-history-actions">
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={!selectedHistoryRecord}
                    onClick={() => selectedHistoryRecord && onExportHistoryRecord(selectedHistoryRecord.id)}
                  >
                    导出当前记录
                  </button>
                  <button
                    type="button"
                    className="danger-action"
                    disabled={!historyRecords.length}
                    onClick={onClearHistoryRecords}
                  >
                    清空全部历史
                  </button>
                </div>
              </>
            ) : (
              <div className="duplicate-analysis-empty duplicate-history-empty">
                <strong>暂无历史记录</strong>
                <p>完成一次查重后会自动在这里沉淀历史。</p>
              </div>
            )}
          </section>
        </>
      ) : null}

      <section className="duplicate-analysis-workspace">
        <div className="duplicate-analysis-tabs" role="tablist" aria-label="标书查重维度">
          {analysisTabs.map((item) => {
            const isActive = item.id === activeTab;
            const summaryStatus = summaryRecord?.aiSummaryStatus || (summaryRecord?.aiSummary ? 'success' : 'idle');
            const status: DuplicateAnalysisStatus = item.id === 'metadata'
              ? metadataStatus
              : item.id === 'outline'
                ? outlineAnalysis?.status || 'pending'
                : item.id === 'content'
                  ? contentAnalysis?.status || 'pending'
                  : item.id === 'image'
                    ? imageAnalysis?.status || 'pending'
                    : item.id === 'summary'
                      ? summaryStatus === 'running'
                        ? 'running'
                        : summaryStatus === 'error'
                          ? 'error'
                          : summaryStatus === 'success' || Boolean(summaryRecord?.aiSummary)
                            ? 'success'
                            : 'pending'
                    : 'pending';
            const progress = item.id === 'metadata'
              ? metadataProgress
              : item.id === 'outline'
                ? outlineAnalysis?.progress || 0
                : item.id === 'content'
                  ? contentAnalysis?.progress || 0
                  : item.id === 'image'
                    ? imageAnalysis?.progress || 0
                    : item.id === 'summary'
                      ? summaryStatus === 'running'
                        ? 55
                        : summaryStatus === 'success' || Boolean(summaryRecord?.aiSummary)
                          ? 100
                          : 0
                    : 0;

            return (
              <button
                type="button"
                className={`duplicate-analysis-tab${isActive ? ' is-active' : ''} is-${status}`}
                role="tab"
                aria-selected={isActive}
                aria-controls={`duplicate-analysis-panel-${item.id}`}
                id={`duplicate-analysis-tab-${item.id}`}
                key={item.id}
                onClick={() => onTabChange(item.id)}
              >
                <span className="duplicate-analysis-tab-main">
                  <strong>{item.label}</strong>
                  <em>{statusLabel(status)}</em>
                </span>
                {status !== 'pending' && (
                  <span className="duplicate-analysis-progress" aria-label={`${item.label}分析进度 ${progress}%`}>
                    <span style={{ width: `${progress}%` }} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div
          className="duplicate-analysis-content"
          role="tabpanel"
          id={`duplicate-analysis-panel-${activeItem.id}`}
          aria-labelledby={`duplicate-analysis-tab-${activeItem.id}`}
        >
          {activeItem.id === 'metadata' ? (
            <DuplicateMetadataPane analysis={metadataAnalysis} bidFiles={bidFiles} />
          ) : activeItem.id === 'outline' ? (
            <DuplicateOutlinePane analysis={outlineAnalysis} bidFiles={bidFiles} />
          ) : activeItem.id === 'content' ? (
            <DuplicateContentPane analysis={contentAnalysis} bidFiles={bidFiles} />
          ) : activeItem.id === 'image' ? (
            <DuplicateImagePane analysis={imageAnalysis} bidFiles={bidFiles} />
          ) : activeItem.id === 'summary' ? (
            <DuplicateSummaryPane
              record={summaryRecord}
              historyViewMode={historyViewMode}
              onRegenerateSummary={onRegenerateSummary}
            />
          ) : (
            <>
              <span className="section-kicker">{activeItem.label}</span>
              <h3>{activeItem.label}查重结果区域</h3>
              <p>这里先保留内容骨架，后续接入查重任务后展示分析日志、重复项列表和处理结果。</p>
            </>
          )}
        </div>
      </section>
    </section>
  );
}

function DuplicateCheckPage() {
  const [activeProjectId, setActiveProjectId] = useState(() => workspaceStorage.load()?.activeProjectId || '');
  const [projectSummaries, setProjectSummaries] = useState<DuplicateCheckProjectSummary[]>([]);
  const [projectKeyword, setProjectKeyword] = useState('');
  const [projectStatusFilter, setProjectStatusFilter] = useState<DuplicateProjectStatusFilter>('in-progress');
  const [projectLoading, setProjectLoading] = useState(false);
  const [uploadGuideCollapsed, setUploadGuideCollapsed] = useState(loadUploadGuideCollapsedPreference);
  const [tenderFile, setTenderFile] = useState<LocalFileSelection | null>(null);
  const [bidFiles, setBidFiles] = useState<LocalFileSelection[]>([]);
  const [step, setStep] = useState<DuplicateCheckStep>('management');
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<DuplicateAnalysisTabId>(defaultAnalysisTab);
  const [metadataAnalysis, setMetadataAnalysis] = useState<DuplicateMetadataAnalysisState | undefined>();
  const [outlineAnalysis, setOutlineAnalysis] = useState<DuplicateOutlineAnalysisState | undefined>();
  const [contentAnalysis, setContentAnalysis] = useState<DuplicateContentAnalysisState | undefined>();
  const [imageAnalysis, setImageAnalysis] = useState<DuplicateImageAnalysisState | undefined>();
  const [historyRecords, setHistoryRecords] = useState<DuplicateHistoryRecord[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState('');
  const [historyViewMode, setHistoryViewMode] = useState<DuplicateHistoryViewMode>('current');
  const [historyKeyword, setHistoryKeyword] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<DuplicateHistoryStatusFilter>('all');
  const [busy, setBusy] = useState<'tender' | 'bid' | null>(null);
  const [duplicateDragActive, setDuplicateDragActive] = useState<'tender' | 'bid' | null>(null);
  const startedMetadataSignatureRef = useRef<string | null>(null);
  const currentAnalysisSignatureRef = useRef('');
  const openUploadAfterProjectSwitchRef = useRef(false);
  const hydratedRef = useRef(false);
  const documentParseNoticeIdsRef = useRef(new Set<string>());
  const summaryRunningRef = useRef(new Set<string>());
  const summaryStreamCancelRef = useRef(new Map<string, () => void>());
  const summaryPendingChunksRef = useRef(new Map<string, string>());
  const summaryFlushTimersRef = useRef(new Map<string, number>());
  const { showToast } = useToast();
  const { showDocumentParseNotice } = useDocumentParseNotice();

  const totalSize = useMemo(() => bidFiles.reduce((sum, file) => sum + file.size, tenderFile?.size || 0), [bidFiles, tenderFile]);
  const canGoNext = step === 'management' ? Boolean(activeProjectId) : bidFiles.length > 0;
  const activeIndex = steps.indexOf(step);
  const isNextDisabled = activeIndex >= steps.length - 1 || !canGoNext;
  const nextTooltip = activeIndex >= steps.length - 1
    ? '当前已经是最后一步'
    : canGoNext
      ? `进入${stepLabels[steps[activeIndex + 1]]}`
      : step === 'management'
        ? '请先在查重管理中选择一个项目'
        : '请先上传至少一份投标文件';

  const loadProjectSummaries = () => {
    setProjectLoading(true);
    return window.bidmind?.duplicateCheck.listProjectSummaries()
      .then((result) => {
        const projects = Array.isArray(result?.projects) ? result.projects : [];
        setProjectSummaries(projects);
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : '读取查重项目列表失败', 'error');
      })
      .finally(() => {
        setProjectLoading(false);
      });
  };

  useEffect(() => {
    void loadProjectSummaries();
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    void loadProjectSummaries();
  }, [activeProjectId, historyRecords.length]);

  useEffect(() => {
    try {
      localStorage.setItem(DUPLICATE_UPLOAD_GUIDE_COLLAPSED_KEY, uploadGuideCollapsed ? '1' : '0');
    } catch {
      // 忽略本地存储不可用场景
    }
  }, [uploadGuideCollapsed]);

  useEffect(() => {
    let canceled = false;
    const openUpload = openUploadAfterProjectSwitchRef.current;
    openUploadAfterProjectSwitchRef.current = false;
    hydratedRef.current = false;
    startedMetadataSignatureRef.current = null;
    cancelAllSummaryStreams();
    setTenderFile(null);
    setBidFiles([]);
    setMetadataAnalysis(undefined);
    setOutlineAnalysis(undefined);
    setContentAnalysis(undefined);
    setImageAnalysis(undefined);
    setHistoryRecords([]);
    setSelectedHistoryId('');
    setHistoryViewMode('current');
    setStep(openUpload && activeProjectId ? 'upload' : 'management');

    if (!activeProjectId) {
      hydratedRef.current = true;
      return () => {
        canceled = true;
        cancelAllSummaryStreams();
      };
    }

    void window.bidmind?.workspace.loadDuplicateCheck()
      .then((state) => {
        if (canceled || !state) return;
        setTenderFile(state.tenderFile || null);
        setBidFiles(Array.isArray(state.bidFiles) ? state.bidFiles : []);
        if (openUpload) {
          setStep('upload');
        } else {
          setStep('management');
        }
        setActiveAnalysisTab(analysisTabs.some((item) => item.id === state.activeAnalysisTab) ? state.activeAnalysisTab as DuplicateAnalysisTabId : defaultAnalysisTab);
        setMetadataAnalysis(state.metadataAnalysis);
        setOutlineAnalysis(state.outlineAnalysis);
        setContentAnalysis(state.contentAnalysis);
        setImageAnalysis(state.imageAnalysis);
        setHistoryRecords(normalizeHistoryRecords(state.historyRecords));
        setSelectedHistoryId(String(state.selectedHistoryId || ''));
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : '读取标书查重缓存失败', 'error');
      })
      .finally(() => {
        if (!canceled) {
          hydratedRef.current = true;
        }
      });

    return () => {
      canceled = true;
      cancelAllSummaryStreams();
    };
  }, [activeProjectId, showToast]);

  useEffect(() => () => {
    cancelAllSummaryStreams();
  }, []);

  useEffect(() => {
    if (!hydratedRef.current || !activeProjectId || step === 'management') return;

    const state: DuplicateCheckWorkspaceState = {
      tenderFile,
      bidFiles,
      step,
      activeAnalysisTab,
      metadataAnalysis,
      outlineAnalysis,
      contentAnalysis,
      imageAnalysis,
      historyRecords,
      selectedHistoryId,
    };
    void window.bidmind?.workspace.saveDuplicateCheck(state)
      .catch((error) => {
        showToast(error instanceof Error ? error.message : '保存标书查重缓存失败', 'error');
      });
  }, [activeAnalysisTab, activeProjectId, bidFiles, metadataAnalysis, outlineAnalysis, contentAnalysis, imageAnalysis, historyRecords, selectedHistoryId, showToast, step, tenderFile]);

  useEffect(() => {
    const unsubscribe = window.bidmind?.duplicateCheck?.onEvent?.((event) => {
      if (!event?.duplicateCheck) return;
      if (!activeProjectId) return;
      const eventProjectId = String(event.project_id || '');
      if (eventProjectId !== activeProjectId) return;
      const eventSignature = event.duplicateCheck.metadataAnalysis?.signature
        || event.duplicateCheck.outlineAnalysis?.signature
        || event.duplicateCheck.contentAnalysis?.signature
        || event.duplicateCheck.imageAnalysis?.signature;
      if (eventSignature && eventSignature !== currentAnalysisSignatureRef.current) return;
      event.duplicateCheck.metadataAnalysis?.contentFiles?.forEach((file) => {
        const noticeId = `content:${file.file_id}`;
        if (file.status === 'error'
          && isLibreOfficeRequiredMessage(file.error)
          && !documentParseNoticeIdsRef.current.has(noticeId)) {
          documentParseNoticeIdsRef.current.add(noticeId);
          showDocumentParseNotice(file.error);
        }
      });
      setMetadataAnalysis(event.duplicateCheck.metadataAnalysis);
      setOutlineAnalysis(event.duplicateCheck.outlineAnalysis);
      setContentAnalysis(event.duplicateCheck.contentAnalysis);
      setImageAnalysis(event.duplicateCheck.imageAnalysis);
    });
    return () => unsubscribe?.();
  }, [activeProjectId, showDocumentParseNotice]);

  const currentAnalysisSignature = useMemo(() => {
    const files: LocalFileSelection[] = tenderFile ? [tenderFile, ...bidFiles] : bidFiles;
    return createDuplicateCheckSignature(files);
  }, [bidFiles, tenderFile]);

  useEffect(() => {
    currentAnalysisSignatureRef.current = currentAnalysisSignature;
  }, [currentAnalysisSignature]);

  const selectedHistoryRecord = useMemo(
    () => historyRecords.find((item) => item.id === selectedHistoryId) || null,
    [historyRecords, selectedHistoryId]
  );

  const filteredHistoryRecords = useMemo(() => {
    const keyword = historyKeyword.trim().toLowerCase();
    return historyRecords.filter((record) => {
      if (historyStatusFilter !== 'all' && record.status !== historyStatusFilter) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const searchable = [
        record.title,
        record.tenderFileName || '',
        ...(record.bidFileNames || []),
        record.aiSummary || '',
      ].join('\n').toLowerCase();
      return searchable.includes(keyword);
    });
  }, [historyKeyword, historyRecords, historyStatusFilter]);

  const activeProjectSummary = useMemo(
    () => projectSummaries.find((item) => item.project_id === activeProjectId) || null,
    [activeProjectId, projectSummaries]
  );

  const cancelSummaryStream = (historyId: string) => {
    const timer = summaryFlushTimersRef.current.get(historyId);
    if (timer) {
      window.clearTimeout(timer);
      summaryFlushTimersRef.current.delete(historyId);
    }
    summaryPendingChunksRef.current.delete(historyId);
    const cancel = summaryStreamCancelRef.current.get(historyId);
    if (cancel) {
      cancel();
    }
    summaryStreamCancelRef.current.delete(historyId);
    summaryRunningRef.current.delete(historyId);
  };

  const cancelAllSummaryStreams = () => {
    summaryFlushTimersRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    summaryFlushTimersRef.current.clear();
    summaryPendingChunksRef.current.clear();
    const activeIds = Array.from(summaryStreamCancelRef.current.keys());
    activeIds.forEach((historyId) => {
      summaryStreamCancelRef.current.get(historyId)?.();
    });
    summaryStreamCancelRef.current.clear();
    summaryRunningRef.current.clear();
  };

  useEffect(() => {
    const source = historyViewMode === 'history' ? filteredHistoryRecords : historyRecords;
    if (selectedHistoryId && source.some((item) => item.id === selectedHistoryId)) {
      return;
    }
    if (source.length > 0) {
      setSelectedHistoryId(source[0].id);
      return;
    }
    if (historyViewMode === 'history') {
      setSelectedHistoryId('');
      return;
    }
    setSelectedHistoryId(historyRecords[0]?.id || '');
  }, [filteredHistoryRecords, historyRecords, historyViewMode, selectedHistoryId]);

  useEffect(() => {
    if (!currentAnalysisSignature) return;
    if (!metadataAnalysis || !outlineAnalysis || !contentAnalysis || !imageAnalysis) return;
    if (!isTerminalStatus(metadataAnalysis.status)
      || !isTerminalStatus(outlineAnalysis.status)
      || !isTerminalStatus(contentAnalysis.status)
      || !isTerminalStatus(imageAnalysis.status)) {
      return;
    }

    setHistoryRecords((prev) => {
      const existing = prev.find((item) => item.signature === currentAnalysisSignature);
      const nextRecord = buildHistoryRecord({
        signature: currentAnalysisSignature,
        tenderFile,
        bidFiles,
        metadataAnalysis,
        outlineAnalysis,
        contentAnalysis,
        imageAnalysis,
        prev: existing,
      });
      return upsertHistoryRecord(prev, nextRecord);
    });
  }, [bidFiles, contentAnalysis, currentAnalysisSignature, imageAnalysis, metadataAnalysis, outlineAnalysis, tenderFile]);

  useEffect(() => {
    if (!historyRecords.length) return;
    const target = historyRecords.find((item) => isTerminalStatus(item.status)
      && !item.aiSummary
      && item.aiSummaryStatus !== 'running'
      && item.aiSummaryStatus !== 'error'
      && !summaryRunningRef.current.has(item.id));
    if (!target) return;

    summaryRunningRef.current.add(target.id);
    setHistoryRecords((prev) => prev.map((item) => (item.id === target.id
      ? {
        ...item,
        aiSummary: '',
        aiSummaryStatus: 'running',
        aiSummaryError: undefined,
      }
      : item)));

    const streamChat = window.bidmind?.ai.streamChat;
    if (!streamChat) {
      summaryRunningRef.current.delete(target.id);
      setHistoryRecords((prev) => prev.map((item) => (item.id === target.id
        ? {
          ...item,
          aiSummaryStatus: 'error',
          aiSummaryError: '当前环境不支持流式摘要',
        }
        : item)));
      return;
    }

    let completed = false;

    const flushSummaryChunk = () => {
      const pendingChunk = summaryPendingChunksRef.current.get(target.id);
      if (!pendingChunk) return;
      summaryPendingChunksRef.current.delete(target.id);
      setHistoryRecords((prev) => prev.map((item) => (item.id === target.id
        ? {
          ...item,
          aiSummary: `${item.aiSummary || ''}${pendingChunk}`,
          aiSummaryStatus: 'running',
          aiSummaryError: undefined,
          updated_at: new Date().toISOString(),
        }
        : item)));
    };

    const scheduleSummaryChunkFlush = () => {
      if (summaryFlushTimersRef.current.has(target.id)) {
        return;
      }
      const timer = window.setTimeout(() => {
        summaryFlushTimersRef.current.delete(target.id);
        flushSummaryChunk();
      }, DUPLICATE_SUMMARY_FLUSH_INTERVAL_MS);
      summaryFlushTimersRef.current.set(target.id, timer);
    };

    const clearSummaryChunkFlush = () => {
      const timer = summaryFlushTimersRef.current.get(target.id);
      if (timer) {
        window.clearTimeout(timer);
        summaryFlushTimersRef.current.delete(target.id);
      }
      summaryPendingChunksRef.current.delete(target.id);
    };

    const completeStream = () => {
      if (completed) return;
      completed = true;
      clearSummaryChunkFlush();
      summaryRunningRef.current.delete(target.id);
      summaryStreamCancelRef.current.delete(target.id);
    };

    const handleError = (message?: string) => {
      flushSummaryChunk();
      completeStream();
      setHistoryRecords((prev) => prev.map((item) => (item.id === target.id
        ? {
          ...item,
          aiSummaryStatus: 'error',
          aiSummaryError: message || '摘要生成失败',
          updated_at: new Date().toISOString(),
        }
        : item)));
    };

    const handleDone = () => {
      flushSummaryChunk();
      completeStream();
      setHistoryRecords((prev) => prev.map((item) => {
        if (item.id !== target.id) return item;
        const summaryText = String(item.aiSummary || '').trim();
        return {
          ...item,
          aiSummary: summaryText || '未返回有效摘要。',
          aiSummaryStatus: 'success',
          aiSummaryError: undefined,
          updated_at: new Date().toISOString(),
        };
      }));
    };

    try {
      const cancel = streamChat({
        temperature: 0.3,
        messages: [
          { role: 'system', content: '你是专业的标书查重复核顾问，擅长总结风险和给出整改建议。' },
          { role: 'user', content: buildAiSummaryPrompt(target) },
        ],
      }, (event) => {
        if (event.type === 'chunk') {
          const chunk = String(event.chunk || '');
          if (!chunk) return;
          const pendingChunk = summaryPendingChunksRef.current.get(target.id) || '';
          summaryPendingChunksRef.current.set(target.id, `${pendingChunk}${chunk}`);
          scheduleSummaryChunkFlush();
          return;
        }
        if (event.type === 'error') {
          handleError(event.message || '摘要生成失败');
          return;
        }
        if (event.type === 'done') {
          handleDone();
        }
      });

      summaryStreamCancelRef.current.set(target.id, () => {
        cancel?.();
        completeStream();
      });
    } catch (error) {
      handleError(error instanceof Error ? error.message : '摘要生成失败');
    }
  }, [historyRecords]);

  const removeHistoryRecord = (historyId: string) => {
    const target = historyRecords.find((item) => item.id === historyId);
    if (!target) {
      showToast('未找到对应历史记录', 'info');
      return;
    }
    cancelSummaryStream(historyId);
    setHistoryRecords((prev) => prev.filter((item) => item.id !== historyId));
    if (historyRecords.length <= 1) {
      setHistoryViewMode('current');
      setSelectedHistoryId('');
    }
    showToast(`已删除历史记录：${target.title}`, 'success');
  };

  const clearHistoryRecords = () => {
    if (!historyRecords.length) {
      showToast('暂无可清空的历史记录', 'info');
      return;
    }
    cancelAllSummaryStreams();
    setHistoryRecords([]);
    setHistoryViewMode('current');
    setSelectedHistoryId('');
    setHistoryKeyword('');
    setHistoryStatusFilter('all');
    showToast('已清空标书查重历史记录', 'success');
  };

  const exportHistoryRecord = (historyId: string) => {
    const target = historyRecords.find((item) => item.id === historyId);
    if (!target) {
      showToast('未找到需要导出的历史记录', 'error');
      return;
    }
    const report = buildHistoryReport(target);
    const timestamp = target.updated_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const fileName = `${sanitizeDownloadName(target.title)}-查重报告-${timestamp}.md`;
    downloadText(report, fileName);
    showToast('查重历史报告已导出', 'success');
  };

  const regenerateSummary = (historyId: string) => {
    cancelSummaryStream(historyId);
    setHistoryRecords((prev) => prev.map((item) => (item.id === historyId
      ? {
        ...item,
        aiSummary: '',
        aiSummaryStatus: 'idle',
        aiSummaryError: undefined,
      }
      : item)));
    showToast('已提交摘要重试任务', 'info');
  };

  const selectProject = (projectId: string) => {
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId) {
      showToast('项目 ID 无效', 'error');
      return;
    }
    workspaceStorage.save({
      activeProjectId: normalizedProjectId,
      activeSection: 'duplicate-check',
    });
    openUploadAfterProjectSwitchRef.current = true;
    setActiveProjectId(normalizedProjectId);
    setStep('upload');
    showToast('已进入查重项目，可继续上传文件', 'success');
  };

  const createDuplicateProject = (payload: { name: string; code: string; workbench: 'technical-plan' | 'business-bid' }) => {
    if (!payload.name) {
      showToast('请输入项目名称', 'error');
      return;
    }
    const now = new Date().toISOString();
    const newProject = {
      id: createProjectId(),
      name: payload.name,
      code: payload.code,
      owner: '',
      workbench: payload.workbench,
      status: 'in-progress' as const,
      created_at: now,
      updated_at: now,
    };

    void window.bidmind?.workspace.loadProjects()
      .then((state) => {
        const projects = Array.isArray(state?.projects) ? state.projects : [];
        return window.bidmind?.workspace.saveProjects({
          projects: [newProject, ...projects],
        });
      })
      .then(() => {
        showToast('查重项目已创建', 'success');
        selectProject(newProject.id);
        return loadProjectSummaries();
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : '创建查重项目失败', 'error');
      });
  };

  const updateDuplicateProjectStatus = (projectId: string, nextStatus: 'in-progress' | 'completed' | 'deleted') => {
    void window.bidmind?.workspace.loadProjects()
      .then((state) => {
        const projects = Array.isArray(state?.projects) ? state.projects : [];
        const exists = projects.some((item) => item.id === projectId);
        if (!exists) {
          throw new Error('未找到项目');
        }
        return window.bidmind?.workspace.saveProjects({
          projects: projects.map((item) => (item.id === projectId
            ? { ...item, status: nextStatus, updated_at: new Date().toISOString() }
            : item)),
        });
      })
      .then(() => {
        if (nextStatus === 'deleted' && activeProjectId === projectId) {
          workspaceStorage.save({
            activeProjectId: '',
            activeSection: 'duplicate-check',
          });
          setActiveProjectId('');
          setStep('management');
        }
        showToast(
          nextStatus === 'deleted' ? '项目已移至回收站' : nextStatus === 'completed' ? '项目已标记为完成' : '项目已恢复为进行中',
          'success'
        );
        return loadProjectSummaries();
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : '更新项目状态失败', 'error');
      });
  };

  const removeDuplicateProject = (projectId: string) => {
    void window.bidmind?.workspace.loadProjects()
      .then((state) => {
        const projects = Array.isArray(state?.projects) ? state.projects : [];
        const nextProjects = projects.filter((item) => item.id !== projectId);
        if (nextProjects.length === projects.length) {
          throw new Error('未找到项目');
        }
        return window.bidmind?.workspace.saveProjects({ projects: nextProjects });
      })
      .then(() => {
        if (activeProjectId === projectId) {
          workspaceStorage.save({
            activeProjectId: '',
            activeSection: 'duplicate-check',
          });
          setActiveProjectId('');
          setStep('management');
        }
        showToast('项目已彻底删除', 'success');
        return loadProjectSummaries();
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : '删除项目失败', 'error');
      });
  };

  const displayMetadataAnalysis = historyViewMode === 'history' ? selectedHistoryRecord?.metadataAnalysis : metadataAnalysis;
  const displayOutlineAnalysis = historyViewMode === 'history' ? selectedHistoryRecord?.outlineAnalysis : outlineAnalysis;
  const displayContentAnalysis = historyViewMode === 'history' ? selectedHistoryRecord?.contentAnalysis : contentAnalysis;
  const displayImageAnalysis = historyViewMode === 'history' ? selectedHistoryRecord?.imageAnalysis : imageAnalysis;
  const displayBidFiles = historyViewMode === 'history' ? (selectedHistoryRecord?.bidFiles || []) : bidFiles;
  const currentSummaryRecord = useMemo(
    () => historyRecords.find((item) => item.signature === currentAnalysisSignature) || null,
    [currentAnalysisSignature, historyRecords]
  );
  const displaySummaryRecord = historyViewMode === 'history' ? selectedHistoryRecord : currentSummaryRecord;

  const startMetadataAnalysis = (force = false) => {
    if (!activeProjectId) {
      showToast('请先在查重管理中选择项目', 'info');
      setStep('management');
      return;
    }
    if (!bidFiles.length) {
      showToast('请先上传至少一份投标文件', 'info');
      return;
    }
    if (force) {
      startedMetadataSignatureRef.current = null;
      setMetadataAnalysis(undefined);
      setOutlineAnalysis(undefined);
      setContentAnalysis(undefined);
      setImageAnalysis(undefined);
    }
    setHistoryViewMode('current');
    startedMetadataSignatureRef.current = currentAnalysisSignature;
    void window.bidmind?.duplicateCheck?.startMetadataAnalysis({ tenderFile, bidFiles, force })
      .then((analysis) => {
        if (analysis) setMetadataAnalysis(analysis);
      })
      .catch((error) => {
        startedMetadataSignatureRef.current = null;
        const message = error instanceof Error ? error.message : '启动元数据分析失败';
        if (isLibreOfficeRequiredMessage(message)) {
          showDocumentParseNotice(message);
          return;
        }
        showToast(message, 'error');
      });
  };

  useEffect(() => {
    if (step !== 'analysis' || !bidFiles.length) return;
    if (metadataAnalysis?.status === 'success'
      && metadataAnalysis.signature
      && outlineAnalysis?.status === 'success'
      && contentAnalysis?.status === 'success'
      && imageAnalysis?.status === 'success') return;
    if (startedMetadataSignatureRef.current === currentAnalysisSignature) return;
    startMetadataAnalysis(false);
  }, [activeProjectId, bidFiles, contentAnalysis?.status, currentAnalysisSignature, imageAnalysis?.status, metadataAnalysis?.signature, metadataAnalysis?.status, outlineAnalysis?.status, showToast, step, tenderFile]);

  const selectFiles = async (multiple: boolean) => {
    const selector = window.bidmind?.file?.selectDuplicateCheckFiles;
    if (typeof selector !== 'function') {
      throw new Error('文件选择接口尚未加载，请重启应用后重试');
    }
    return selector({ multiple });
  };

  const selectDroppedFiles = async (files: File[]) => {
    const selector = window.bidmind?.file?.selectDuplicateCheckFileList;
    if (typeof selector !== 'function') {
      throw new Error('当前环境暂不支持拖拽上传，请点击上传按钮选择文件');
    }
    return selector(files);
  };

  const resetDuplicateAnalysis = () => {
    setMetadataAnalysis(undefined);
    setOutlineAnalysis(undefined);
    setContentAnalysis(undefined);
    setImageAnalysis(undefined);
    setHistoryViewMode('current');
    startedMetadataSignatureRef.current = null;
  };

  const uploadTenderFile = async () => {
    try {
      setBusy('tender');
      const result = await selectFiles(false);
      if (!result?.success || !result.files?.length) {
        const message = result?.message || '未选择招标文件';
        if (isLibreOfficeRequiredMessage(message)) {
          showDocumentParseNotice(message);
          return;
        }
        showToast(message, message === '已取消选择' ? 'info' : 'error');
        return;
      }
      setTenderFile(result.files[0]);
      resetDuplicateAnalysis();
      showToast('招标文件已加入，暂不执行解析', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '选择招标文件失败';
      if (isLibreOfficeRequiredMessage(message)) {
        showDocumentParseNotice(message);
        return;
      }
      showToast(message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const uploadBidFiles = async () => {
    try {
      setBusy('bid');
      const result = await selectFiles(true);
      if (!result?.success || !result.files?.length) {
        const message = result?.message || '未选择投标文件';
        if (isLibreOfficeRequiredMessage(message)) {
          showDocumentParseNotice(message);
          return;
        }
        showToast(message, message === '已取消选择' ? 'info' : 'error');
        return;
      }

      const exists = new Set(bidFiles.map((file) => file.file_path));
      const nextFiles = result.files.filter((file) => !exists.has(file.file_path));
      if (nextFiles.length < result.files.length) {
        showToast('已跳过重复选择的投标文件', 'info');
      }
      setBidFiles((prev) => [...prev, ...nextFiles]);
      if (nextFiles.length > 0) {
        resetDuplicateAnalysis();
        showToast('投标文件已加入，暂不执行解析', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '选择投标文件失败';
      if (isLibreOfficeRequiredMessage(message)) {
        showDocumentParseNotice(message);
        return;
      }
      showToast(message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const uploadDroppedDuplicateFiles = async (target: 'tender' | 'bid', droppedFiles: File[]) => {
    const files = droppedFiles.filter((file) => /\.(docx?|wps|pdf|md|markdown)$/i.test(file.name));
    if (!files.length) {
      showToast('仅支持 Word / WPS / PDF / Markdown 文件', 'info');
      return;
    }

    try {
      setBusy(target);
      const result = await selectDroppedFiles(target === 'tender' ? files.slice(0, 1) : files);
      if (!result?.success || !result.files?.length) {
        const message = result?.message || '未选择文件';
        if (isLibreOfficeRequiredMessage(message)) {
          showDocumentParseNotice(message);
          return;
        }
        showToast(message, message === '已取消选择' ? 'info' : 'error');
        return;
      }

      if (target === 'tender') {
        setTenderFile(result.files[0]);
        resetDuplicateAnalysis();
        showToast('招标文件已加入，暂不执行解析', 'success');
        return;
      }

      const exists = new Set(bidFiles.map((file) => file.file_path));
      const nextFiles = result.files.filter((file) => !exists.has(file.file_path));
      if (nextFiles.length < result.files.length) {
        showToast('已跳过重复选择的投标文件', 'info');
      }
      if (nextFiles.length) {
        setBidFiles((prev) => [...prev, ...nextFiles]);
        resetDuplicateAnalysis();
        showToast('投标文件已加入，暂不执行解析', 'success');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '上传文件失败';
      if (isLibreOfficeRequiredMessage(message)) {
        showDocumentParseNotice(message);
        return;
      }
      showToast(message, 'error');
    } finally {
      setBusy(null);
      setDuplicateDragActive(null);
    }
  };

  const handleDuplicateDragOver = (target: 'tender' | 'bid') => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDuplicateDragActive(target);
  };

  const handleDuplicateDragLeave = (target: 'tender' | 'bid') => (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDuplicateDragActive((current) => (current === target ? null : current));
    }
  };

  const handleDuplicateDrop = (target: 'tender' | 'bid') => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDuplicateDragActive(null);
    void uploadDroppedDuplicateFiles(target, Array.from(event.dataTransfer.files || []));
  };

  const resetFiles = () => {
    setTenderFile(null);
    setBidFiles([]);
    setStep(activeProjectId ? 'upload' : 'management');
    setActiveAnalysisTab(defaultAnalysisTab);
    setHistoryViewMode('current');
    setMetadataAnalysis(undefined);
    setOutlineAnalysis(undefined);
    setContentAnalysis(undefined);
    setImageAnalysis(undefined);
    startedMetadataSignatureRef.current = null;
    showToast('已重置上传列表', 'success');
  };

  const switchStep = (nextStep: DuplicateCheckStep) => {
    if ((nextStep === 'upload' || nextStep === 'analysis') && !activeProjectId) {
      setStep('management');
      showToast('请先在查重管理中选择项目', 'info');
      return;
    }
    setStep(nextStep);
  };

  const goToOffset = (offset: number) => {
    const nextStep = steps[activeIndex + offset];
    if (!nextStep) return;
    switchStep(nextStep);
  };

  const toolbarGroups: FloatingToolbarGroup[] = [
    {
      id: 'duplicate-check-reset',
      actions: [
        {
          id: 'reset',
          label: '重置',
          variant: 'danger',
          tooltip: '清空当前标书查重流程',
          onClick: resetFiles,
        },
        {
          id: 'home',
          label: '管理',
          variant: step === 'management' ? 'primary' : 'secondary',
          tooltip: '回到查重管理',
          onClick: () => switchStep('management'),
        },
      ],
    },
    {
      id: 'duplicate-check-navigation',
      actions: [
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
          variant: 'primary',
          disabled: isNextDisabled,
          tooltip: nextTooltip,
          onClick: () => goToOffset(1),
        },
      ],
    },
  ];

  return (
    <div className="duplicate-check-page">
      {step === 'upload' && activeProjectSummary ? (
        <section className="project-context-banner">
          <span className="section-kicker">当前查重项目</span>
          <strong>{activeProjectSummary.project_name}</strong>
          <small>
            {activeProjectSummary.project_code ? `编号：${activeProjectSummary.project_code} · ` : ''}
            历史记录：{historyRecords.length} 条
          </small>
        </section>
      ) : null}
      {step === 'management' ? (
        <DuplicateProjectManagementPane
          activeProjectId={activeProjectId}
          projects={projectSummaries}
          loading={projectLoading}
          keyword={projectKeyword}
          statusFilter={projectStatusFilter}
          onKeywordChange={setProjectKeyword}
          onStatusFilterChange={setProjectStatusFilter}
          onSelectProject={selectProject}
          onCreateProject={createDuplicateProject}
          onUpdateProjectStatus={updateDuplicateProjectStatus}
          onRemoveProject={removeDuplicateProject}
          onRefresh={() => {
            void loadProjectSummaries();
          }}
        />
      ) : step === 'upload' ? (
        <div className="duplicate-upload-layout">
          <section className={`duplicate-guide-panel ${uploadGuideCollapsed ? 'is-collapsed' : ''}`}>
            <div className="duplicate-guide-head">
              <div>
                <strong>多维度筛查重复项</strong>
              </div>
              <button
                type="button"
                className="secondary-action duplicate-guide-toggle"
                onClick={() => setUploadGuideCollapsed((prev) => !prev)}
                aria-expanded={!uploadGuideCollapsed}
              >
                {uploadGuideCollapsed ? '展开说明' : '收起说明'}
              </button>
            </div>

            {!uploadGuideCollapsed ? (
              <div className="duplicate-guide-panel-body">
                <div className="duplicate-dimension-grid">
                  {dimensions.map((item) => (
                    <article key={item.title}>
                      <strong>{item.title}</strong>
                      <p>{item.text}</p>
                    </article>
                  ))}
                </div>

                <ul className="duplicate-guide-list">
                  {guideItems.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="duplicate-upload-board">
            <div className="duplicate-page-title">
              <div>
                <span className="section-kicker">STEP 02</span>
                <h2>选择标书</h2>
                <p>拖拽或点击上传文件，系统会在进入下一步后执行元数据、目录、正文和图片查重。</p>
              </div>
              <div className="duplicate-upload-summary">
                <span>{tenderFile ? '1 份招标文件' : '未上传招标文件'}</span>
                <strong>{bidFiles.length} 份投标文件</strong>
                <small>{formatFileSize(totalSize)}</small>
              </div>
            </div>

            <div className="duplicate-upload-stack">
              <article
                className={`duplicate-upload-row duplicate-upload-drop-card ${tenderFile ? 'has-files' : ''} ${duplicateDragActive === 'tender' ? 'is-drag-active' : ''}`}
                onClick={uploadTenderFile}
                onDragOver={handleDuplicateDragOver('tender')}
                onDragLeave={handleDuplicateDragLeave('tender')}
                onDrop={handleDuplicateDrop('tender')}
              >
                <div className="duplicate-upload-label">
                  <span className="duplicate-upload-step">01</span>
                  <i className="duplicate-upload-illustration is-tender" aria-hidden="true" />
                  <strong>招标文件</strong>
                  <small>可选，仅一份</small>
                </div>
                <div className="duplicate-upload-content">
                  {tenderFile ? (
                    <>
                      <FilePill file={tenderFile} onRemove={() => {
                        setTenderFile(null);
                        setMetadataAnalysis(undefined);
                        setOutlineAnalysis(undefined);
                        setContentAnalysis(undefined);
                        setImageAnalysis(undefined);
                        startedMetadataSignatureRef.current = null;
                      }} />
                      <div className="duplicate-upload-continue-hint">
                        <span aria-hidden="true" />
                        <strong>点击本卡片可替换招标文件</strong>
                        <small>也可以直接把新文件拖到这里。</small>
                      </div>
                    </>
                  ) : (
                    <button type="button" className="duplicate-empty-upload" disabled={busy !== null}>
                      <span className="duplicate-empty-upload-icon" aria-hidden="true" />
                      <strong>拖动招标文件到此处，或点击上传</strong>
                      <small>用于排除招标文件原文造成的误判，可不上传</small>
                    </button>
                  )}
                </div>
              </article>

              <article
                className={`duplicate-upload-row duplicate-upload-drop-card bid-row ${bidFiles.length ? 'has-files' : ''} ${duplicateDragActive === 'bid' ? 'is-drag-active' : ''}`}
                onClick={uploadBidFiles}
                onDragOver={handleDuplicateDragOver('bid')}
                onDragLeave={handleDuplicateDragLeave('bid')}
                onDrop={handleDuplicateDrop('bid')}
              >
                <div className="duplicate-upload-label">
                  <span className="duplicate-upload-step">02</span>
                  <i className="duplicate-upload-illustration is-bid" aria-hidden="true" />
                  <strong>投标文件</strong>
                  <small>必选，可多份</small>
                </div>
                <div className="duplicate-upload-content">
                  {bidFiles.length ? (
                    <>
                      <div className="duplicate-file-list">
                        {bidFiles.map((file) => (
                          <FilePill key={file.file_path} file={file} onRemove={() => {
                            setBidFiles((prev) => prev.filter((item) => item.file_path !== file.file_path));
                            setMetadataAnalysis(undefined);
                            setOutlineAnalysis(undefined);
                            setContentAnalysis(undefined);
                            setImageAnalysis(undefined);
                            startedMetadataSignatureRef.current = null;
                          }} />
                        ))}
                      </div>
                      <div className="duplicate-upload-continue-hint">
                        <span aria-hidden="true" />
                        <strong>可继续上传投标文件</strong>
                        <small>点击本卡片继续选择，或把更多标书拖到这里追加。</small>
                      </div>
                    </>
                  ) : (
                    <button type="button" className="duplicate-empty-upload" disabled={busy !== null}>
                      <span className="duplicate-empty-upload-icon" aria-hidden="true" />
                      <strong>拖动投标文件到此处，或点击批量上传</strong>
                      <small>支持多份标书同时上传，建议至少 2 份进行查重</small>
                    </button>
                  )}
                </div>
              </article>
            </div>
          </section>
        </div>
      ) : (
        <DuplicateAnalysisPane
          activeTab={activeAnalysisTab}
          onTabChange={setActiveAnalysisTab}
          metadataAnalysis={displayMetadataAnalysis}
          outlineAnalysis={displayOutlineAnalysis}
          contentAnalysis={displayContentAnalysis}
          imageAnalysis={displayImageAnalysis}
          bidFiles={displayBidFiles}
          onRerun={() => startMetadataAnalysis(true)}
          historyRecords={historyRecords}
          filteredHistoryRecords={filteredHistoryRecords}
          selectedHistoryId={selectedHistoryId}
          selectedHistoryRecord={selectedHistoryRecord}
          historyViewMode={historyViewMode}
          onSelectHistory={setSelectedHistoryId}
          onHistoryViewModeChange={setHistoryViewMode}
          historyKeyword={historyKeyword}
          onHistoryKeywordChange={setHistoryKeyword}
          historyStatusFilter={historyStatusFilter}
          onHistoryStatusFilterChange={setHistoryStatusFilter}
          onDeleteHistoryRecord={removeHistoryRecord}
          onClearHistoryRecords={clearHistoryRecords}
          onExportHistoryRecord={exportHistoryRecord}
          onRegenerateSummary={regenerateSummary}
          summaryRecord={displaySummaryRecord}
        />
      )}

      <FloatingToolbar groups={toolbarGroups} label="标书查重工具条" />
    </div>
  );
}

export default DuplicateCheckPage;
