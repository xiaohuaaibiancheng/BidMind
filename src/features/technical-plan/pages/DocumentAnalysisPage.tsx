import { useEffect, useState, type DragEvent } from 'react';
import { isLibreOfficeRequiredMessage, useDocumentParseNotice, useToast } from '../../../shared/ui';
import type { FileImportResult, FileParserProvider } from '../../../shared/types';

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
  onBusyChange?: (busy: boolean) => void;
  onFileImported: (fileName: string, fileContent: string) => void;
}

function DocumentAnalysisPage({
  fileName,
  fileContent,
  onBusyChange,
  onFileImported,
}: DocumentAnalysisPageProps) {
  const [parserLabel, setParserLabel] = useState(parserLabels.local);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [busyHintIndex, setBusyHintIndex] = useState(0);
  const [busyStartedAt, setBusyStartedAt] = useState<number | null>(null);
  const [busyTick, setBusyTick] = useState(() => Date.now());
  const { showToast } = useToast();
  const { showDocumentParseNotice } = useDocumentParseNotice();
  const busyElapsedSeconds = busyStartedAt ? Math.max(1, Math.floor((busyTick - busyStartedAt) / 1000)) : 0;

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => () => {
    onBusyChange?.(false);
  }, [onBusyChange]);

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

  const handleImportResult = (result: FileImportResult | undefined) => {
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
  };

  const importDocument = async (file?: File) => {
    try {
      setBusy(true);
      if (file && !window.bidmind?.file.importDocumentFile) {
        showToast('当前环境不支持拖拽直传，请点击上传区选择文件', 'info');
        return;
      }
      const result = file
        ? await window.bidmind?.file.importDocumentFile?.(file)
        : await window.bidmind?.file.importDocument();
      handleImportResult(result);
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

  const handleUploadDragOver = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!busy) {
      setDragActive(true);
    }
  };

  const handleUploadDragLeave = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragActive(false);
    }
  };

  const handleUploadDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (busy) return;

    const file = event.dataTransfer.files?.[0];
    if (!file) {
      showToast('没有读取到文件，请重新拖入', 'error');
      return;
    }
    void importDocument(file);
  };

  return (
    <div className="plan-step-body document-analysis-page">
      <section className="analysis-import-card analysis-upload-panel">
        <div className="analysis-upload-info">
          <span className="section-kicker">STEP 01</span>
          <strong>上传招标文件</strong>
          <span className="analysis-upload-rule-line" aria-hidden="true" />
          <p>支持 Word、PDF、TXT、MD 格式文件</p>
          <p>单次支持上传一份文件，文件大小不超过 50 MB</p>

          <div className="analysis-upload-file-icons" aria-hidden="true">
            <span className="analysis-file-icon is-word">W</span>
            <span className="analysis-file-icon is-pdf">P</span>
            <span className="analysis-file-icon is-text">T</span>
            <span className="analysis-file-icon is-md">M</span>
          </div>
        </div>

        <button
          type="button"
          className={`analysis-upload-dropzone${dragActive ? ' is-drag-active' : ''}`}
          onClick={() => void importDocument()}
          onDragOver={handleUploadDragOver}
          onDragLeave={handleUploadDragLeave}
          onDrop={handleUploadDrop}
          disabled={busy}
          aria-label="上传招标文件"
        >
          <span className="analysis-upload-folder" aria-hidden="true">
            <span />
          </span>
          <span className="analysis-upload-title">
            {busy ? parseHints[busyHintIndex] : (
              <>
                <strong>拖动文件到此上传</strong>
                <em>或点击 上传文件</em>
              </>
            )}
          </span>
          <span className="analysis-upload-button">
            {busy ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                解析中...
              </>
            ) : fileContent ? '重新上传招标文件' : '上传招标文件'}
          </span>
          <small>
            {busy ? `已处理 ${busyElapsedSeconds} 秒，请稍候...` : `当前解析方案：${parserLabel}`}
          </small>
          <span className={`analysis-upload-file-name${fileName ? ' has-file' : ''}`}>
            {fileName ? `当前文件：${fileName}` : '尚未上传招标文件'}
          </span>
        </button>

        {busy && (
          <div className="analysis-import-status analysis-upload-status" role="status" aria-live="polite">
            <span className="inline-spinner" aria-hidden="true" />
            <div>
              <strong>{parseHints[busyHintIndex]}</strong>
              <small>已处理 {busyElapsedSeconds} 秒，请稍候...</small>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default DocumentAnalysisPage;
