import { useEffect, useRef, useState } from 'react';
import { technicalPlanStorage } from '../services/technicalPlanStorage';
import type { TechnicalPlanState } from '../types';

const initialState: TechnicalPlanState = {
  step: 'document-analysis',
  fileName: '',
  fileContent: '',
  projectOverview: '',
  techRequirements: '',
  bidAnalysisMode: 'key',
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
  exportStyleOptions: {
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
  outlineData: null,
};

function hasRunningTask(state: TechnicalPlanState) {
  return state.bidAnalysisTask?.status === 'running'
    || state.outlineGenerationTask?.status === 'running'
    || state.contentGenerationTask?.status === 'running';
}

function buildStatePartial(prev: TechnicalPlanState, next: TechnicalPlanState): Partial<TechnicalPlanState> {
  const partial: Partial<TechnicalPlanState> = {};
  (Object.keys(next) as Array<keyof TechnicalPlanState>).forEach((key) => {
    if (!Object.is(prev[key], next[key])) {
      (partial as Record<string, unknown>)[String(key)] = next[key] as unknown;
    }
  });
  return partial;
}

export function useTechnicalPlanWorkflow() {
  const [state, setState] = useState<TechnicalPlanState>(initialState);
  const [cacheReady, setCacheReady] = useState(false);
  const latestStateRef = useRef(state);
  const cacheReadyRef = useRef(false);
  const persistedStateRef = useRef<TechnicalPlanState>(initialState);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    cacheReadyRef.current = cacheReady;
  }, [cacheReady]);

  useEffect(() => {
    let mounted = true;

    const loadCache = async () => {
      const localSummary = technicalPlanStorage.loadCachedSummary();
      if (mounted && localSummary) {
        setState((prev) => ({ ...prev, ...localSummary }));
      }

      const summaryPromise = technicalPlanStorage.loadSummary();
      const statePromise = technicalPlanStorage.load();

      try {
        const cachedSummary = await summaryPromise;
        if (mounted && cachedSummary) {
          setState((prev) => ({ ...prev, ...cachedSummary }));
        }
      } catch (error) {
        console.warn('技术方案摘要读取失败', error);
      }

      try {
        const cachedState = await statePromise;
        if (mounted && cachedState) {
          setState({ ...initialState, ...cachedState });
          persistedStateRef.current = { ...initialState, ...cachedState };
        }
      } catch (error) {
        console.warn('技术方案缓存读取失败', error);
      } finally {
        if (mounted) {
          setCacheReady(true);
        }
      }
    };

    loadCache();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!cacheReady) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (hasRunningTask(state)) {
        return;
      }
      const partial = buildStatePartial(persistedStateRef.current, state);
      if (!Object.keys(partial).length) {
        return;
      }
      technicalPlanStorage.savePartial(partial).then(() => {
        persistedStateRef.current = state;
      }).catch((error) => {
        console.warn('技术方案缓存保存失败', error);
      });
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [cacheReady, state]);

  useEffect(() => () => {
    if (!cacheReadyRef.current) {
      return;
    }

    if (hasRunningTask(latestStateRef.current)) {
      return;
    }
    const partial = buildStatePartial(persistedStateRef.current, latestStateRef.current);
    if (!Object.keys(partial).length) {
      return;
    }
    technicalPlanStorage.savePartial(partial).then(() => {
      persistedStateRef.current = latestStateRef.current;
    }).catch((error) => {
      console.warn('技术方案缓存保存失败', error);
    });
  }, []);

  return {
    state,
    setState,
  };
}
