import path from "node:path"
import { newEvidenceId } from "../core/ids"
import type {
  CapabilityId,
  Evidence,
  ExecutionResult,
  GraphEdge,
  GraphNode,
  InvestigationConstraints,
  InvestigationSession,
  InvestigationTarget,
} from "../core/types"
import { FILE_KIND_RANK, type FileKind } from "./fs"
import { getIndex, type CodeIndex, type SearchMatch, type SearchOptions, type SearchResult } from "./index"

export interface CapabilityContext {
  index: CodeIndex
  session: InvestigationSession
  signal?: AbortSignal
}

export interface CapabilityInput {
  target: InvestigationTarget | null
  parameters: Record<string, unknown>
  constraints: InvestigationConstraints
}

export type CapabilityFn = (input: CapabilityInput, ctx: CapabilityContext) => ExecutionResult

function evidence(input: Partial<Evidence> & Pick<Evidence, "type" | "file" | "discoveredBy">): Evidence {
  return {
    id: newEvidenceId(),
    lineStart: null,
    lineEnd: null,
    symbol: null,
    relation: null,
    confidence: 0.5,
    ...input,
  }
}

function empty(capability: CapabilityId, message: string, extra: Partial<ExecutionResult> = {}): ExecutionResult {
  return { capability, ok: true, message, evidence: [], graphNodes: [], graphEdges: [], filesTouched: [], ...extra }
}

function query(target: InvestigationTarget | null, parameters: Record<string, unknown>): string {
  return String(target?.query ?? target?.symbol ?? target?.field ?? target?.route ?? parameters.query ?? parameters.name ?? parameters.symbol ?? "").trim()
}

function limitOf(constraints: InvestigationConstraints, fallback: number): number {
  return Math.max(1, Math.min(constraints.maxResults ?? fallback, 200))
}

function touched(files: Iterable<string>): string[] {
  return [...new Set(files)]
}

function nodeId(kind: string, label: string): string {
  return `${kind}:${label}`
}

