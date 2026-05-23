const path = require('node:path');

function getUserDataPath(app) {
  return app.getPath('userData');
}

function getConfigFilePath(app) {
  return path.join(getUserDataPath(app), 'user_config.json');
}

function getWorkspaceDir(app) {
  return path.join(getUserDataPath(app), 'workspace');
}

function normalizeProjectId(projectId) {
  return String(projectId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
}

function getProjectWorkspaceDir(app, projectId) {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    return '';
  }
  return path.join(getWorkspaceDir(app), 'projects', normalizedProjectId);
}

function getTechnicalPlanFilePath(app) {
  return path.join(getWorkspaceDir(app), 'technical_plan.json');
}

function getProjectTechnicalPlanFilePath(app, projectId) {
  const projectDir = getProjectWorkspaceDir(app, projectId);
  return projectDir ? path.join(projectDir, 'technical_plan.json') : '';
}

function getDuplicateCheckFilePath(app) {
  return path.join(getWorkspaceDir(app), 'duplicate_check.json');
}

function getProjectDuplicateCheckFilePath(app, projectId) {
  const projectDir = getProjectWorkspaceDir(app, projectId);
  return projectDir ? path.join(projectDir, 'duplicate_check.json') : '';
}

function getBusinessBidFilePath(app) {
  return path.join(getWorkspaceDir(app), 'business_bid.json');
}

function getProjectBusinessBidFilePath(app, projectId) {
  const projectDir = getProjectWorkspaceDir(app, projectId);
  return projectDir ? path.join(projectDir, 'business_bid.json') : '';
}

function getRejectionCheckFilePath(app) {
  return path.join(getWorkspaceDir(app), 'rejection_check.json');
}

function getProjectRejectionCheckFilePath(app, projectId) {
  const projectDir = getProjectWorkspaceDir(app, projectId);
  return projectDir ? path.join(projectDir, 'rejection_check.json') : '';
}

function getBidOpportunityFilePath(app) {
  return path.join(getWorkspaceDir(app), 'bid_opportunity.json');
}

function getProjectBidOpportunityFilePath(app, projectId) {
  const projectDir = getProjectWorkspaceDir(app, projectId);
  return projectDir ? path.join(projectDir, 'bid_opportunity.json') : '';
}

function getProjectsFilePath(app) {
  return path.join(getWorkspaceDir(app), 'projects.json');
}

function getDuplicateCheckDir(app) {
  return path.join(getWorkspaceDir(app), 'duplicate-check');
}

function getProjectDuplicateCheckDir(app, projectId) {
  const projectDir = getProjectWorkspaceDir(app, projectId);
  return projectDir ? path.join(projectDir, 'duplicate-check') : '';
}

function getGeneratedImagesDir(app) {
  return path.join(getWorkspaceDir(app), 'generated-images');
}

function getImportedImagesDir(app) {
  return path.join(getWorkspaceDir(app), 'imported-images');
}

function getKnowledgeBaseDir(app) {
  return path.join(getWorkspaceDir(app), 'knowledge-base');
}

function getAiLogsDir(app) {
  return path.join(getUserDataPath(app), 'logs', 'ai');
}

module.exports = {
  getAiLogsDir,
  getBidOpportunityFilePath,
  getBusinessBidFilePath,
  getDuplicateCheckDir,
  getConfigFilePath,
  getDuplicateCheckFilePath,
  getGeneratedImagesDir,
  getImportedImagesDir,
  getKnowledgeBaseDir,
  getProjectBidOpportunityFilePath,
  getProjectBusinessBidFilePath,
  getProjectDuplicateCheckDir,
  getProjectDuplicateCheckFilePath,
  getProjectRejectionCheckFilePath,
  getProjectTechnicalPlanFilePath,
  getProjectWorkspaceDir,
  getProjectsFilePath,
  getRejectionCheckFilePath,
  getTechnicalPlanFilePath,
  getWorkspaceDir,
  getUserDataPath,
  normalizeProjectId,
};
