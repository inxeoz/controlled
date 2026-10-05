import type { GraphEdge, GraphNode } from "../core/types"

export interface CyclePath {
  nodes: string[]
}

/** Independent cycle detection (spec section 40). The LLM is not the authority. */
export function findCycles(nodes: string[], edges: GraphEdge[], limit = 20): CyclePath[] {
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) adjacency.set(node, [])
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, [])
    adjacency.get(edge.from)?.push(edge.to)
  }
  const cycles: CyclePath[] = []
  const seen = new Set<string>()
  const index = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()

  const visit = (node: string) => {
    if (cycles.length >= limit) return
    index.set(node, stack.length)
    stack.push(node)
    onStack.add(node)
    for (const next of adjacency.get(node) ?? []) {
      if (cycles.length >= limit) return
      if (!index.has(next)) {
        visit(next)
        continue
      }
      if (onStack.has(next)) {
        const start = index.get(next) as number
        const path = [...stack.slice(start), next]
        const key = [...path].sort().join("->")
        if (!seen.has(key)) {
          seen.add(key)
          cycles.push({ nodes: path })
        }
      }
    }
    stack.pop()
    onStack.delete(node)
  }

  for (const node of adjacency.keys()) {
    if (!index.has(node)) visit(node)
    if (cycles.length >= limit) break
  }
  return cycles
}

export function buildAdjacency(edges: GraphEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? []
    list.push(edge.to)
    adjacency.set(edge.from, list)
  }
  return adjacency
}

export function reachable(start: string, edges: GraphEdge[], maxDepth: number): { nodes: string[]; edges: GraphEdge[] } {
  const adjacency = new Map<string, GraphEdge[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? []
    list.push(edge)
    adjacency.set(edge.from, list)
  }
  const visited = new Set<string>([start])
  const usedEdges: GraphEdge[] = []
  const queue: Array<{ node: string; depth: number }> = [{ node: start, depth: 0 }]
  while (queue.length) {
    const current = queue.shift() as { node: string; depth: number }
    if (current.depth >= maxDepth) continue
    for (const edge of adjacency.get(current.node) ?? []) {
      usedEdges.push(edge)
      if (!visited.has(edge.to)) {
        visited.add(edge.to)
        queue.push({ node: edge.to, depth: current.depth + 1 })
      }
    }
  }
  return { nodes: [...visited], edges: usedEdges }
}

export function mergeGraph(
  target: { nodes: GraphNode[]; edges: GraphEdge[] },
  nodes: GraphNode[],
  edges: GraphEdge[],
): void {
  const nodeIds = new Set(target.nodes.map((node) => node.id))
  for (const node of nodes) if (!nodeIds.has(node.id)) target.nodes.push(node)
  const edgeIds = new Set(target.edges.map((edge) => edge.id))
  for (const edge of edges) if (!edgeIds.has(edge.id)) target.edges.push(edge)
}