export const CAPABILITY_FNS: Record<string, CapabilityFn> = {
  EXACT_SEARCH(input, ctx) {
    const value = query(input.target, input.parameters)
    return searchResult("EXACT_SEARCH", value, ctx.index.searchExact(value, searchOptions(input)), 0.9)
  },

  TEXT_SEARCH(input, ctx) {
    const value = query(input.target, input.parameters)
    return searchResult("TEXT_SEARCH", value, ctx.index.textSearch(value, searchOptions(input)), 0.6)
  },

  FILENAME_SEARCH(input, ctx) {
    const value = query(input.target, input.parameters)
    const files = ctx.index.findFiles(value, limitOf(input.constraints, 50))
    return empty("FILENAME_SEARCH", `Found ${files.length} file(s) matching "${value}".`, {
      evidence: files.map((file) => evidence({ type: "SEARCH_MATCH", file, lineStart: 1, lineEnd: 1, confidence: 0.8, discoveredBy: "FILENAME_SEARCH", snippet: path.basename(file) })),
      filesTouched: files,
      meta: { count: files.length },
    })
  },

  FUZZY_SEARCH(input, ctx) {
    const value = query(input.target, input.parameters)
    const candidates = ctx.index.fuzzy(value, limitOf(input.constraints, 20))
    return empty("FUZZY_SEARCH", candidates.length ? `Found ${candidates.length} fuzzy candidate(s) for "${value}".` : `No fuzzy candidate for "${value}".`, {
      evidence: candidates.map((candidate) =>
        evidence({
          type: "SEARCH_MATCH",
          file: "",
          confidence: Number((candidate.score * 0.8).toFixed(3)),
          discoveredBy: "FUZZY_SEARCH",
          symbol: candidate.value,
          relation: candidate.method,
          data: { score: candidate.score, method: candidate.method },
        }),
      ),
      meta: { count: candidates.length, method: candidates[0]?.method ?? null },
    })
  },

  SEMANTIC_SEARCH() {
    return {
      capability: "SEMANTIC_SEARCH",
      ok: false,
      message: "SEMANTIC_SEARCH is not implemented in version 0.1.",
      evidence: [],
      graphNodes: [],
      graphEdges: [],
      filesTouched: [],
      error: "not_implemented",
    }
  },

  AST_SEARCH(input, ctx) {
    const parameter = input.target?.field ?? (input.parameters.param as string | undefined)
    const value = query(input.target, input.parameters)
    if (parameter) {
      const hits = ctx.index.functionsWithParameter(parameter, limitOf(input.constraints, 50))
      return empty("AST_SEARCH", `Found ${hits.length} function(s) with parameter "${parameter}".`, {
        evidence: hits.map((hit) => evidence({ type: "PARAMETER", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.symbol, confidence: 0.9, discoveredBy: "AST_SEARCH", snippet: hit.signature, data: { params: hit.params } })),
        filesTouched: touched(hits.map((hit) => hit.file)),
        meta: { count: hits.length, parameter },
      })
    }
    const hits = ctx.index.symbolSearch(value, limitOf(input.constraints, 50))
    return empty("AST_SEARCH", `Found ${hits.length} structural symbol(s) for "${value}".`, {
      evidence: hits.map((hit) => evidence({ type: "DEFINITION", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.symbol, confidence: 0.85, discoveredBy: "AST_SEARCH", snippet: hit.signature, data: { symbolType: hit.symbolType, params: hit.params } })),
      filesTouched: touched(hits.map((hit) => hit.file)),
      meta: { count: hits.length },
    })
  },

  AST_FUNCTION(input, ctx) {
    const value = query(input.target, input.parameters)
    const hits = ctx.index.symbolSearch(value, limitOf(input.constraints, 50)).filter((hit) => hit.symbolType === "function" || hit.symbolType === "method")
    return empty("AST_FUNCTION", `Found ${hits.length} function(s) for "${value}".`, {
      evidence: hits.map((hit) => evidence({ type: "DEFINITION", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.symbol, confidence: 0.9, discoveredBy: "AST_FUNCTION", snippet: hit.signature, data: { params: hit.params, container: hit.container } })),
      filesTouched: touched(hits.map((hit) => hit.file)),
      meta: { count: hits.length },
    })
  },

  AST_CLASS(input, ctx) {
    const value = query(input.target, input.parameters)
    const hits = ctx.index.symbolSearch(value, limitOf(input.constraints, 50)).filter((hit) => hit.symbolType === "class" || hit.symbolType === "interface" || hit.symbolType === "type")
    return empty("AST_CLASS", `Found ${hits.length} class/type(s) for "${value}".`, {
      evidence: hits.map((hit) => evidence({ type: "DEFINITION", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.symbol, confidence: 0.9, discoveredBy: "AST_CLASS", snippet: hit.signature })),
      filesTouched: touched(hits.map((hit) => hit.file)),
      meta: { count: hits.length },
    })
  },

  AST_SCHEMA(input, ctx) {
    const value = query(input.target, input.parameters).toLowerCase()
    const field = input.target?.field?.toLowerCase()
    const schemas = ctx.index.allSchemas().filter((schema) => {
      if (field && schema.fields.some((item) => item.toLowerCase() === field)) return true
      if (!value) return true
      return schema.name.toLowerCase().includes(value)
    })
    const out: Evidence[] = []
    for (const schema of schemas) {
      out.push(evidence({ type: "SCHEMA", file: schema.file, lineStart: schema.line, lineEnd: schema.line, symbol: schema.name, confidence: 0.85, discoveredBy: "AST_SCHEMA", data: { system: schema.system, fields: schema.fields } }))
      for (const name of schema.fields) {
        out.push(evidence({ type: "SCHEMA", file: schema.file, lineStart: schema.line, lineEnd: schema.line, symbol: `${schema.name}.${name}`, relation: "field", confidence: 0.8, discoveredBy: "AST_SCHEMA", data: { system: schema.system, parent: schema.name } }))
      }
    }
    return empty("AST_SCHEMA", `Found ${schemas.length} schema definition(s).`, {
      evidence: out,
      filesTouched: touched(schemas.map((schema) => schema.file)),
      meta: { count: schemas.length, systems: [...new Set(schemas.map((schema) => schema.system))] },
    })
  },

  AST_IMPORT(input, ctx) {
    const value = query(input.target, input.parameters).toLowerCase()
    const imports = ctx.index.allImports().filter((item) => !value || item.source.toLowerCase().includes(value) || item.names.some((name) => name.toLowerCase().includes(value)))
    return empty("AST_IMPORT", `Found ${imports.length} import(s).`, {
      evidence: imports.map((item) => evidence({ type: "IMPORT", file: item.file, lineStart: item.line, lineEnd: item.line, symbol: item.source, confidence: 0.9, discoveredBy: "AST_IMPORT", data: { names: item.names } })),
      filesTouched: touched(imports.map((item) => item.file)),
      meta: { count: imports.length },
    })
  },

  AST_DECORATOR(input, ctx) {
    const value = query(input.target, input.parameters).toLowerCase()
    const out: Evidence[] = []
    for (const index of ctx.index.fileIndexes()) {
      for (let i = 0; i < index.lines.length; i++) {
        const line = index.lines[i].trim()
        if (!line.startsWith("@")) continue
        if (value && !line.toLowerCase().includes(value)) continue
        out.push(evidence({ type: "DECORATOR", file: index.file, lineStart: i + 1, lineEnd: i + 1, symbol: line.slice(0, 120), confidence: 0.85, discoveredBy: "AST_DECORATOR", snippet: line.slice(0, 200) }))
        if (out.length >= limitOf(input.constraints, 50)) break
      }
    }
    return empty("AST_DECORATOR", `Found ${out.length} decorator(s).`, { evidence: out, filesTouched: touched(out.map((item) => item.file)), meta: { count: out.length } })
  },

  AST_PARAMETER(input, ctx) {
    const parameter = String(input.target?.field ?? input.parameters.param ?? query(input.target, input.parameters))
    const hits = ctx.index.functionsWithParameter(parameter, limitOf(input.constraints, 50))
    return empty("AST_PARAMETER", `Found ${hits.length} function(s) with parameter "${parameter}".`, {
      evidence: hits.map((hit) => evidence({ type: "PARAMETER", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.symbol, confidence: 0.9, discoveredBy: "AST_PARAMETER", snippet: hit.signature, data: { params: hit.params } })),
      filesTouched: touched(hits.map((hit) => hit.file)),
      meta: { count: hits.length, parameter },
    })
  },

  SYMBOL_SEARCH(input, ctx) {
    const value = query(input.target, input.parameters)
    const hits = ctx.index.symbolSearch(value, limitOf(input.constraints, 50))
    return empty("SYMBOL_SEARCH", `Found ${hits.length} symbol(s) for "${value}".`, {
      evidence: hits.map((hit) => evidence({ type: "DEFINITION", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.symbol, confidence: 0.85, discoveredBy: "SYMBOL_SEARCH", snippet: hit.signature, data: { symbolType: hit.symbolType } })),
      filesTouched: touched(hits.map((hit) => hit.file)),
      meta: { count: hits.length },
    })
  },

  FIND_DEFINITION(input, ctx) {
    const value = query(input.target, input.parameters)
    const hits = ctx.index.findDefinition(value, limitOf(input.constraints, 50))
    return empty("FIND_DEFINITION", hits.length ? `Found ${hits.length} definition(s) for "${value}".` : `No definition found for "${value}" in the explored codebase.`, {
      evidence: hits.map((hit) => evidence({ type: "DEFINITION", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.symbol, confidence: 0.95, discoveredBy: "FIND_DEFINITION", snippet: hit.signature, data: { symbolType: hit.symbolType, container: hit.container } })),
      filesTouched: touched(hits.map((hit) => hit.file)),
      meta: { count: hits.length },
    })
  },

  FIND_REFERENCES(input, ctx) {
    const value = query(input.target, input.parameters)
    const hits = ctx.index.findReferences(value, limitOf(input.constraints, 100))
    return empty("FIND_REFERENCES", `Found ${hits.length} reference(s) for "${value}" in the explored codebase.`, {
      evidence: hits.map((hit) => evidence({ type: "REFERENCE", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.symbol, relation: hit.referenceType, confidence: hit.referenceType === "definition" ? 0.95 : 0.7, discoveredBy: "FIND_REFERENCES", snippet: hit.text })),
      filesTouched: touched(hits.map((hit) => hit.file)),
      meta: { count: hits.length },
    })
  },

  FIND_CALLERS(input, ctx) {
    const value = query(input.target, input.parameters)
    const hits = ctx.index.findCallers(value, limitOf(input.constraints, 100))
    const target = value.split(".").pop() as string
    return empty("FIND_CALLERS", `Found ${hits.length} caller(s) of "${target}" in the explored codebase.`, {
      evidence: hits.map((hit) => evidence({ type: "CALL", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.caller, relation: "calls", confidence: 0.75, discoveredBy: "FIND_CALLERS", snippet: hit.text, data: { callee: target } })),
      graphEdges: hits.map((hit) => ({ id: `${hit.caller}->${target}`, from: hit.caller, to: target, relation: "calls" as const, confidence: 0.75 })),
      filesTouched: touched(hits.map((hit) => hit.file)),
      meta: { count: hits.length, target },
    })
  },

  FIND_CALLEES(input, ctx) {
    const value = query(input.target, input.parameters)
    const hits = ctx.index.findCallees(value, limitOf(input.constraints, 100))
    const source = value.split(".").pop() as string
    return empty("FIND_CALLEES", `Found ${hits.length} callee(s) of "${source}" in the explored codebase.`, {
      evidence: hits.map((hit) => evidence({ type: "CALL", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.callee, relation: "called_by", confidence: 0.75, discoveredBy: "FIND_CALLEES", data: { caller: source } })),
      graphEdges: hits.map((hit) => ({ id: `${source}->${hit.callee}`, from: source, to: hit.callee, relation: "calls" as const, confidence: 0.75 })),
      filesTouched: touched(hits.map((hit) => hit.file)),
      meta: { count: hits.length, source },
    })
  },

  READ_SYMBOL(input, ctx) {
    const value = query(input.target, input.parameters)
    const hits = ctx.index.findDefinition(value, 5)
    const out: Evidence[] = []
    for (const hit of hits) {
      const file = ctx.index.getFile(hit.file)
      const body = file ? file.lines.slice(hit.line - 1, Math.min(hit.endLine, hit.line + 79)).join("\n") : ""
      out.push(
        evidence({
          type: "DEFINITION",
          file: hit.file,
          lineStart: hit.line,
          lineEnd: hit.endLine,
          symbol: hit.symbol,
          relation: "body",
          confidence: 0.95,
          discoveredBy: "READ_SYMBOL",
          snippet: body.slice(0, 4000),
          data: { symbolType: hit.symbolType, params: hit.params, signature: hit.signature, lines: hit.endLine - hit.line + 1 },
        }),
      )
    }
    return empty("READ_SYMBOL", hits.length ? `Read ${hits.length} definition body(ies) for "${value}".` : `No definition found for "${value}" in the explored codebase.`, {
      evidence: out,
      filesTouched: touched(out.map((item) => item.file)),
      meta: { count: hits.length },
    })
  },

  FIND_IMPLEMENTATIONS(input, ctx) {
    const value = query(input.target, input.parameters)
    const hits = ctx.index.findImplementations(value, limitOf(input.constraints, 50))
    return empty("FIND_IMPLEMENTATIONS", `Found ${hits.length} implementation(s) of "${value}".`, {
      evidence: hits.map((hit) => evidence({ type: "DEFINITION", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: hit.symbol, relation: "implements", confidence: 0.7, discoveredBy: "FIND_IMPLEMENTATIONS", snippet: hit.signature })),
      filesTouched: touched(hits.map((hit) => hit.file)),
      meta: { count: hits.length },
    })
  },

  ROUTE_SEARCH(input, ctx) {
    const value = query(input.target, input.parameters).toLowerCase()
    const method = String(input.parameters.method ?? "").toUpperCase()
    const routes = ctx.index.allRoutes().filter((route) => {
      if (method && route.method !== method) return false
      if (!value) return true
      return route.path.toLowerCase().includes(value) || (route.handler ?? "").toLowerCase().includes(value)
    })
    return empty("ROUTE_SEARCH", `Found ${routes.length} route(s).`, {
      evidence: routes.map((route) => evidence({ type: "ROUTE", file: route.file, lineStart: route.line, lineEnd: route.line, symbol: route.handler, relation: route.method, confidence: 0.85, discoveredBy: "ROUTE_SEARCH", data: { path: route.path, method: route.method, framework: route.framework } })),
      filesTouched: touched(routes.map((route) => route.file)),
      meta: { count: routes.length },
    })
  },

  ENDPOINT_DEFINITION(input, ctx) {
    const value = query(input.target, input.parameters).toLowerCase()
    const routes = ctx.index.allRoutes().filter((route) => route.path.toLowerCase().includes(value) || (route.handler ?? "").toLowerCase().includes(value))
    const out: Evidence[] = []
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    for (const route of routes) {
      out.push(evidence({ type: "ROUTE", file: route.file, lineStart: route.line, lineEnd: route.line, symbol: route.handler, relation: route.method, confidence: 0.85, discoveredBy: "ENDPOINT_DEFINITION", data: { path: route.path, framework: route.framework } }))
      nodes.push({ id: nodeId("Route", `${route.method} ${route.path}`), kind: "Route", label: `${route.method} ${route.path}`, file: route.file, line: route.line })
      if (route.handler) {
        const defs = ctx.index.findDefinition(route.handler, 5)
        for (const def of defs) {
          out.push(evidence({ type: "DEFINITION", file: def.file, lineStart: def.line, lineEnd: def.line, symbol: def.symbol, relation: "handles", confidence: 0.9, discoveredBy: "ENDPOINT_DEFINITION", snippet: def.signature }))
          nodes.push({ id: nodeId("Function", def.symbol), kind: "Function", label: def.symbol, file: def.file, line: def.line })
          edges.push({ id: `${route.path}->${def.symbol}`, from: nodeId("Route", `${route.method} ${route.path}`), to: nodeId("Function", def.symbol), relation: "exposes", confidence: 0.9 })
        }
      }
    }
    return empty("ENDPOINT_DEFINITION", `Resolved ${routes.length} endpoint(s).`, { evidence: out, graphNodes: nodes, graphEdges: edges, filesTouched: touched(out.map((item) => item.file)), meta: { count: routes.length } })
  },

  REQUEST_SCHEMA(input, ctx) {
    return schemaFor(input, ctx, "REQUEST_SCHEMA")
  },

  RESPONSE_SCHEMA(input, ctx) {
    return schemaFor(input, ctx, "RESPONSE_SCHEMA")
  },

  VALIDATION(input, ctx) {
    const value = query(input.target, input.parameters) || (input.target?.field ?? "")
    const matches = ctx.index.textSearch(`(validate|validation|check|assert|is_valid|Validator|min_length|max_length|required).*${value}`, searchOptions(input)).matches
    return empty("VALIDATION", `Found ${matches.length} validation-related match(es) for "${value}".`, {
      evidence: matches.map((match) => evidence({ type: "REFERENCE", file: match.file, lineStart: match.line, lineEnd: match.line, symbol: value, relation: "validates", confidence: 0.6, discoveredBy: "VALIDATION", snippet: match.text })),
      filesTouched: touched(matches.map((match) => match.file)),
      meta: { count: matches.length },
    })
  },

  AUTHORIZATION(input, ctx) {
    const value = query(input.target, input.parameters)
    const matches = ctx.index.textSearch(`(auth|permission|guard|login_required|requires|role|scope|@UseGuards|Depends\\()).*${value}`, searchOptions(input)).matches
    return empty("AUTHORIZATION", `Found ${matches.length} authorization-related match(es).`, {
      evidence: matches.map((match) => evidence({ type: "REFERENCE", file: match.file, lineStart: match.line, lineEnd: match.line, symbol: value, relation: "authorizes", confidence: 0.55, discoveredBy: "AUTHORIZATION", snippet: match.text })),
      filesTouched: touched(matches.map((match) => match.file)),
      meta: { count: matches.length },
    })
  },

  API_IMPLEMENTATION(input, ctx) {
    const value = query(input.target, input.parameters).toLowerCase()
    const routeResult = CAPABILITY_FNS.ROUTE_SEARCH({ target: { query: value }, parameters: input.parameters, constraints: { ...input.constraints, maxResults: 10 } }, ctx)
    const out: Evidence[] = [...routeResult.evidence]
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    for (const item of routeResult.evidence) {
      const path = String(item.data?.path ?? "")
      const method = item.relation ?? "ANY"
      const routeId = nodeId("Route", `${method} ${path}`)
      nodes.push({ id: routeId, kind: "Route", label: `${method} ${path}`, file: item.file, line: item.lineStart })
      if (item.symbol) edges.push({ id: `${routeId}->${item.symbol}`, from: routeId, to: nodeId("Function", item.symbol), relation: "exposes", confidence: 0.85 })
    }
    const handlers = routeResult.evidence.map((item) => item.symbol).filter((symbol): symbol is string => Boolean(symbol))
    for (const handler of handlers) {
      const definition = ctx.index.findDefinition(handler, 1)[0]
      if (definition) nodes.push({ id: nodeId("Function", handler), kind: "Function", label: handler, file: definition.file, line: definition.line })
      const callGraph = ctx.index.callGraph(handler, Math.min(input.constraints.maxDepth ?? 2, 3), Math.min(input.constraints.maxNodes ?? 40, 60))
      nodes.push(...callGraph.nodes)
      edges.push(...callGraph.edges)
      for (const node of callGraph.nodes) {
        if (node.id === handler) continue
        out.push(evidence({ type: "CALL", file: node.file ?? "", lineStart: node.line ?? null, lineEnd: node.line ?? null, symbol: node.label, relation: "calls", confidence: 0.7, discoveredBy: "API_IMPLEMENTATION" }))
      }
    }
    return empty("API_IMPLEMENTATION", `Traced ${handlers.length} handler(s).`, { evidence: out, graphNodes: nodes, graphEdges: edges, filesTouched: touched(out.map((item) => item.file).filter(Boolean)), meta: { handlers } })
  },

  CALL_GRAPH(input, ctx) {
    const value = query(input.target, input.parameters)
    const graph = ctx.index.callGraph(value, input.constraints.maxDepth ?? 2, input.constraints.maxNodes ?? 100)
    return empty("CALL_GRAPH", `Built a call graph for "${value}" with ${graph.nodes.length} node(s) and ${graph.edges.length} edge(s).`, {
      evidence: graph.edges.map((edge) => evidence({ type: "GRAPH_EDGE", file: "", confidence: edge.confidence, discoveredBy: "CALL_GRAPH", symbol: edge.to, relation: edge.relation, data: { from: edge.from, to: edge.to } })),
      graphNodes: graph.nodes,
      graphEdges: graph.edges,
      meta: { nodes: graph.nodes.length, edges: graph.edges.length },
    })
  },

  IMPORT_GRAPH(input, ctx) {
    const graph = ctx.index.importGraph(limitOf(input.constraints, 200))
    return empty("IMPORT_GRAPH", `Built an import graph with ${graph.nodes.length} node(s) and ${graph.edges.length} edge(s).`, {
      evidence: graph.edges.map((edge) => evidence({ type: "IMPORT", file: edge.from, lineStart: null, lineEnd: null, symbol: edge.to, relation: "imports", confidence: 0.85, discoveredBy: "IMPORT_GRAPH" })),
      graphNodes: graph.nodes,
      graphEdges: graph.edges,
      meta: { nodes: graph.nodes.length, edges: graph.edges.length },
    })
  },

  DEPENDENCY_GRAPH(input, ctx) {
    const graph = ctx.index.importGraph(limitOf(input.constraints, 300))
    return empty("DEPENDENCY_GRAPH", `Built a dependency graph with ${graph.nodes.length} node(s) and ${graph.edges.length} edge(s).`, {
      evidence: graph.edges.map((edge) => evidence({ type: "GRAPH_EDGE", file: edge.from, confidence: 0.8, discoveredBy: "DEPENDENCY_GRAPH", symbol: edge.to, relation: "depends_on" })),
      graphNodes: graph.nodes,
      graphEdges: graph.edges,
      meta: { nodes: graph.nodes.length, edges: graph.edges.length },
    })
  },

  REVERSE_DEPENDENCY(input, ctx) {
    const value = input.target?.file ?? query(input.target, input.parameters)
    const graph = ctx.index.reverseDependency(value, limitOf(input.constraints, 100))
    return empty("REVERSE_DEPENDENCY", `Found ${graph.edges.length} dependent(s) of "${value}".`, {
      evidence: graph.edges.map((edge) => evidence({ type: "GRAPH_EDGE", file: edge.from, confidence: edge.confidence, discoveredBy: "REVERSE_DEPENDENCY", symbol: edge.to, relation: "imported_by" })),
      graphNodes: graph.nodes,
      graphEdges: graph.edges,
      meta: { count: graph.edges.length },
    })
  },

  DATA_FLOW(input, ctx) {
    const value = query(input.target, input.parameters)
    const references = ctx.index.findReferences(value, limitOf(input.constraints, 100))
    const edges: GraphEdge[] = references.map((hit) => ({ id: `${hit.file}:${hit.line}->${value}`, from: hit.file, to: value, relation: "references" as const, confidence: 0.6 }))
    return empty("DATA_FLOW", `Traced ${references.length} reference(s) related to "${value}".`, {
      evidence: references.map((hit) => evidence({ type: "REFERENCE", file: hit.file, lineStart: hit.line, lineEnd: hit.line, symbol: value, relation: "reads", confidence: 0.6, discoveredBy: "DATA_FLOW", snippet: hit.text })),
      graphEdges: edges,
      filesTouched: touched(references.map((hit) => hit.file)),
      meta: { count: references.length },
    })
  },

  CYCLE_DETECTION(input, ctx) {
    const cycles = ctx.index.cycles(limitOf(input.constraints, 20))
    const out: Evidence[] = []
    const edges: GraphEdge[] = []
    for (const cycle of cycles) {
      out.push(evidence({ type: "CYCLE", file: cycle[0] ?? "", lineStart: null, lineEnd: null, symbol: cycle.join(" -> "), relation: "cycle", confidence: 0.95, discoveredBy: "CYCLE_DETECTION", data: { path: cycle } }))
      for (let i = 0; i + 1 < cycle.length; i++) {
        edges.push({ id: `cycle:${cycle[i]}->${cycle[i + 1]}`, from: cycle[i], to: cycle[i + 1], relation: "imports", confidence: 0.9 })
      }
    }
    return empty("CYCLE_DETECTION", `Detected ${cycles.length} import cycle(s).`, { evidence: out, graphEdges: edges, meta: { cycles } })
  },

  EVIDENCE_CHECK(input, ctx) {
    const total = ctx.session.evidence.length
    const strong = ctx.session.evidence.filter((item) => item.confidence >= 0.7).length
    const hypothesis = ctx.session.hypothesis
    return empty("EVIDENCE_CHECK", `Evidence check: ${total} item(s), ${strong} strong.${hypothesis ? ` Hypothesis: ${hypothesis}` : ""}`, {
      evidence: [evidence({ type: "NOTE", file: "", confidence: total ? 0.6 : 0.2, discoveredBy: "EVIDENCE_CHECK", symbol: "evidence-summary", data: { total, strong, hypothesis } })],
      meta: { total, strong, hypothesis },
    })
  },

  COVERAGE_CHECK(input, ctx) {
    const used = new Set(ctx.session.actions.map((action) => action.capability))
    const categories = {
      DISCOVERY: ["EXACT_SEARCH", "FUZZY_SEARCH", "TEXT_SEARCH", "FILENAME_SEARCH", "SEMANTIC_SEARCH"],
      AST: ["AST_SEARCH", "AST_FUNCTION", "AST_CLASS", "AST_SCHEMA", "AST_IMPORT", "AST_DECORATOR", "AST_PARAMETER"],
      SYMBOL: ["SYMBOL_SEARCH", "FIND_DEFINITION", "FIND_REFERENCES", "FIND_CALLERS", "FIND_CALLEES", "FIND_IMPLEMENTATIONS"],
      API: ["ROUTE_SEARCH", "ENDPOINT_DEFINITION", "REQUEST_SCHEMA", "RESPONSE_SCHEMA", "VALIDATION", "AUTHORIZATION", "API_IMPLEMENTATION"],
      GRAPH: ["CALL_GRAPH", "IMPORT_GRAPH", "DEPENDENCY_GRAPH", "REVERSE_DEPENDENCY", "DATA_FLOW", "CYCLE_DETECTION"],
    } as const
    const covered: string[] = []
    const missing: string[] = []
    for (const [category, capabilities] of Object.entries(categories)) {
      if (capabilities.some((capability) => used.has(capability))) covered.push(category)
      else missing.push(category)
    }
    return empty("COVERAGE_CHECK", `Covered categories: ${covered.join(", ") || "none"}. Uncovered: ${missing.join(", ") || "none"}.`, {
      evidence: [evidence({ type: "NOTE", file: "", confidence: 0.7, discoveredBy: "COVERAGE_CHECK", symbol: "coverage", data: { covered, missing } })],
      meta: { covered, missing },
    })
  },

  DUPLICATE_CHECK(input, ctx) {
    const key = signatureOf(input)
    const duplicates = ctx.session.actions.filter((action) => signatureOf({ target: action.target, parameters: action.parameters }) === key).length
    return empty("DUPLICATE_CHECK", duplicates >= 1 ? `This action was already executed ${duplicates} time(s).` : "No duplicate action detected.", {
      evidence: [evidence({ type: "NOTE", file: "", confidence: 0.9, discoveredBy: "DUPLICATE_CHECK", symbol: "duplicate-check", data: { duplicates } })],
      meta: { duplicates, key },
    })
  },

  CONTRADICTION_CHECK(input, ctx) {
    const contradictions: Array<{ a: string; b: string }> = []
    const definitions = ctx.session.evidence.filter((item) => item.type === "DEFINITION" && item.symbol)
    const references = ctx.session.evidence.filter((item) => item.type === "REFERENCE" && item.symbol)
    for (const def of definitions) {
      for (const ref of references) {
        if (def.symbol !== ref.symbol) continue
        if (def.file === ref.file) continue
        contradictions.push({ a: `${def.symbol} defined in ${def.file}`, b: `${ref.symbol} referenced in ${ref.file}` })
      }
    }
    return empty("CONTRADICTION_CHECK", contradictions.length ? `Found ${contradictions.length} potential contradiction(s).` : "No contradiction detected.", {
      evidence: contradictions.map((item) => evidence({ type: "CONTRADICTION", file: "", confidence: 0.5, discoveredBy: "CONTRADICTION_CHECK", symbol: item.a, data: item })),
      meta: { contradictions },
    })
  },

  CONFIDENCE_CHECK(input, ctx) {
    const values = ctx.session.evidence.map((item) => item.confidence)
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
    const min = values.length ? Math.min(...values) : 0
    const max = values.length ? Math.max(...values) : 0
    return empty("CONFIDENCE_CHECK", `Evidence confidence: average ${average.toFixed(2)}, min ${min.toFixed(2)}, max ${max.toFixed(2)}.`, {
      evidence: [evidence({ type: "NOTE", file: "", confidence: 0.7, discoveredBy: "CONFIDENCE_CHECK", symbol: "confidence", data: { average, min, max, count: values.length } })],
      meta: { average, min, max, count: values.length },
    })
  },
}

