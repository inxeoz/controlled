import path from "node:path"
import { detectJsonSchema, detectRoutes, detectSchemas, type RouteDef, type SchemaDef } from "./frameworks"
import { classifyFile, FILE_KIND_RANK, languageOf, normalizePath, readText, walk, type FileKind, type WalkedFile } from "./fs"
import { parseFile, type CallSite, type FileIndex, type ImportDef, type SymbolDef } from "./lang"
import { rankCandidates } from "./similarity"
import { findCycles } from "./graph-utils"
import type { GraphEdge, GraphNode } from "../core/types"

export interface SearchMatch {
  file: string
  line: number
  text: string
  column: number
  /** A definition line outranks a plain reference. */
  kind: "definition" | "reference"
  fileKind: FileKind
  /** The declared symbol when the match is a definition line. */
  symbol?: string | null
}

export interface SearchResult {
  matches: SearchMatch[]
  total: number
  truncated: boolean
}

export interface SearchOptions {
  limit?: number
  offset?: number
  caseSensitive?: boolean
  /** Restrict the search to paths starting with this prefix. */
  pathPrefix?: string
  /** Restrict the search to these file kinds. */
  kinds?: FileKind[]
}

export interface SymbolHit {
  file: string
  line: number
  endLine: number
  symbol: string
  symbolType: string
  container: string | null
  signature: string
  params: string[]
}

export interface ReferenceHit {
  file: string
  line: number
  symbol: string
  referenceType: string
  text: string
}

const cache = new Map<string, CodeIndex>()

export function getIndex(root: string): CodeIndex {
  const key = path.resolve(root)
  const existing = cache.get(key)
  if (existing) return existing
  const created = new CodeIndex(key)
  cache.set(key, created)
  return created
}

export function clearIndexCache(): void {
  cache.clear()
}

export class CodeIndex {
  readonly root: string
  private built = false
  private files: WalkedFile[] = []
  private indexes = new Map<string, FileIndex>()
  private routes: RouteDef[] = []
  private schemas: SchemaDef[] = []

  constructor(root: string) {
    this.root = root
  }

  ensure(): void {
    if (this.built) return
    this.built = true
    this.files = walk(this.root)
    for (const file of this.files) {
      const ext = file.ext
      const language = languageOf(ext)
      const text = readText(file.absolute)
      const relative = normalizePath(file.relative)
      if (language !== "text") {
        const index = parseFile(relative, text, language)
        this.indexes.set(relative, index)
        this.routes.push(...detectRoutes(index))
        this.schemas.push(...detectSchemas(index))
      }
      const jsonHit = detectJsonSchema(relative, text)
      if (jsonHit) {
        this.schemas.push({ file: relative, line: 1, name: jsonHit.name, system: jsonHit.system, fields: jsonHit.fields })
      }
    }
  }

  fileList(): string[] {
    this.ensure()
    return this.files.map((file) => normalizePath(file.relative))
  }

  fileIndexes(): FileIndex[] {
    this.ensure()
    return [...this.indexes.values()]
  }

  getFile(relative: string): FileIndex | undefined {
    this.ensure()
    return this.indexes.get(normalizePath(relative))
  }

  allSymbols(): SymbolDef[] {
    this.ensure()
    return [...this.indexes.values()].flatMap((index) => index.symbols)
  }

  allRoutes(): RouteDef[] {
    this.ensure()
    return this.routes
  }

  allSchemas(): SchemaDef[] {
    this.ensure()
    return this.schemas
  }

  allImports(): ImportDef[] {
    this.ensure()
    return [...this.indexes.values()].flatMap((index) => index.imports)
  }

  allCalls(): CallSite[] {
    this.ensure()
    return [...this.indexes.values()].flatMap((index) => index.calls)
  }

  findFiles(pattern: string, limit = 50): string[] {
    this.ensure()
    const needle = pattern.toLowerCase()
    return this.fileList()
      .filter((file) => file.toLowerCase().includes(needle))
      .sort((a, b) => FILE_KIND_RANK[classifyFile(b)] - FILE_KIND_RANK[classifyFile(a)] || a.length - b.length)
      .slice(0, limit)
  }

