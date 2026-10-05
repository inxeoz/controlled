import { describe, expect, test } from "bun:test"
import path from "node:path"
import { getIndex } from "../src/capabilities/index"
import { CAPABILITY_FNS, runCapability, signatureOf } from "../src/capabilities/execute"
import { BASE_CAPABILITIES, CapabilityRegistry } from "../src/core/registry"
import { createBudget } from "../src/core/budget"
import type { InvestigationSession } from "../src/core/types"

const ROOT = path.resolve(import.meta.dir, "../fixtures/sample-repo")
const index = getIndex(ROOT)
index.ensure()

function session(): InvestigationSession {
  return {
    id: "inv_test",
    question: "test",
    status: "INVESTIGATING",
    intent: ["GENERAL_EXPLORATION"],
    entities: [],
    hypothesis: null,
    evidence: [],
    actions: [],
    decisions: [],
    graph: { nodes: [], edges: [] },
    budget: createBudget(),
    depth: 0,
    currentState: "READY",
    answer: null,
    termination: null,
    createdAt: "",
    updatedAt: "",
  }
}

const ctx = () => ({ index, session: session() })

describe("capability registry", () => {
  test("contains every capability from the specification", () => {
    const ids = BASE_CAPABILITIES.map((capability) => capability.id)
    for (const expected of ["EXACT_SEARCH", "FUZZY_SEARCH", "SEMANTIC_SEARCH", "AST_SEARCH", "AST_SCHEMA", "FIND_DEFINITION", "FIND_CALLERS", "FIND_CALLEES", "ROUTE_SEARCH", "CALL_GRAPH", "IMPORT_GRAPH", "CYCLE_DETECTION", "EVIDENCE_CHECK", "CONFIDENCE_CHECK"]) {
      expect(ids).toContain(expected)
    }
  })

  test("supports live capability registration", () => {
    const registry = new CapabilityRegistry()
    registry.register({ id: "DATABASE_SEARCH", category: "DISCOVERY", description: "db", cost: 3, depthCost: 1, expectedInformationGain: 0.6, requires: [], produces: [], canRepeat: true, canCreateGraphEdges: false })
    expect(registry.has("DATABASE_SEARCH")).toBe(true)
    expect(registry.snapshot().length).toBe(BASE_CAPABILITIES.length + 1)
  })
})

describe("search capabilities", () => {
  test("EXACT_SEARCH finds exact matches", () => {
    const result = CAPABILITY_FNS.EXACT_SEARCH({ target: { query: "create_order" }, parameters: {}, constraints: {} }, ctx())
    expect(result.ok).toBe(true)
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(result.evidence.every((item) => item.type === "SEARCH_MATCH" || item.type === "DEFINITION")).toBe(true)
    expect(result.evidence.some((item) => item.type === "DEFINITION")).toBe(true)
  })

  test("FILENAME_SEARCH finds files by name", () => {
    const result = CAPABILITY_FNS.FILENAME_SEARCH({ target: { query: "order" }, parameters: {}, constraints: {} }, ctx())
    expect(result.evidence.length).toBeGreaterThan(0)
  })

  test("FUZZY_SEARCH ranks approximate identifiers and reports its method", () => {
    const result = CAPABILITY_FNS.FUZZY_SEARCH({ target: { query: "create appointment" }, parameters: {}, constraints: {} }, ctx())
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(result.evidence[0].relation).toBeTruthy()
    expect(result.meta?.method).toBeTruthy()
  })

  test("SEMANTIC_SEARCH is explicitly not implemented in v0.1", () => {
    const result = CAPABILITY_FNS.SEMANTIC_SEARCH({ target: { query: "x" }, parameters: {}, constraints: {} }, ctx())
    expect(result.ok).toBe(false)
    expect(result.error).toBe("not_implemented")
  })

  test("an unknown capability fails cleanly", async () => {
    const result = await runCapability("NOPE", { target: null, parameters: {}, constraints: {} }, ctx())
    expect(result.ok).toBe(false)
  })
})

describe("AST capabilities", () => {
  test("AST_SCHEMA finds schema fields without relying on plain text", () => {
    const result = CAPABILITY_FNS.AST_SCHEMA({ target: { field: "customer_id" }, parameters: {}, constraints: {} }, ctx())
    const symbols = result.evidence.map((item) => item.symbol)
    expect(symbols).toContain("OrderRequest")
    expect(symbols).toContain("OrderRequest.customer_id")
    expect(result.meta?.systems).toContain("pydantic")
  })

  test("AST_PARAMETER finds functions by parameter name", () => {
    const result = CAPABILITY_FNS.AST_PARAMETER({ target: { field: "payload" }, parameters: {}, constraints: {} }, ctx())
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(result.evidence[0].type).toBe("PARAMETER")
  })

  test("AST_IMPORT finds import statements", () => {
    const result = CAPABILITY_FNS.AST_IMPORT({ target: { query: "order" }, parameters: {}, constraints: {} }, ctx())
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(result.evidence[0].type).toBe("IMPORT")
  })
})

