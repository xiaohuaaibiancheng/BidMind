import { useEffect, useMemo, useState } from 'react';
import { isLibreOfficeRequiredMessage, MarkdownRenderer, useDocumentParseNotice, useToast } from '../../../shared/ui';
import type { FileParserProvider } from '../../../shared/types';

const LARGE_MARKDOWN_THRESHOLD = 120_000;
const FAST_PREVIEW_LINE_BATCH = 260;
const parseHints = [
  '正在读取文件内容',
  '正在解析正文结构',
  '正在整理 Markdown 预览',
];

const parserLabels: Record<FileParserProvider, string> = {
  local: '本地解析',
  'mineru-accurate-api': 'MinerU 精准解析 API',
  'mineru-agent-api': 'MinerU-Agent 轻量解析 API',
};

interface DocumentAnalysisPageProps {
  fileName: string;
  fileContent: string;
  onFileImported: (fileName: string, fileContent: string) => void;
}

function DocumentAnalysisPage({
  fileName,
  fileContent,
  onFileImported,
}: DocumentAnalysisPageProps) {
  const [parserLabel, setParserLabel] = useState(parserLabels.local);
  const [busy, setBusy] = useState(false);
  const [busyHintIndex, setBusyHintIndex] = useState(0);
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [busyTick, setBusyTick] = useState(() => Date.now());
  const [previewMode, setPreviewMode] = useState<'fast' | 'markdown'>('markdown');
  const [fastPreviewLineCount, setFastPreviewLineCount] = useState(FAST_PREVIEW_LINE_BATCH);
  const { showToast } = useToast();
  const { showDocumentParseNotice } = useDocumentParseNotice();
  const isLargeDocument = fileContent.length > LARGE_MARKDOWN_THRESHOLD;
  const fileLines = useMemo(() => (fileContent ? fileContent.split(/\r?\n/) : []), [fileContent]);
  const fastPreviewHasMore = fileLines.length > fastPreviewLineCount;
  const fastPreviewText = useMemo(
    () => (fastPreviewHasMore ? fileLines.slice(0, fastPreviewLineCount).join('\n') : fileContent),
    [fastPreviewHasMore, fastPreviewLineCount, fileContent, fileLines]
  );
  const busyElapsedSeconds = busyStartedAt ? Math.max(1, Math.floor((busyTick - busyStartedAt) / 1000)) : 0;

  useEffect(() => {
    if (!fileContent) {
      setPreviewMode('markdown');
      setFastPreviewLineCount(FAST_PREVIEW_LINE_BATCH);
      return;
    }
    setPreviewMode(isLargeDocument ? 'fast' : 'markdown');
    setFastPreviewLineCount(FAST_PREVIEW_LINE_BATCH);
  }, [fileContent, isLargeDocument]);

  useEffect(() => {
    let mounted = true;

    const loadParserConfig = async () => {
      if (!window.bidmind) {
        return;
      }

      try {
        const config = await window.bidmind.config.load();
        if (mounted) {
          setParserLabel(parserLabels[config.file_parser.provider] || parserLabels.local);
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : '读取文件解析配置失败', 'error');
      }
    };

    loadParserConfig();

    return () => {
      mounted = false;
    };
  }, [showToast]);

  useEffect(() => {
    if (!busy) {
      setBusyHintIndex(0);
      setBusyStartedAt(null);
      return;
    }

    const startedAt = Date.now();
    setBusyStartedAt(startedAt);
    setBusyTick(startedAt);
    const hintTimer = window.setInterval(() => {
      setBusyHintIndex((prev) => (prev + 1) % parseHints.length);
    }, 2400);
    const tickTimer = window.setInterval(() => {
      setBusyTick(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(hintTimer);
      window.clearInterval(tickTimer);
    };
  }, [busy]);

  const importDocument = async () => {
    try {
      setBusy(true);
      const result = await window.bidmind?.file.importDocument();

      if (!result?.success || !result.file_content) {
        const message = result?.message || '未导入文件';
        if (isLibreOfficeRequiredMessage(message)) {
          showDocumentParseNotice(message);
          return;
        }
        showToast(message, message === '已取消选择' ? 'info' : 'error');
        return;
      }

      onFileImported(result.file_name || '未命名文件', result.file_content);
      if (result.parser_label) {
        setParserLabel(result.parser_label);
      }
      showToast(result.message, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '文件解析失败';
      if (isLibreOfficeRequiredMessage(message)) {
        showDocumentParseNotice(message);
        return;
      }
      showToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plan-step-body document-analysis-page">
      <section className="analysis-import-card">
        <div>
          <span className="section-kicker">STEP 01</span>
          <strong>上传招标文件</strong>
          <p>当前解析方案：{parserLabel}</p>
        </div>
        {busy && (
          <div className="analysis-import-status" role="status" aria-live="polite">
            <span className="inline-spinner" aria-hidden="true" />
            <div>
              <strong>{parseHints[busyHintIndex]}</strong>
              <small>已处理 {busyElapsedSeconds} 秒，请稍候...</small>
            </div>
          </div>
        )}
        <div className="analysis-actions">
          <button type="button" className="primary-action" onClick={importDocument} disabled={busy}>
            {busy ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                解析中...
              </>
            ) : fileContent ? '重新选择文件' : '选择文件'}
          </button>
        </div>
      </section>

      <section className="analysis-markdown-card">
        <div className="analysis-result-head">
          <div>
            <strong>招标文件内容</strong>
            {isLargeDocument && (
              <small>文档较大，默认快速预览以提升历史加载速度</small>
            )}
          </div>
          <span>{fileContent ? '来自原始招标文件' : '等待上传'}</span>
        </div>

        {fileContent ? (
          <div className="analysis-markdown-preview">
            {isLargeDocument && (
              <div className="analysis-preview-mode-switch" role="tablist" aria-label="预览模式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === 'fast'}
                  className={previewMode === 'fast' ? 'is-active' : ''}
                  onClick={() => setPreviewMode('fast')}
                >
                  快速预览
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === 'markdown'}
                  className={previewMode === 'markdown' ? 'is-active' : ''}
                  onClick={() => setPreviewMode('markdown')}
                >
                  Markdown 渲染
                </button>
              </div>
            )}
            {previewMode === 'markdown' ? (
              <div className="markdown-viewer">
                <MarkdownRenderer allowRawHtml={false}>
                  {fileContent}
                </MarkdownRenderer>
              </div>
            ) : (
              <div className="analysis-fast-preview-wrap">
                <pre className="analysis-fast-preview" aria-label="快速预览文本">
                  {fastPreviewText}
                </pre>
                {fastPreviewHasMore && (
                  <button
                    type="button"
                    className="analysis-fast-preview-more"
                    onClick={() => setFastPreviewLineCount((prev) => prev + FAST_PREVIEW_LINE_BATCH)}
                  >
                    加载更多内容（已显示 {Math.min(fastPreviewLineCount, fileLines.length)} / {fileLines.length} 行）
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="markdown-empty-state">
            <strong>尚未导入招标文件</strong>
            <p>当前步骤只负责把招标文件解析成 Markdown。下一步再基于这里的 Markdown 内容进行 AI 标书理解。</p>
          </div>
        )}

        {busy && (
          <div className="analysis-parsing-overlay" role="status" aria-live="polite">
            <div className="analysis-parsing-overlay-card">
              <span className="inline-spinner" aria-hidden="true" />
              <strong>{parseHints[busyHintIndex]}</strong>
              <small>{fileName ? `正在更新：${fileName}` : '正在处理你刚选择的文件'}</small>
            </div>
          </div>
        )}
      </section>

    </div>
  );
}

export default DocumentAnalysisPage;