function searchOptions(input: CapabilityInput): SearchOptions {
  const target = input.target ?? {}
  return {
    limit: limitOf(input.constraints, 50),
    offset: Number(input.parameters.offset ?? 0),
    pathPrefix: (input.parameters.pathPrefix as string | undefined) ?? target.file ?? undefined,
    caseSensitive: Boolean(input.parameters.caseSensitive),
    kinds: input.parameters.kinds as FileKind[] | undefined,
  }
}

function confidenceForMatch(match: SearchMatch, base: number): number {
  const kindFactor = match.kind === "definition" ? 1 : 0.75
  return Number((base * kindFactor * (0.5 + 0.5 * FILE_KIND_RANK[match.fileKind])).toFixed(3))
}

/** Build evidence, a truncation-aware message and per-file counts for a search. */
function searchResult(capability: CapabilityId, value: string, search: SearchResult, baseConfidence: number): ExecutionResult {
  const byFile = new Map<string, number>()
  for (const match of search.matches) byFile.set(match.file, (byFile.get(match.file) ?? 0) + 1)
  const topFiles = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([file, count]) => ({ file, count }))
  const truncated = search.truncated
  const message =
    search.total === 0
      ? `No ${capability} match for "${value}" in the explored codebase.`
      : `Found ${search.total} match(es) for "${value}"; showing ${search.matches.length}${truncated ? " (truncated, narrow with pathPrefix)" : ""}. Top files: ${topFiles.slice(0, 5).map((item) => `${item.file} (${item.count})`).join(", ") || "(none)"}`
  return empty(capability, message, {
    evidence: search.matches.map((match) =>
      evidence({
        type: match.kind === "definition" ? "DEFINITION" : "SEARCH_MATCH",
        file: match.file,
        lineStart: match.line,
        lineEnd: match.line,
        confidence: confidenceForMatch(match, baseConfidence),
        discoveredBy: capability,
        relation: match.kind,
        symbol: match.symbol ?? null,
        snippet: match.text,
        data: { column: match.column, query: value, fileKind: match.fileKind },
      }),
    ),
    filesTouched: touched(search.matches.map((match) => match.file)),
    meta: { count: search.matches.length, total: search.total, truncated, query: value, byFile: topFiles },
  })
}