describe("symbol capabilities", () => {
  test("FIND_DEFINITION locates a symbol with file and line", () => {
    const result = CAPABILITY_FNS.FIND_DEFINITION({ target: { symbol: "create_order" }, parameters: {}, constraints: {} }, ctx())
    expect(result.evidence[0].file).toBe("app/services/order_service.py")
    expect(result.evidence[0].lineStart).toBeGreaterThan(0)
    expect(result.evidence[0].confidence).toBeGreaterThanOrEqual(0.9)
  })

  test("FIND_REFERENCES distinguishes definitions from references", () => {
    const result = CAPABILITY_FNS.FIND_REFERENCES({ target: { symbol: "OrderRequest" }, parameters: {}, constraints: {} }, ctx())
    expect(result.evidence.some((item) => item.relation === "definition")).toBe(true)
    expect(result.evidence.some((item) => item.relation === "reference")).toBe(true)
  })

  test("FIND_CALLERS produces call edges", () => {
    const result = CAPABILITY_FNS.FIND_CALLERS({ target: { symbol: "create_order" }, parameters: {}, constraints: {} }, ctx())
    expect(result.graphEdges.length).toBeGreaterThan(0)
    expect(result.graphEdges[0].relation).toBe("calls")
  })

  test("FIND_CALLEES lists called functions", () => {
    const result = CAPABILITY_FNS.FIND_CALLEES({ target: { symbol: "create_order" }, parameters: {}, constraints: {} }, ctx())
    const callees = result.evidence.map((item) => item.symbol)
    expect(callees).toContain("validate")
    expect(callees).toContain("save")
  })
})

describe("API capabilities", () => {
  test("ROUTE_SEARCH locates a FastAPI route", () => {
    const result = CAPABILITY_FNS.ROUTE_SEARCH({ target: { query: "/orders" }, parameters: {}, constraints: {} }, ctx())
    expect(result.evidence[0].relation).toBe("POST")
    expect(result.evidence[0].data?.framework).toBe("fastapi")
  })

  test("API_IMPLEMENTATION traces route to handler", () => {
    const result = CAPABILITY_FNS.API_IMPLEMENTATION({ target: { query: "/orders" }, parameters: {}, constraints: { maxDepth: 2 } }, ctx())
    expect(result.graphNodes.some((node) => node.kind === "Route")).toBe(true)
    expect(result.graphNodes.some((node) => node.kind === "Function")).toBe(true)
  })
})

describe("graph capabilities", () => {
  test("IMPORT_GRAPH builds module edges", () => {
    const result = CAPABILITY_FNS.IMPORT_GRAPH({ target: null, parameters: {}, constraints: {} }, ctx())
    expect(result.graphEdges.length).toBeGreaterThan(0)
    expect(result.graphEdges[0].relation).toBe("imports")
  })

  test("CYCLE_DETECTION finds a cycle independently of the LLM", () => {
    const result = CAPABILITY_FNS.CYCLE_DETECTION({ target: null, parameters: {}, constraints: {} }, ctx())
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(result.evidence[0].type).toBe("CYCLE")
    const path = result.evidence[0].data?.path as string[]
    expect(path.length).toBeGreaterThanOrEqual(3)
    expect(path[0]).toBe(path[path.length - 1])
  })

  test("CALL_GRAPH traverses callees up to the depth limit", () => {
    const result = CAPABILITY_FNS.CALL_GRAPH({ target: { symbol: "create_order" }, parameters: {}, constraints: { maxDepth: 2 } }, ctx())
    expect(result.graphNodes.length).toBeGreaterThan(1)
    expect(result.graphEdges.length).toBeGreaterThan(0)
  })
})

describe("verification capabilities", () => {
  test("CONFIDENCE_CHECK summarizes confidence", () => {
    const sessionWithEvidence = session()
    sessionWithEvidence.evidence.push({ id: "e1", type: "DEFINITION", file: "a", lineStart: 1, lineEnd: 1, symbol: "x", relation: null, confidence: 0.8, discoveredBy: "FIND_DEFINITION" })
    const result = CAPABILITY_FNS.CONFIDENCE_CHECK({ target: null, parameters: {}, constraints: {} }, { index, session: sessionWithEvidence })
    expect(result.meta?.average).toBeCloseTo(0.8, 5)
  })

  test("DUPLICATE_CHECK detects a repeated action", () => {
    const sessionWithActions = session()
    sessionWithActions.actions.push({ id: "pr", capability: "EXACT_SEARCH", target: { query: "x" }, parameters: {}, reason: "", expectedResult: "" })
    const result = CAPABILITY_FNS.DUPLICATE_CHECK({ target: { query: "x" }, parameters: {}, constraints: {} }, { index, session: sessionWithActions })
    expect(result.meta?.duplicates).toBeGreaterThanOrEqual(1)
  })

  test("signatureOf is stable for identical inputs", () => {
    expect(signatureOf({ target: { query: "x" }, parameters: { a: 1 } })).toBe(signatureOf({ target: { query: "x" }, parameters: { a: 1 } }))
  })
})
