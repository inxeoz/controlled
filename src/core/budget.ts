import type { InvestigationBudget } from "./types"

export const DEFAULT_BUDGET: Omit<
  InvestigationBudget,
  "actions" | "files" | "fuzzySearches" | "semanticSearches" | "llmIterations"
> = {
  maxActions: 20,
  maxFiles: 50,
  maxGraphDepth: 4,
  maxFuzzySearches: 3,
  maxSemanticSearches: 3,
  maxGraphNodes: 100,
  maxLLMIterations: 10,
}

export function createBudget(overrides: Partial<InvestigationBudget> = {}): InvestigationBudget {
  return {
    ...DEFAULT_BUDGET,
    actions: 0,
    files: 0,
    fuzzySearches: 0,
    semanticSearches: 0,
    llmIterations: 0,
    ...overrides,
  }
}

export function budgetRemaining(budget: InvestigationBudget): number {
  return Math.max(0, budget.maxActions - budget.actions)
}

export function budgetExhausted(budget: InvestigationBudget): boolean {
  return (
    budget.actions >= budget.maxActions ||
    budget.files >= budget.maxFiles ||
    budget.llmIterations >= budget.maxLLMIterations
  )
}
