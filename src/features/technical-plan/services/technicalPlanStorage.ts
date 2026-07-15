import type { TechnicalPlanState, TechnicalPlanStep } from '../types';
import { workspaceStorage } from '../../../shared/storage/workspaceStorage';

const validSteps: TechnicalPlanStep[] = [
  'document-analysis',
  'bid-analysis',
  'outline-generation',
  'content-edit',
  'expand',
];
const TECHNICAL_PLAN_SUMMARY_CACHE_KEY = 'bidmind:technical-plan:summary-cache:v1';
const GLOBAL_PROJECT_KEY = '__global__';

function isTechnicalPlanState(state: TechnicalPlanState | null): state is TechnicalPlanState {
  return Boolean(state && validSteps.includes(state.step));
}

function getActiveProjectCacheKey() {
  const activeProjectId = String(workspaceStorage.load()?.activeProjectId || '').trim();
  return activeProjectId || GLOBAL_PROJECT_KEY;
}

function normalizeSummary(summary: unknown): Partial<TechnicalPlanState> | null {
  if (!summary || typeof summary !== 'object') {
    return null;
  }
  const state = summary as Partial<TechnicalPlanState>;
  if (state.step && !validSteps.includes(state.step)) {
    return null;
  }
  return state;
}

function readSummaryCache() {
  try {
    const raw = localStorage.getItem(TECHNICAL_PLAN_SUMMARY_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, Partial<TechnicalPlanState>> : {};
  } catch {
    return {};
  }
}

function writeSummaryCache(projectKey: string, summary: Partial<TechnicalPlanState>) {
  try {
    const cache = readSummaryCache();
    cache[projectKey] = {
      step: summary.step,
      fileName: summary.fileName,
      bidAnalysisMode: summary.bidAnalysisMode,
      bidAnalysisProgress: summary.bidAnalysisProgress,
      outlineMode: summary.outlineMode,
    };
    localStorage.setItem(TECHNICAL_PLAN_SUMMARY_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 忽略缓存写入失败，避免影响主流程。
  }
}

function buildSummaryFromState(state: TechnicalPlanState): Partial<TechnicalPlanState> {
  return {
    step: state.step,
    fileName: state.fileName,
    bidAnalysisMode: state.bidAnalysisMode,
    bidAnalysisProgress: state.bidAnalysisProgress,
    outlineMode: state.outlineMode,
  };
}

export const technicalPlanStorage = {
  loadCachedSummary(): Partial<TechnicalPlanState> | null {
    const cache = readSummaryCache();
    return normalizeSummary(cache[getActiveProjectCacheKey()]);
  },

  async loadSummary(): Promise<Partial<TechnicalPlanState> | null> {
    const projectKey = getActiveProjectCacheKey();
    const state = normalizeSummary(await window.bidmind?.workspace.loadTechnicalPlanSummary<Partial<TechnicalPlanState>>());
    if (state) {
      writeSummaryCache(projectKey, state);
      return state;
    }
    return null;
  },

  async load(): Promise<TechnicalPlanState | null> {
    const state = await window.bidmind?.workspace.loadTechnicalPlan<TechnicalPlanState>();

    if (!isTechnicalPlanState(state || null)) {
      return null;
    }

    return state || null;
  },

  async save(state: TechnicalPlanState) {
    await window.bidmind?.workspace.saveTechnicalPlan(state);
    writeSummaryCache(getActiveProjectCacheKey(), buildSummaryFromState(state));
  },

  async savePartial(partial: Partial<TechnicalPlanState>) {
    if (!partial || typeof partial !== 'object' || !Object.keys(partial).length) {
      return;
    }
    await window.bidmind?.workspace.updateTechnicalPlan(partial);
    writeSummaryCache(getActiveProjectCacheKey(), partial);
  },
};
