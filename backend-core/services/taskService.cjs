const crypto = require('node:crypto');
const { runBidAnalysisTask } = require('./bidAnalysisTask.cjs');
const { runContentGenerationTask } = require('./contentGenerationTask.cjs');
const { runOutlineGenerationTask } = require('./outlineGenerationTask.cjs');

const taskFields = {
  'bid-analysis': 'bidAnalysisTask',
  'outline-generation': 'outlineGenerationTask',
  'content-generation': 'contentGenerationTask',
};

function now() {
  return new Date().toISOString();
}

function createTask(type) {
  return {
    task_id: crypto.randomUUID(),
    type,
    status: 'running',
    progress: 0,
    logs: [],
    started_at: now(),
    updated_at: now(),
  };
}

function createTaskService({ aiService, workspaceStore, knowledgeBaseService }) {
  const subscribers = new Set();
  const activeTasks = new Map();

  function emit(task, technicalPlan, projectId = '') {
    const event = { task, technicalPlan, project_id: projectId || '' };
    for (const webContents of subscribers) {
      if (!webContents.isDestroyed()) {
        webContents.send('tasks:event', event);
      }
    }
  }

  function subscribe(webContents) {
    subscribers.add(webContents);
    for (const entry of activeTasks.values()) {
      const technicalPlan = workspaceStore.loadTechnicalPlan(entry.projectId);
      if (!webContents.isDestroyed()) {
        webContents.send('tasks:event', { task: entry.task, technicalPlan, project_id: entry.projectId || '' });
      }
    }
    webContents.once('destroyed', () => subscribers.delete(webContents));
  }

  function getTaskField(type) {
    return taskFields[type];
  }

  function createScopedWorkspaceStore(projectId) {
    return {
      ...workspaceStore,
      loadTechnicalPlan: () => workspaceStore.loadTechnicalPlan(projectId),
      saveTechnicalPlan: (state) => workspaceStore.saveTechnicalPlan(state, projectId),
      updateTechnicalPlan: (partial) => workspaceStore.updateTechnicalPlan(partial, projectId),
      clearTechnicalPlan: () => workspaceStore.clearTechnicalPlan(projectId),
    };
  }

  function getTaskKey(projectId, type) {
    return `${projectId || '__global__'}:${type}`;
  }

  function startTask(type, payload, runner, initialPartial = {}) {
    const projectId = String(payload?.project_id || '').trim();
    const taskKey = getTaskKey(projectId, type);
    const scopedWorkspaceStore = createScopedWorkspaceStore(projectId);
    const existingTask = activeTasks.get(taskKey)?.task;
    if (existingTask?.status === 'running') {
      emit(existingTask, scopedWorkspaceStore.loadTechnicalPlan(), projectId);
      return existingTask;
    }

    const task = { ...createTask(type), project_id: projectId || '' };
    activeTasks.set(taskKey, { task, projectId });
    const taskField = getTaskField(type);
    let currentTask = task;

    const updateTask = (partial, technicalPlan) => {
      currentTask = {
        ...currentTask,
        ...partial,
        logs: partial.logs ? partial.logs : currentTask.logs,
        updated_at: now(),
      };
      activeTasks.set(taskKey, { task: currentTask, projectId });
      if (technicalPlan) emit(currentTask, technicalPlan, projectId);
      return currentTask;
    };

    const technicalPlan = scopedWorkspaceStore.updateTechnicalPlan({ ...initialPartial, [taskField]: currentTask });
    emit(currentTask, technicalPlan, projectId);

    runner({ aiService, workspaceStore: scopedWorkspaceStore, knowledgeBaseService, updateTask, payload }).catch((error) => {
      const failedTask = updateTask({ status: 'error', error: error.message || '任务执行失败' });
      const nextPlan = scopedWorkspaceStore.updateTechnicalPlan({ [taskField]: failedTask });
      emit(failedTask, nextPlan, projectId);
    }).finally(() => {
      activeTasks.delete(taskKey);
    });

    return currentTask;
  }

  return {
    subscribe,
    startBidAnalysis(payload) {
      return startTask('bid-analysis', payload, runBidAnalysisTask);
    },
    startOutlineGeneration(payload) {
      return startTask('outline-generation', payload, runOutlineGenerationTask, {
        outlineMode: payload?.mode,
        referenceKnowledgeDocumentIds: Array.isArray(payload?.reference_knowledge_document_ids) ? payload.reference_knowledge_document_ids : [],
      });
    },
    startContentGeneration(payload) {
      return startTask('content-generation', payload, runContentGenerationTask);
    },
    getActiveTasks() {
      return Array.from(activeTasks.values()).map((entry) => entry.task);
    },
  };
}

module.exports = { createTaskService };
