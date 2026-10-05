import { describe, expect, test } from "bun:test"
import { DEFAULT_POLICY, decide, evidenceSufficient } from "../src/core/jev"
import { CapabilityRegistry } from "../src/core/registry"
import { createBudget } from "../src/core/budget"
import type { ActionProposal, InvestigationContext } from "../src/core/types"

function proposal(capability: string, target: Record<string, unknown> = {}, parameters: Record<string, unknown> = {}): ActionProposal {
  return { id: "pr_1", capability, target, parameters, reason: "test", expectedResult: "test" }
}

function context(overrides: Partial<InvestigationContext> = {}): InvestigationContext {
  return {
    sessionId: "inv_1",
    question: "Where is the API that creates an order?",
    intents: ["FIND_API"],
    entities: ["create_order"],
    hypothesis: null,
    evidence: [],
    visitedNodes: [],
    visitedEdges: [],
    depth: 0,
    budget: createBudget(),
    decisions: [],
    status: "INVESTIGATING",
    graph: { nodes: [], edges: [] },
    ...overrides,
  }
}

const registry = new CapabilityRegistry()

describe("JEV decision engine", () => {
  test("ALLOW for a useful, valid proposal", () => {
    const decision = decide({ proposal: proposal("EXACT_SEARCH", { query: "create_order" }), context: context(), machineState: "JEV_DECISION", registry })
    expect(decision.decision).toBe("EXPLORE")
    expect(decision.verdict).toBe("ALLOW")
    expect(decision.capability).toBe("EXACT_SEARCH")
    expect(decision.expectedInformationGain).toBeGreaterThan(0)
  })

  test("REJECT for an unknown capability", () => {
    const decision = decide({ proposal: proposal("NOT_A_CAPABILITY"), context: context(), machineState: "JEV_DECISION", registry })
    expect(decision.verdict).toBe("REJECT")
  })

  test("MODIFY downgrades SEMANTIC_SEARCH to a cheaper search", () => {
    const decision = decide({ proposal: proposal("SEMANTIC_SEARCH", { query: "order" }), context: context(), machineState: "JEV_DECISION", registry })
    expect(decision.verdict).toBe("MODIFY")
    expect(decision.capability).toBe("EXACT_SEARCH")
    expect(decision.reason).toContain("exact search")
  })

  test("MODIFY upgrades EXACT_SEARCH to FUZZY_SEARCH after an empty exact search", () => {
    const ctx = context({
      decisions: [{ id: "j1", decision: "EXPLORE", verdict: "ALLOW", capability: "EXACT_SEARCH", reason: "x", at: "" }],
      evidence: [],
    })
    const decision = decide({ proposal: proposal("EXACT_SEARCH", { query: "create appointment" }), context: ctx, machineState: "JEV_DECISION", registry })
    expect(decision.verdict).toBe("MODIFY")
    expect(decision.capability).toBe("FUZZY_SEARCH")
  })

  test("STOP when the budget is exhausted", () => {
    const budget = createBudget()
    budget.actions = budget.maxActions
    const decision = decide({ proposal: proposal("EXACT_SEARCH", { query: "x" }), context: context({ budget }), machineState: "JEV_DECISION", registry })
    expect(decision.decision).toBe("STOP")
  })

  test("STOP when the user stopped the investigation", () => {
    const decision = decide({ proposal: proposal("EXACT_SEARCH", { query: "x" }), context: context(), machineState: "READY", registry, restrictions: { userStopped: true } })
    expect(decision.decision).toBe("STOP")
  })

  test("STOP when graph depth is exceeded", () => {
    const ctx = context({ depth: 4 })
    const decision = decide({ proposal: proposal("CALL_GRAPH", { symbol: "a" }, { maxDepth: 5 }), context: ctx, machineState: "JEV_DECISION", registry })
    expect(decision.decision).toBe("STOP")
    expect(decision.reason).toContain("depth")
  })

  test("MODIFY limits graph depth instead of rejecting", () => {
    const decision = decide({ proposal: proposal("CALL_GRAPH", { symbol: "a" }, { maxDepth: 9 }), context: context({ depth: 1 }), machineState: "JEV_DECISION", registry })
    expect(decision.verdict).toBe("MODIFY")
    expect(decision.constraints?.maxDepth).toBe(4)
  })

  test("ANSWER when evidence is already sufficient", () => {
    const evidence = Array.from({ length: 8 }, (_, index) => ({ id: "e" + index, type: "DEFINITION" as const, file: "a.ts", lineStart: index, lineEnd: index, symbol: "s", relation: null, confidence: 0.9, discoveredBy: "FIND_DEFINITION" }))
    const budget = createBudget()
    budget.actions = 5
    const decision = decide({ proposal: proposal("EXACT_SEARCH", { query: "x" }), context: context({ evidence, budget }), machineState: "JEV_DECISION", registry })
    expect(decision.decision).toBe("ANSWER")
  })

  test("ASK_USER for two equally relevant definitions", () => {
    const evidence = [
      { id: "e1", type: "DEFINITION" as const, file: "a.ts", lineStart: 1, lineEnd: 1, symbol: "create", relation: null, confidence: 0.8, discoveredBy: "FIND_DEFINITION" },
      { id: "e2", type: "DEFINITION" as const, file: "b.ts", lineStart: 2, lineEnd: 2, symbol: "create", relation: null, confidence: 0.8, discoveredBy: "FIND_DEFINITION" },
    ]
    const decision = decide({ proposal: proposal("FIND_CALLERS", { symbol: "create" }), context: context({ evidence, intents: ["IMPACT_ANALYSIS"] }), machineState: "JEV_DECISION", registry })
    expect(decision.decision).toBe("ASK_USER")
  })

  test("evidenceSufficient requires actions and strong evidence", () => {
    const budget = createBudget()
    expect(evidenceSufficient(context({ budget }), DEFAULT_POLICY)).toBe(false)
  })

  test("a denied capability is rejected", () => {
    const decision = decide({ proposal: proposal("EXACT_SEARCH", { query: "x" }), context: context(), machineState: "JEV_DECISION", registry, restrictions: { deniedCapabilities: ["EXACT_SEARCH"] } })
    expect(decision.verdict).toBe("REJECT")
  })
})
