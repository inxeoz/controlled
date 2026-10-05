/**
 * Shared domain types for Controlled Mode.
 *
 * Vocabulary follows the specification (CM-OPENCODE-SPEC-001) and role.md.
 * The strict boundary is:
 *   LLM -> PROPOSE, JEV -> DECIDE, XSTATE -> ENFORCE, TOOL -> EXECUTE,
 *   EVIDENCE -> VERIFY, LLM -> SYNTHESIZE.
 */

export type InvestigationStatus =
  | "INITIALIZING"
  | "CLASSIFYING"
  | "INVESTIGATING"
  | "VERIFYING"
  | "ANSWERING"
  | "PAUSED"
  | "STOPPED"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED"

export type InvestigationIntent =
  | "FIND_API"
  | "FIND_FUNCTION"
  | "FIND_DEFINITION"
  | "FIND_REFERENCE"
  | "FIND_RELATED_API"
  | "TRACE_FLOW"
  | "UNDERSTAND_FUNCTION"
  | "IMPACT_ANALYSIS"
  | "SAFE_REMOVAL"
  | "DEPENDENCY_ANALYSIS"
  | "CYCLE_DETECTION"
  | "SCHEMA_ANALYSIS"
  | "ROUTE_ANALYSIS"
  | "GENERAL_EXPLORATION"

export type CapabilityId = string

export type CapabilityCategory =
  | "DISCOVERY"
  | "AST"
  | "SYMBOL"
  | "API"
  | "GRAPH"
  | "VERIFY"

/** Metadata for one investigation capability (spec section 78). */
export interface Capability {
  id: CapabilityId
  category: CapabilityCategory
  description: string
  cost: number
  depthCost: number
  expectedInformationGain: number
  requires: string[]
  produces: string[]
  canRepeat: boolean
  canCreateGraphEdges: boolean
}

export type EvidenceType =
  | "DEFINITION"
  | "REFERENCE"
  | "CALL"
  | "IMPORT"
  | "ROUTE"
  | "SCHEMA"
  | "PARAMETER"
  | "DECORATOR"
  | "TEST"
  | "SEARCH_MATCH"
  | "GRAPH_EDGE"
  | "CYCLE"
  | "CONTRADICTION"
  | "NOTE"

/** One unit of codebase evidence (spec section 42). */
export interface Evidence {
  id: string
  type: EvidenceType
  file: string
  lineStart: number | null
  lineEnd: number | null
  symbol: string | null
  relation: string | null
  /** Confidence is stored separately from truth (spec section 43). */
  confidence: number
  discoveredBy: CapabilityId
  snippet?: string
  data?: Record<string, unknown>
}

export interface InvestigationTarget {
  query?: string
  symbol?: string
  file?: string
  route?: string
  field?: string
  from?: string
  to?: string
}

export interface InvestigationConstraints {
  maxResults?: number
  maxDepth?: number
  maxNodes?: number
  maxFiles?: number
  fuzzy?: boolean
  exact?: boolean
}

/** LLM output: a proposal only. The LLM never executes it. */
export interface ActionProposal {
  id: string
  capability: CapabilityId
  target: InvestigationTarget | null
  parameters: Record<string, unknown>
  reason: string
  expectedResult: string
}

/** JEV output: what the investigation should do (role.md section 5). */
export type JEVDisposition = "EXPLORE" | "VERIFY" | "ANSWER" | "STOP" | "ASK_USER"

/** How the proposal itself was treated (spec sections 13-17). */
export type JEVVerdict = "ALLOW" | "MODIFY" | "REJECT" | "STOP" | "ASK_USER"

export interface JEVDecision {
  id: string
  decision: JEVDisposition
  verdict: JEVVerdict
  capability?: CapabilityId
  target?: InvestigationTarget | null
  constraints?: InvestigationConstraints
  reason: string
  expectedInformationGain?: number
  cost?: number
  confidence?: number
  score?: number
  /** Evidence count when the decision was made; used for loop protection. */
  evidenceCount?: number
  at: string
}

export interface GraphNode {
  id: string
  kind:
    | "File"
    | "Module"
    | "Function"
    | "Class"
    | "Variable"
    | "Field"
    | "Type"
    | "Schema"
    | "API"
    | "Route"
    | "DatabaseEntity"
    | "Test"
  label: string
  file?: string
  line?: number | null
}

export type GraphEdgeRelation =
  | "defines"
  | "calls"
  | "called_by"
  | "imports"
  | "imported_by"
  | "references"
  | "returns"
  | "accepts"
  | "reads"
  | "writes"
  | "exposes"
  | "validates"
  | "tests"
  | "depends_on"

export interface GraphEdge {
  id: string
  from: string
  to: string
  relation: GraphEdgeRelation
  evidenceId?: string
  confidence: number
}

export interface InvestigationGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** Mutable counters enforced by XState against the hard limits (spec section 45). */
export interface InvestigationBudget {
  maxActions: number
  maxFiles: number
  maxGraphDepth: number
  maxFuzzySearches: number
  maxSemanticSearches: number
  maxGraphNodes: number
  maxLLMIterations: number
  actions: number
  files: number
  fuzzySearches: number
  semanticSearches: number
  llmIterations: number
}

export type TerminationReason =
  | "EVIDENCE_SUFFICIENT"
  | "NO_USEFUL_ACTION"
  | "BUDGET_EXCEEDED"
  | "DEPTH_EXCEEDED"
  | "REPEATED_ACTION"
  | "USER_STOP"
  | "USER_REQUESTED_ANSWER"
  | "REQUIRES_USER_INPUT"
  | "FATAL_ERROR"

export interface ExecutionRequest {
  capability: CapabilityId
  target: InvestigationTarget | null
  parameters: Record<string, unknown>
  constraints: InvestigationConstraints
  sessionId: string
  directory: string
  signal?: AbortSignal
}

export interface ExecutionResult {
  capability: CapabilityId
  ok: boolean
  message: string
  evidence: Evidence[]
  graphNodes: GraphNode[]
  graphEdges: GraphEdge[]
  filesTouched: string[]
  error?: string
  meta?: Record<string, unknown>
}

/** The runtime context that JEV and XState read (spec section 81). */
export interface InvestigationContext {
  sessionId: string
  question: string
  intents: InvestigationIntent[]
  entities: string[]
  hypothesis: string | null
  evidence: Evidence[]
  visitedNodes: string[]
  visitedEdges: string[]
  /** Maximum graph traversal depth reached so far. */
  depth: number
  budget: InvestigationBudget
  decisions: JEVDecision[]
  status: InvestigationStatus
  graph: InvestigationGraph
}

export interface InvestigationAnswer {
  answer: string
  evidence: Evidence[]
  files: string[]
  symbols: string[]
  relationships: GraphEdge[]
  confidence: number
  scope: string[]
  unverified: string[]
  recommendation?: string
}

export interface InvestigationSession {
  id: string
  question: string
  status: InvestigationStatus
  intent: InvestigationIntent[]
  entities: string[]
  hypothesis: string | null
  evidence: Evidence[]
  actions: ActionProposal[]
  decisions: JEVDecision[]
  graph: InvestigationGraph
  budget: InvestigationBudget
  depth: number
  currentState: string
  answer: InvestigationAnswer | null
  termination: TerminationReason | null
  createdAt: string
  updatedAt: string
}
