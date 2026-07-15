const crypto = require('node:crypto');
const { runBidAnalysisTask } = require('./bidAnalysisTask.cjs');
const { runContentGenerationTask } = require('./contentGenerationTask.cjs');
const { runOutlineGenerationTask } = require('./outlineGenerationTask.cjs');
const TASK_EVENT_THROTTLE_MS = 240;
const MAX_EMITTED_TASK_LOGS = 80;

const taskFields = {
  'bid-analysis': 'bidAnalysisTask',
  'outline-generation': 'outlineGenerationTask',
  'content-generation': 'contentGenerationTask',
};

function now() {
  return new Date().toISOString();
}

function trimLogs(logs) {
  if (!Array.isArray(logs) || logs.length <= MAX_EMITTED_TASK_LOGS) {
    return logs;
  }
  return logs.slice(-MAX_EMITTED_TASK_LOGS);
}

function trimTaskLogs(task) {
  if (!task || typeof task !== 'object' || !Array.isArray(task.logs)) {
    return task;
  }
  return { ...task, logs: trimLogs(task.logs) };
}

function slimTechnicalPlanForEvent(task, technicalPlan) {
  if (!technicalPlan || typeof technicalPlan !== 'object') {
    return technicalPlan;
  }

  const nextPlan = { ...technicalPlan };
  if (typeof nextPlan.fileContent === 'string' && nextPlan.fileContent) {
    nextPlan.fileContent = '';
  }

  if (task?.type === 'content-generation' && task?.status === 'running') {
    delete nextPlan.outlineData;
  }

  if (nextPlan.contentGenerationTask) {
    nextPlan.contentGenerationTask = trimTaskLogs(nextPlan.contentGenerationTask);
  }
  if (nextPlan.bidAnalysisTask) {
    nextPlan.bidAnalysisTask = trimTaskLogs(nextPlan.bidAnalysisTask);
  }
  if (nextPlan.outlineGenerationTask) {
    nextPlan.outlineGenerationTask = trimTaskLogs(nextPlan.outlineGenerationTask);
  }

  return nextPlan;
}

function buildTaskEvent(task, technicalPlan, projectId = '') {
  const safeTask = trimTaskLogs(task);
  return {
    task: safeTask,
    technicalPlan: slimTechnicalPlanForEvent(safeTask, technicalPlan),
    project_id: projectId || '',
  };
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
  const pendingEvents = new Map();

  function dispatch(event) {
    for (const webContents of subscribers) {
      if (!webContents.isDestroyed()) {
        webContents.send('tasks:event', event);
      }
    }
  }

  function clearPendingEvent(taskKey) {
    const pending = pendingEvents.get(taskKey);
    if (!pending) {
      return null;
    }
    clearTimeout(pending.timer);
    pendingEvents.delete(taskKey);
    return pending.event;
  }

  function emit(task, technicalPlan, projectId = '') {
    const taskKey = getTaskKey(projectId, task?.type || 'unknown');
    const event = buildTaskEvent(task, technicalPlan, projectId);
    const shouldThrottle = task?.status === 'running' && (
      task?.type === 'content-generation' || task?.type === 'bid-analysis'
    );

    if (!shouldThrottle) {
      clearPendingEvent(taskKey);
      dispatch(event);
      return;
    }

    const pending = pendingEvents.get(taskKey);
    if (pending) {
      pending.event = event;
      return;
    }

    const timer = setTimeout(() => {
      const latest = clearPendingEvent(taskKey);
      if (latest) {
        dispatch(latest);
      }
    }, TASK_EVENT_THROTTLE_MS);

    pendingEvents.set(taskKey, { timer, event });
  }

  function subscribe(webContents) {
    subscribers.add(webContents);
    for (const entry of activeTasks.values()) {
      const technicalPlan = workspaceStore.loadTechnicalPlan(entry.projectId);
      if (!webContents.isDestroyed()) {
        webContents.send('tasks:event', buildTaskEvent(entry.task, technicalPlan, entry.projectId));
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
      const nextLogs = partial.logs ? trimLogs(partial.logs) : currentTask.logs;
      currentTask = {
        ...currentTask,
        ...partial,
        logs: nextLogs,
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
      clearPendingEvent(taskKey);
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