  searchExact(query: string, options: SearchOptions = {}): SearchResult {
    this.ensure()
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0
    const needle = options.caseSensitive ? query : query.toLowerCase()
    const prefix = options.pathPrefix ? normalizePath(options.pathPrefix) : ""
    const collected: SearchMatch[] = []
    const MAX_SCAN = 5000
    const matchesAllowed = (file: string, fileKind: FileKind) => {
      if (prefix && !file.startsWith(prefix)) return false
      if (options.kinds && !options.kinds.includes(fileKind)) return false
      return true
    }
    for (const index of this.indexes.values()) {
      const fileKind = classifyFile(index.file)
      if (!matchesAllowed(index.file, fileKind)) continue
      for (let i = 0; i < index.lines.length; i++) {
        const line = index.lines[i]
        const haystack = options.caseSensitive ? line : line.toLowerCase()
        const column = haystack.indexOf(needle)
        if (column < 0) continue
        const symbol = index.symbols.find((item) => item.line === i + 1)
        collected.push({ file: index.file, line: i + 1, text: line.trim().slice(0, 300), column, kind: symbol ? "definition" : "reference", fileKind, symbol: symbol?.name ?? null })
        if (collected.length >= MAX_SCAN) break
      }
      if (collected.length >= MAX_SCAN) break
    }
    if (collected.length < MAX_SCAN) {
      for (const file of this.files) {
        const relative = normalizePath(file.relative)
        if (this.indexes.has(relative)) continue
        const fileKind = classifyFile(relative)
        if (!matchesAllowed(relative, fileKind)) continue
        const text = readText(file.absolute)
        const lines = text.split("\n")
        for (let i = 0; i < lines.length; i++) {
          const haystack = options.caseSensitive ? lines[i] : lines[i].toLowerCase()
          const column = haystack.indexOf(needle)
          if (column < 0) continue
          collected.push({ file: relative, line: i + 1, text: lines[i].trim().slice(0, 300), column, kind: "reference", fileKind })
          if (collected.length >= MAX_SCAN) break
        }
        if (collected.length >= MAX_SCAN) break
      }
    }
    const ranked = rankMatches(collected)
    const matches = ranked.slice(offset, offset + limit)
    return { matches, total: ranked.length, truncated: ranked.length > offset + matches.length }
  }

  exactSearch(query: string, options: SearchOptions = {}): SearchMatch[] {
    return this.searchExact(query, options).matches
  }

  textSearch(pattern: string, options: SearchOptions = {}): SearchResult {
    this.ensure()
    let regex: RegExp
    try {
      regex = new RegExp(pattern, "i")
    } catch {
      return this.searchExact(pattern, options)
    }
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0
    const prefix = options.pathPrefix ? normalizePath(options.pathPrefix) : ""
    const collected: SearchMatch[] = []
    for (const index of this.indexes.values()) {
      const fileKind = classifyFile(index.file)
      if (prefix && !index.file.startsWith(prefix)) continue
      if (options.kinds && !options.kinds.includes(fileKind)) continue
      for (let i = 0; i < index.lines.length; i++) {
        const match = regex.exec(index.lines[i])
        if (!match) continue
        const symbol = index.symbols.find((item) => item.line === i + 1)
        collected.push({ file: index.file, line: i + 1, text: index.lines[i].trim().slice(0, 300), column: match.index, kind: symbol ? "definition" : "reference", fileKind, symbol: symbol?.name ?? null })
        if (collected.length >= 5000) break
      }
    }
    const ranked = rankMatches(collected)
    const matches = ranked.slice(offset, offset + limit)
    return { matches, total: ranked.length, truncated: ranked.length > offset + matches.length }
  }