export function signatureOf(input: { target: InvestigationTarget | null; parameters: Record<string, unknown> }): string {
  const target = input.target ?? {}
  return [target.query ?? target.symbol ?? target.file ?? target.route ?? target.field ?? "", JSON.stringify(input.parameters ?? {})].join("|")
}

function schemaFor(input: CapabilityInput, ctx: CapabilityContext, capability: "REQUEST_SCHEMA" | "RESPONSE_SCHEMA"): ExecutionResult {
  const value = query(input.target, input.parameters).toLowerCase()
  const field = input.target?.field?.toLowerCase()
  const schemas = ctx.index.allSchemas().filter((schema) => {
    if (field && schema.fields.some((item) => item.toLowerCase() === field)) return true
    if (!value) return true
    return schema.name.toLowerCase().includes(value)
  })
  const out = schemas.flatMap((schema) => [
    evidence({ type: "SCHEMA", file: schema.file, lineStart: schema.line, lineEnd: schema.line, symbol: schema.name, relation: capability === "REQUEST_SCHEMA" ? "accepts" : "returns", confidence: 0.75, discoveredBy: capability, data: { system: schema.system, fields: schema.fields } }),
    ...schema.fields.map((name) => evidence({ type: "SCHEMA", file: schema.file, lineStart: schema.line, lineEnd: schema.line, symbol: `${schema.name}.${name}`, relation: "field", confidence: 0.7, discoveredBy: capability })),
  ])
  return empty(capability, `Found ${schemas.length} ${capability === "REQUEST_SCHEMA" ? "request" : "response"} schema(s).`, {
    evidence: out,
    filesTouched: touched(schemas.map((schema) => schema.file)),
    meta: { count: schemas.length },
  })
}

export function hasCapability(id: CapabilityId): boolean {
  return id in CAPABILITY_FNS
}

export function runCapability(id: CapabilityId, input: CapabilityInput, ctx: CapabilityContext): Promise<ExecutionResult> {
  const fn = CAPABILITY_FNS[id]
  if (!fn) {
    return Promise.resolve({
      capability: id,
      ok: false,
      message: `Capability ${id} is not implemented.`,
      evidence: [],
      graphNodes: [],
      graphEdges: [],
      filesTouched: [],
      error: "not_implemented",
    })
  }
  try {
    return Promise.resolve(fn(input, ctx))
  } catch (error) {
    return Promise.resolve({
      capability: id,
      ok: false,
      message: `Capability ${id} failed: ${(error as Error).message}`,
      evidence: [],
      graphNodes: [],
      graphEdges: [],
      filesTouched: [],
      error: (error as Error).message,
    })
  }
}
