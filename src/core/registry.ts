import type { Capability, CapabilityId } from "./types"

/**
 * Capability Registry (spec sections 77-79).
 * The registry describes what capabilities exist and what they cost. It never
 * decides whether a capability should run; that is JEV's job.
 */
function cap(input: Partial<Capability> & Pick<Capability, "id" | "category" | "description">): Capability {
  return {
    cost: 1,
    depthCost: 1,
    expectedInformationGain: 0.5,
    requires: [],
    produces: [],
    canRepeat: true,
    canCreateGraphEdges: false,
    ...input,
  }
}

export const BASE_CAPABILITIES: Capability[] = [
  // DISCOVERY
  cap({ id: "EXACT_SEARCH", category: "DISCOVERY", description: "Search for an exact text value.", cost: 1, depthCost: 0, expectedInformationGain: 0.7, produces: ["SEARCH_MATCH"] }),
  cap({ id: "FILENAME_SEARCH", category: "DISCOVERY", description: "Find files by name.", cost: 1, depthCost: 0, expectedInformationGain: 0.5, produces: ["SEARCH_MATCH"] }),
  cap({ id: "TEXT_SEARCH", category: "DISCOVERY", description: "Search source text with a regular expression.", cost: 1, depthCost: 0, expectedInformationGain: 0.6, produces: ["SEARCH_MATCH"] }),
  cap({ id: "FUZZY_SEARCH", category: "DISCOVERY", description: "Find approximate identifier matches and rank them.", cost: 2, depthCost: 0, expectedInformationGain: 0.8, produces: ["SEARCH_MATCH"] }),
  cap({ id: "SEMANTIC_SEARCH", category: "DISCOVERY", description: "Find code related by meaning using embeddings.", cost: 7, depthCost: 1, expectedInformationGain: 0.7, canRepeat: false, produces: ["SEARCH_MATCH"] }),

  // AST
  cap({ id: "AST_SEARCH", category: "AST", description: "Search code structures, not only source text.", cost: 2, depthCost: 1, expectedInformationGain: 0.8, produces: ["DEFINITION", "PARAMETER"] }),
  cap({ id: "AST_FUNCTION", category: "AST", description: "Inspect function structure and parameters.", cost: 2, depthCost: 1, expectedInformationGain: 0.7, produces: ["DEFINITION", "PARAMETER"] }),
  cap({ id: "AST_CLASS", category: "AST", description: "Inspect class structure.", cost: 2, depthCost: 1, expectedInformationGain: 0.6, produces: ["DEFINITION"] }),
  cap({ id: "AST_SCHEMA", category: "AST", description: "Inspect schema definitions (Pydantic, TS, Zod, OpenAPI, Frappe DocTypes, dataclasses).", cost: 2, depthCost: 1, expectedInformationGain: 0.8, produces: ["SCHEMA"] }),
  cap({ id: "AST_IMPORT", category: "AST", description: "Inspect import statements.", cost: 1, depthCost: 0, expectedInformationGain: 0.6, produces: ["IMPORT"] }),
  cap({ id: "AST_DECORATOR", category: "AST", description: "Inspect decorators and annotations.", cost: 2, depthCost: 1, expectedInformationGain: 0.6, produces: ["DECORATOR"] }),
  cap({ id: "AST_PARAMETER", category: "AST", description: "Find functions by parameter name.", cost: 2, depthCost: 1, expectedInformationGain: 0.7, produces: ["PARAMETER"] }),

  // SYMBOL
  cap({ id: "SYMBOL_SEARCH", category: "SYMBOL", description: "Find symbols by name across the codebase.", cost: 2, depthCost: 0, expectedInformationGain: 0.7, produces: ["DEFINITION"] }),
  cap({ id: "FIND_DEFINITION", category: "SYMBOL", description: "Locate the definition of a symbol.", cost: 2, depthCost: 0, expectedInformationGain: 0.8, produces: ["DEFINITION"] }),
  cap({ id: "FIND_REFERENCES", category: "SYMBOL", description: "Locate references to a symbol.", cost: 3, depthCost: 1, expectedInformationGain: 0.8, produces: ["REFERENCE"] }),
  cap({ id: "FIND_CALLERS", category: "SYMBOL", description: "Locate functions that call a target function.", cost: 3, depthCost: 1, expectedInformationGain: 0.8, canCreateGraphEdges: true, produces: ["CALL"] }),
  cap({ id: "FIND_CALLEES", category: "SYMBOL", description: "Locate functions called by a target function.", cost: 3, depthCost: 1, expectedInformationGain: 0.8, canCreateGraphEdges: true, produces: ["CALL"] }),
  cap({ id: "FIND_IMPLEMENTATIONS", category: "SYMBOL", description: "Find implementations of an interface or abstract symbol.", cost: 3, depthCost: 1, expectedInformationGain: 0.6, produces: ["DEFINITION"] }),
  cap({ id: "READ_SYMBOL", category: "SYMBOL", description: "Read the body of a symbol definition.", cost: 2, depthCost: 0, expectedInformationGain: 0.85, produces: ["DEFINITION"] }),

  // API
  cap({ id: "ROUTE_SEARCH", category: "API", description: "Locate API routes.", cost: 2, depthCost: 1, expectedInformationGain: 0.8, produces: ["ROUTE"] }),
  cap({ id: "ENDPOINT_DEFINITION", category: "API", description: "Locate the handler of an endpoint.", cost: 3, depthCost: 1, expectedInformationGain: 0.8, canCreateGraphEdges: true, produces: ["ROUTE", "DEFINITION"] }),
  cap({ id: "REQUEST_SCHEMA", category: "API", description: "Find the request schema of an endpoint.", cost: 3, depthCost: 1, expectedInformationGain: 0.7, produces: ["SCHEMA"] }),
  cap({ id: "RESPONSE_SCHEMA", category: "API", description: "Find the response schema of an endpoint.", cost: 3, depthCost: 1, expectedInformationGain: 0.7, produces: ["SCHEMA"] }),
  cap({ id: "VALIDATION", category: "API", description: "Find validation of a field or payload.", cost: 3, depthCost: 1, expectedInformationGain: 0.6, produces: ["REFERENCE"] }),
  cap({ id: "AUTHORIZATION", category: "API", description: "Find authorization rules for an endpoint.", cost: 3, depthCost: 1, expectedInformationGain: 0.5, produces: ["REFERENCE"] }),
  cap({ id: "API_IMPLEMENTATION", category: "API", description: "Trace route -> controller -> service -> repository.", cost: 4, depthCost: 1, expectedInformationGain: 0.8, canCreateGraphEdges: true, produces: ["ROUTE", "CALL"] }),

  // GRAPH
  cap({ id: "CALL_GRAPH", category: "GRAPH", description: "Construct function call relationships.", cost: 4, depthCost: 1, expectedInformationGain: 0.8, canCreateGraphEdges: true, produces: ["CALL"] }),
  cap({ id: "IMPORT_GRAPH", category: "GRAPH", description: "Construct module import relationships.", cost: 3, depthCost: 1, expectedInformationGain: 0.7, canCreateGraphEdges: true, produces: ["IMPORT"] }),
  cap({ id: "DEPENDENCY_GRAPH", category: "GRAPH", description: "Construct dependency relationships.", cost: 5, depthCost: 1, expectedInformationGain: 0.7, canCreateGraphEdges: true, produces: ["GRAPH_EDGE"] }),
  cap({ id: "REVERSE_DEPENDENCY", category: "GRAPH", description: "Find dependents of a module or symbol.", cost: 4, depthCost: 1, expectedInformationGain: 0.8, canCreateGraphEdges: true, produces: ["GRAPH_EDGE"] }),
  cap({ id: "DATA_FLOW", category: "GRAPH", description: "Trace data flow from a source to a sink.", cost: 5, depthCost: 1, expectedInformationGain: 0.6, canCreateGraphEdges: true, produces: ["GRAPH_EDGE"] }),
  cap({ id: "CYCLE_DETECTION", category: "GRAPH", description: "Detect dependency cycles independently of the LLM.", cost: 4, depthCost: 1, expectedInformationGain: 0.9, canCreateGraphEdges: true, produces: ["CYCLE"] }),

  // VERIFY
  cap({ id: "EVIDENCE_CHECK", category: "VERIFY", description: "Check whether evidence supports the hypothesis.", cost: 2, depthCost: 0, expectedInformationGain: 0.6, produces: ["NOTE"] }),
  cap({ id: "COVERAGE_CHECK", category: "VERIFY", description: "Check which investigation areas are covered.", cost: 2, depthCost: 0, expectedInformationGain: 0.6, produces: ["NOTE"] }),
  cap({ id: "DUPLICATE_CHECK", category: "VERIFY", description: "Check whether an action duplicates earlier work.", cost: 1, depthCost: 0, expectedInformationGain: 0.4, produces: ["NOTE"] }),
  cap({ id: "CONTRADICTION_CHECK", category: "VERIFY", description: "Check for conflicting evidence.", cost: 2, depthCost: 0, expectedInformationGain: 0.7, produces: ["CONTRADICTION"] }),
  cap({ id: "CONFIDENCE_CHECK", category: "VERIFY", description: "Check the confidence of the current evidence set.", cost: 2, depthCost: 0, expectedInformationGain: 0.6, produces: ["NOTE"] }),
]

export class CapabilityRegistry {
  private capabilities = new Map<CapabilityId, Capability>()

  constructor(initial: Capability[] = BASE_CAPABILITIES) {
    for (const item of initial) this.capabilities.set(item.id, item)
  }

  list(): Capability[] {
    return [...this.capabilities.values()]
  }

  ids(): CapabilityId[] {
    return [...this.capabilities.keys()]
  }

  get(id: CapabilityId): Capability | undefined {
    return this.capabilities.get(id)
  }

  has(id: CapabilityId): boolean {
    return this.capabilities.has(id)
  }

  /** Live capability addition (spec section 69). */
  register(capability: Capability): Capability {
    this.capabilities.set(capability.id, capability)
    return capability
  }

  remove(id: CapabilityId): boolean {
    return this.capabilities.delete(id)
  }

  /** JEV receives the updated registry after a live addition. */
  snapshot(): Capability[] {
    return this.list().map((item) => ({ ...item }))
  }
}

export const registry = new CapabilityRegistry()

/** Fallback names for capabilities that are not implemented in v0.1. */
export const UNIMPLEMENTED = new Set<CapabilityId>(["SEMANTIC_SEARCH"])
