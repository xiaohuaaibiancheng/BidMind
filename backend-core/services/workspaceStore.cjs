const fs = require('node:fs');
const path = require('node:path');
const {
  getBidOpportunityFilePath,
  getBusinessBidFilePath,
  getDuplicateCheckDir,
  getDuplicateCheckFilePath,
  getProjectBidOpportunityFilePath,
  getProjectBusinessBidFilePath,
  getProjectDuplicateCheckDir,
  getProjectDuplicateCheckFilePath,
  getProjectRejectionCheckFilePath,
  getProjectTechnicalPlanFilePath,
  getProjectsFilePath,
  getRejectionCheckFilePath,
  getTechnicalPlanFilePath,
  normalizeProjectId,
} = require('../utils/paths.cjs');
const { deleteImportedImageBatches } = require('../utils/importedImages.cjs');

function createWorkspaceStore(app) {
  const technicalPlanFile = getTechnicalPlanFilePath(app);
  const businessBidFile = getBusinessBidFilePath(app);
  const duplicateCheckFile = getDuplicateCheckFilePath(app);
  const rejectionCheckFile = getRejectionCheckFilePath(app);
  const bidOpportunityFile = getBidOpportunityFilePath(app);
  const projectsFile = getProjectsFilePath(app);
  const duplicateCheckDir = getDuplicateCheckDir(app);

  const resolveTechnicalPlanFile = (projectId) => getProjectTechnicalPlanFilePath(app, projectId) || technicalPlanFile;
  const resolveTechnicalPlanSummaryFile = (projectId) => {
    const filePath = resolveTechnicalPlanFile(projectId);
    if (!filePath) return '';
    return filePath.endsWith('.json')
      ? filePath.replace(/\.json$/i, '.summary.json')
      : `${filePath}.summary.json`;
  };
  const resolveBusinessBidFile = (projectId) => getProjectBusinessBidFilePath(app, projectId) || businessBidFile;
  const resolveDuplicateCheckFile = (projectId) => getProjectDuplicateCheckFilePath(app, projectId) || duplicateCheckFile;
  const resolveRejectionCheckFile = (projectId) => getProjectRejectionCheckFilePath(app, projectId) || rejectionCheckFile;
  const resolveBidOpportunityFile = (projectId) => getProjectBidOpportunityFilePath(app, projectId) || bidOpportunityFile;
  const resolveDuplicateCheckDir = (projectId) => getProjectDuplicateCheckDir(app, projectId) || duplicateCheckDir;

  function readState(filePath, errorPrefix) {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`${errorPrefix}读取失败：${error.message}`);
    }
  }

  function writeState(filePath, state, successMessage, errorPrefix) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
      return { success: true, message: successMessage, file_path: filePath };
    } catch (error) {
      throw new Error(`${errorPrefix}保存失败：${error.message}`);
    }
  }

  function clearState(filePath, successMessage, errorPrefix) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return { success: true, message: successMessage, file_path: filePath };
    } catch (error) {
      throw new Error(`${errorPrefix}清空失败：${error.message}`);
    }
  }

  function summarizeTechnicalPlanState(state) {
    if (!state || typeof state !== 'object') {
      return null;
    }
    const step = typeof state.step === 'string' ? state.step : 'document-analysis';
    const fileName = typeof state.fileName === 'string' ? state.fileName : '';
    const fileContentLength = typeof state.fileContent === 'string' ? state.fileContent.length : 0;
    const bidAnalysisProgress = Number(state.bidAnalysisProgress) || 0;
    const outline = Array.isArray(state.outlineData?.outline) ? state.outlineData.outline : [];
    const contentGenerationSections = state.contentGenerationSections && typeof state.contentGenerationSections === 'object'
      ? state.contentGenerationSections
      : {};

    return {
      step,
      fileName,
      hasFileContent: fileContentLength > 0,
      fileContentLength,
      bidAnalysisMode: state.bidAnalysisMode || 'key',
      bidAnalysisProgress,
      outlineMode: state.outlineMode || 'aligned',
      outlineRootCount: outline.length,
      contentSectionCount: Object.keys(contentGenerationSections).length,
      updatedAt: new Date().toISOString(),
    };
  }

  function saveTechnicalPlanSummary(state, projectId = '') {
    const summary = summarizeTechnicalPlanState(state);
    if (!summary) {
      return;
    }
    const summaryFile = resolveTechnicalPlanSummaryFile(projectId);
    if (!summaryFile) return;
    try {
      fs.mkdirSync(path.dirname(summaryFile), { recursive: true });
      fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf-8');
    } catch (error) {
      console.warn('技术方案摘要缓存保存失败', error);
    }
  }

  return {
    getTechnicalPlanFilePath(projectId = '') {
      return resolveTechnicalPlanFile(projectId);
    },

    loadTechnicalPlan(projectId = '') {
      return readState(resolveTechnicalPlanFile(projectId), '技术方案缓存');
    },

    saveTechnicalPlan(state, projectId = '') {
      const result = writeState(resolveTechnicalPlanFile(projectId), state, '技术方案缓存已保存', '技术方案缓存');
      saveTechnicalPlanSummary(state, projectId);
      return result;
    },

    updateTechnicalPlan(partial, projectId = '') {
      const prev = this.loadTechnicalPlan(projectId) || {};
      const next = { ...prev, ...partial };
      this.saveTechnicalPlan(next, projectId);
      return next;
    },

    clearTechnicalPlan(projectId = '') {
      const technicalPlanPath = resolveTechnicalPlanFile(projectId);
      const summaryPath = resolveTechnicalPlanSummaryFile(projectId);
      const normalizedProjectId = normalizeProjectId(projectId);
      const result = clearState(technicalPlanPath, '技术方案缓存已清空', '技术方案缓存');
      if (summaryPath && fs.existsSync(summaryPath)) {
        try {
          fs.unlinkSync(summaryPath);
        } catch (error) {
          console.warn('技术方案摘要缓存清空失败', error);
        }
      }
      deleteImportedImageBatches(app, normalizedProjectId ? `technical-plan-${normalizedProjectId}` : 'technical-plan');
      return result;
    },

    loadTechnicalPlanSummary(projectId = '') {
      const summaryFile = resolveTechnicalPlanSummaryFile(projectId);
      const fromSummary = summaryFile ? readState(summaryFile, '技术方案摘要缓存') : null;
      if (fromSummary) {
        return fromSummary;
      }
      const fullState = this.loadTechnicalPlan(projectId);
      const summary = summarizeTechnicalPlanState(fullState);
      if (summary) {
        saveTechnicalPlanSummary(fullState, projectId);
      }
      return summary;
    },

    loadBusinessBid(projectId = '') {
      return readState(resolveBusinessBidFile(projectId), '商务标缓存');
    },

    saveBusinessBid(state, projectId = '') {
      return writeState(resolveBusinessBidFile(projectId), state, '商务标缓存已保存', '商务标缓存');
    },

    updateBusinessBid(partial, projectId = '') {
      const prev = this.loadBusinessBid(projectId) || {};
      const next = { ...prev, ...partial };
      this.saveBusinessBid(next, projectId);
      return next;
    },

    clearBusinessBid(projectId = '') {
      return clearState(resolveBusinessBidFile(projectId), '商务标缓存已清空', '商务标缓存');
    },

    loadDuplicateCheck(projectId = '') {
      return readState(resolveDuplicateCheckFile(projectId), '标书查重缓存');
    },

    saveDuplicateCheck(state, projectId = '') {
      return writeState(resolveDuplicateCheckFile(projectId), state, '标书查重缓存已保存', '标书查重缓存');
    },

    updateDuplicateCheck(partial, projectId = '') {
      const prev = this.loadDuplicateCheck(projectId) || {};
      const next = { ...prev, ...partial };
      this.saveDuplicateCheck(next, projectId);
      return next;
    },

    clearDuplicateCheck(projectId = '') {
      const duplicateCheckPath = resolveDuplicateCheckFile(projectId);
      const projectScopedDuplicateDir = resolveDuplicateCheckDir(projectId);
      const normalizedProjectId = normalizeProjectId(projectId);
      const result = clearState(duplicateCheckPath, '标书查重缓存已清空', '标书查重缓存');
      try {
        if (fs.existsSync(projectScopedDuplicateDir)) {
          fs.rmSync(projectScopedDuplicateDir, { recursive: true, force: true });
        }
      } catch (error) {
        throw new Error(`标书查重缓存清空失败：${error.message}`);
      }
      deleteImportedImageBatches(
        app,
        normalizedProjectId ? `duplicate-check-${normalizedProjectId}-content` : 'duplicate-check-global-content'
      );
      return result;
    },

    loadRejectionCheck(projectId = '') {
      return readState(resolveRejectionCheckFile(projectId), '废标项检查缓存');
    },

    saveRejectionCheck(state, projectId = '') {
      return writeState(resolveRejectionCheckFile(projectId), state, '废标项检查缓存已保存', '废标项检查缓存');
    },

    updateRejectionCheck(partial, projectId = '') {
      const prev = this.loadRejectionCheck(projectId) || {};
      const next = { ...prev, ...partial };
      this.saveRejectionCheck(next, projectId);
      return next;
    },

    clearRejectionCheck(projectId = '') {
      return clearState(resolveRejectionCheckFile(projectId), '废标项检查缓存已清空', '废标项检查缓存');
    },

    loadBidOpportunity(projectId = '') {
      return readState(resolveBidOpportunityFile(projectId), '投标机会缓存');
    },

    saveBidOpportunity(state, projectId = '') {
      return writeState(resolveBidOpportunityFile(projectId), state, '投标机会缓存已保存', '投标机会缓存');
    },

    updateBidOpportunity(partial, projectId = '') {
      const prev = this.loadBidOpportunity(projectId) || {};
      const next = { ...prev, ...partial };
      this.saveBidOpportunity(next, projectId);
      return next;
    },

    clearBidOpportunity(projectId = '') {
      return clearState(resolveBidOpportunityFile(projectId), '投标机会缓存已清空', '投标机会缓存');
    },

    loadProjects() {
      return readState(projectsFile, '项目管理缓存');
    },

    saveProjects(state) {
      return writeState(projectsFile, state, '项目管理缓存已保存', '项目管理缓存');
    },

    updateProjects(partial) {
      const prev = this.loadProjects() || {};
      const next = { ...prev, ...partial };
      this.saveProjects(next);
      return next;
    },

    clearProjects() {
      return clearState(projectsFile, '项目管理缓存已清空', '项目管理缓存');
    },
  };
}

module.exports = {
  createWorkspaceStore,
};