  fuzzy(query: string, limit = 20) {
    this.ensure()
    const candidates = new Set<string>()
    for (const symbol of this.allSymbols()) candidates.add(symbol.name)
    for (const file of this.fileList()) candidates.add(path.basename(file))
    return rankCandidates(query, [...candidates], limit)
  }

  findDefinition(name: string, limit = 50): SymbolHit[] {
    this.ensure()
    const simple = name.split(".").pop() as string
    return this.allSymbols()
      .filter((symbol) => symbol.name === name || symbol.name === simple)
      .slice(0, limit)
      .map((symbol) => this.toHit(symbol))
  }

  symbolSearch(query: string, limit = 50): SymbolHit[] {
    this.ensure()
    const needle = query.toLowerCase()
    return this.allSymbols()
      .filter((symbol) => symbol.name.toLowerCase().includes(needle))
      .slice(0, limit)
      .map((symbol) => this.toHit(symbol))
  }

  findReferences(name: string, limit = 100): ReferenceHit[] {
    this.ensure()
    const simple = name.split(".").pop() as string
    const out: ReferenceHit[] = []
    const regex = new RegExp(`\\b${escapeRegExp(simple)}\\b`)
    for (const index of this.indexes.values()) {
      for (let i = 0; i < index.lines.length; i++) {
        if (!regex.test(index.lines[i])) continue
        const isDefinition = index.symbols.some((symbol) => symbol.line === i + 1 && symbol.name === simple)
        out.push({
          file: index.file,
          line: i + 1,
          symbol: simple,
          referenceType: isDefinition ? "definition" : "reference",
          text: index.lines[i].trim().slice(0, 300),
        })
        if (out.length >= limit) return out
      }
    }
    return out
  }

  findCallers(name: string, limit = 100): Array<{ caller: string; file: string; line: number; text: string }> {
    this.ensure()
    const simple = name.split(".").pop() as string
    const out: Array<{ caller: string; file: string; line: number; text: string }> = []
    for (const index of this.indexes.values()) {
      for (const call of index.calls) {
        if (call.callee !== simple) continue
        const caller = call.callerId ? index.symbols.find((symbol) => symbol.id === call.callerId) : undefined
        out.push({
          caller: caller?.name ?? "<module>",
          file: index.file,
          line: call.line,
          text: index.lines[call.line - 1]?.trim().slice(0, 300) ?? "",
        })
        if (out.length >= limit) return out
      }
    }
    return out
  }

  findCallees(name: string, limit = 100): Array<{ callee: string; file: string; line: number }> {
    this.ensure()
    const simple = name.split(".").pop() as string
    const out: Array<{ callee: string; file: string; line: number }> = []
    for (const index of this.indexes.values()) {
      for (const symbol of index.symbols) {
        if (symbol.name !== simple) continue
        for (const call of index.calls) {
          if (call.line < symbol.line || call.line > symbol.endLine) continue
          out.push({ callee: call.callee, file: index.file, line: call.line })
          if (out.length >= limit) return out
        }
      }
    }
    return out
  }

  functionsWithParameter(param: string, limit = 50): SymbolHit[] {
    this.ensure()
    const needle = param.toLowerCase()
    return this.allSymbols()
      .filter((symbol) => (symbol.kind === "function" || symbol.kind === "method") && symbol.params.some((item) => item.toLowerCase() === needle))
      .slice(0, limit)
      .map((symbol) => this.toHit(symbol))
  }

  findImplementations(name: string, limit = 50): SymbolHit[] {
    this.ensure()
    const simple = name.split(".").pop() as string
    return this.allSymbols()
      .filter((symbol) => symbol.kind === "class" && symbol.signature.includes(simple))
      .slice(0, limit)
      .map((symbol) => this.toHit(symbol))
  }

