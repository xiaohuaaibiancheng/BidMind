import type { TechnicalPlanState, TechnicalPlanStep } from '../types';

const validSteps: TechnicalPlanStep[] = [
  'document-analysis',
  'bid-analysis',
  'outline-generation',
  'content-edit',
  'expand',
];

function isTechnicalPlanState(state: TechnicalPlanState | null): state is TechnicalPlanState {
  return Boolean(state && validSteps.includes(state.step));
}

export const technicalPlanStorage = {
  async loadSummary(): Promise<Partial<TechnicalPlanState> | null> {
    const state = await window.bidmind?.workspace.loadTechnicalPlanSummary<Partial<TechnicalPlanState>>();
    if (!state || typeof state !== 'object') {
      return null;
    }
    if (state.step && !validSteps.includes(state.step)) {
      return null;
    }
    return state;
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
  },
};