  importGraph(limit = 200): { nodes: GraphNode[]; edges: GraphEdge[] } {
    this.ensure()
    const nodes = new Map<string, GraphNode>()
    const edges: GraphEdge[] = []
    for (const file of this.fileList()) {
      nodes.set(file, { id: file, kind: "File", label: path.basename(file), file })
    }
    for (const imp of this.allImports()) {
      const resolved = this.resolveImport(imp)
      if (!resolved || !nodes.has(resolved)) continue
      edges.push({
        id: `${imp.file}=>${resolved}`,
        from: imp.file,
        to: resolved,
        relation: "imports",
        confidence: 0.9,
      })
      if (edges.length >= limit) break
    }
    return { nodes: [...nodes.values()], edges }
  }

  callGraph(name: string, maxDepth = 2, maxNodes = 100): { nodes: GraphNode[]; edges: GraphEdge[] } {
    this.ensure()
    const nodes = new Map<string, GraphNode>()
    const edges: GraphEdge[] = []
    const root = name.split(".").pop() as string
    nodes.set(root, { id: root, kind: "Function", label: root })
    let frontier = [root]
    for (let depth = 0; depth < maxDepth && edges.length < maxNodes * 2; depth++) {
      const next: string[] = []
      for (const current of frontier) {
        for (const callee of this.findCallees(current, maxNodes)) {
          const id = callee.callee
          if (!nodes.has(id)) {
            nodes.set(id, { id, kind: "Function", label: id, file: callee.file, line: callee.line })
            next.push(id)
          }
          const edgeId = `${current}->${id}`
          if (!edges.some((edge) => edge.id === edgeId)) {
            edges.push({ id: edgeId, from: current, to: id, relation: "calls", confidence: 0.7 })
          }
          if (nodes.size >= maxNodes) break
        }
        if (nodes.size >= maxNodes) break
      }
      frontier = next
      if (nodes.size >= maxNodes) break
    }
    return { nodes: [...nodes.values()], edges }
  }

  dependencyGraph(limit = 300): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const imports = this.importGraph(limit)
    const calls = this.callGraph("", 1, 0)
    void calls
    return imports
  }

  reverseDependency(target: string, limit = 100): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const graph = this.importGraph(limit * 2)
    const normalized = normalizePath(target)
    const edges = graph.edges.filter((edge) => edge.to === normalized || edge.to.startsWith(normalized))
    const nodeIds = new Set<string>([normalized])
    for (const edge of edges) nodeIds.add(edge.from)
    return { nodes: graph.nodes.filter((node) => nodeIds.has(node.id)), edges }
  }

  cycles(limit = 20): string[][] {
    const graph = this.importGraph(limit * 20)
    return findCycles(graph.nodes.map((node) => node.id), graph.edges, limit).map((cycle) => cycle.nodes)
  }

  private resolveImport(imp: ImportDef): string | null {
    if (!imp.source.startsWith(".")) return null
    const base = path.posix.dirname(imp.file)
    const resolved = path.posix.normalize(path.posix.join(base, imp.source))
    const candidates = [
      resolved,
      `${resolved}.ts`,
      `${resolved}.tsx`,
      `${resolved}.js`,
      `${resolved}.jsx`,
      `${resolved}.py`,
      `${resolved}/index.ts`,
      `${resolved}/index.tsx`,
      `${resolved}/index.js`,
      `${resolved}/__init__.py`,
    ]
    for (const candidate of candidates) {
      if (this.indexes.has(candidate)) return candidate
    }
    return null
  }

  private toHit(symbol: SymbolDef): SymbolHit {
    return {
      file: symbol.file,
      line: symbol.line,
      endLine: symbol.endLine,
      symbol: symbol.name,
      symbolType: symbol.kind,
      container: symbol.container,
      signature: symbol.signature,
      params: symbol.params,
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function rankMatches(matches: SearchMatch[]): SearchMatch[] {
  return [...matches].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "definition" ? -1 : 1
    const rank = FILE_KIND_RANK[b.fileKind] - FILE_KIND_RANK[a.fileKind]
    if (rank !== 0) return rank
    const depth = a.file.split("/").length - b.file.split("/").length
    if (depth !== 0) return depth
    if (a.file !== b.file) return a.file < b.file ? -1 : 1
    return a.line - b.line
  })
}
