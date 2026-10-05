import { newDecisionId } from "./ids"
import { budgetRemaining } from "./budget"
import type { CapabilityRegistry } from "./registry"
import type {
  ActionProposal,
  CapabilityId,
  EvidenceType,
  InvestigationConstraints,
  InvestigationContext,
  InvestigationIntent,
  InvestigationTarget,
  JEVDecision,
} from "./types"

/** One evidence group an intent needs before the investigation may answer. */
export interface Requirement {
  id: string
  /** Evidence types that satisfy the requirement. */
  kinds: EvidenceType[]
  /** Capability that produces the requirement. */
  capability: CapabilityId
  description: string
}

export interface CoverageGap extends Requirement {
  /** Capability that should close the gap. */
  suggestedCapability: CapabilityId
}

/**
 * Intent -> required evidence. A question is answerable only when its required
 * evidence groups are present (or their capability was attempted). Raw search
 * matches alone never satisfy a structural requirement.
 */
const REQUIREMENTS: Partial<Record<InvestigationIntent, Requirement[]>> = {
  FIND_API: [
    { id: "route", kinds: ["ROUTE"], capability: "ROUTE_SEARCH", description: "an API route" },
    { id: "handler", kinds: ["DEFINITION"], capability: "FIND_DEFINITION", description: "the handler definition" },
  ],
  ROUTE_ANALYSIS: [
    { id: "route", kinds: ["ROUTE"], capability: "ROUTE_SEARCH", description: "an API route" },
    { id: "handler", kinds: ["DEFINITION"], capability: "FIND_DEFINITION", description: "the handler definition" },
  ],
  FIND_RELATED_API: [
    { id: "route", kinds: ["ROUTE"], capability: "ROUTE_SEARCH", description: "an API route" },
    { id: "call", kinds: ["CALL", "GRAPH_EDGE"], capability: "FIND_CALLEES", description: "a call relationship" },
  ],
  FIND_FUNCTION: [{ id: "definition", kinds: ["DEFINITION"], capability: "FIND_DEFINITION", description: "the function definition" }],
  FIND_DEFINITION: [{ id: "definition", kinds: ["DEFINITION"], capability: "FIND_DEFINITION", description: "the symbol definition" }],
  UNDERSTAND_FUNCTION: [
    { id: "definition", kinds: ["DEFINITION"], capability: "FIND_DEFINITION", description: "the function definition" },
    { id: "callee", kinds: ["CALL", "GRAPH_EDGE"], capability: "FIND_CALLEES", description: "its callees" },
  ],
  FIND_REFERENCE: [{ id: "reference", kinds: ["REFERENCE", "CALL", "IMPORT"], capability: "FIND_REFERENCES", description: "references to the symbol" }],
  IMPACT_ANALYSIS: [
    { id: "reference", kinds: ["REFERENCE"], capability: "FIND_REFERENCES", description: "references" },
    { id: "caller", kinds: ["CALL"], capability: "FIND_CALLERS", description: "callers" },
  ],
  SAFE_REMOVAL: [
    { id: "schema", kinds: ["SCHEMA", "PARAMETER"], capability: "AST_SCHEMA", description: "the schema or parameter" },
    { id: "reference", kinds: ["REFERENCE", "CALL", "IMPORT"], capability: "FIND_REFERENCES", description: "references" },
    { id: "caller", kinds: ["CALL"], capability: "FIND_CALLERS", description: "callers" },
    { id: "route", kinds: ["ROUTE"], capability: "ROUTE_SEARCH", description: "API routes that use it" },
  ],
  DEPENDENCY_ANALYSIS: [{ id: "graph", kinds: ["IMPORT", "GRAPH_EDGE"], capability: "IMPORT_GRAPH", description: "dependency edges" }],
  CYCLE_DETECTION: [{ id: "cycle", kinds: ["CYCLE"], capability: "CYCLE_DETECTION", description: "a completed cycle detection" }],
  SCHEMA_ANALYSIS: [{ id: "schema", kinds: ["SCHEMA"], capability: "AST_SCHEMA", description: "a schema definition" }],
  TRACE_FLOW: [
    { id: "call", kinds: ["CALL", "GRAPH_EDGE"], capability: "CALL_GRAPH", description: "call relationships" },
    { id: "definition", kinds: ["DEFINITION"], capability: "FIND_DEFINITION", description: "the flow endpoints" },
  ],
  GENERAL_EXPLORATION: [],
}

/** Requirements still missing for the current intents. */
export function coverageGaps(context: InvestigationContext): CoverageGap[] {
  const attempted = new Set(context.decisions.filter((item) => item.verdict !== "REJECT").map((item) => item.capability))
  const present = new Set(context.evidence.map((item) => item.type))
  const gaps: CoverageGap[] = []
  const seen = new Set<string>()
  for (const intent of context.intents) {
    for (const requirement of REQUIREMENTS[intent] ?? []) {
      if (seen.has(requirement.id)) continue
      seen.add(requirement.id)
      const satisfied = requirement.kinds.some((kind) => present.has(kind)) || attempted.has(requirement.capability)
      if (!satisfied) gaps.push({ ...requirement, suggestedCapability: requirement.capability })
    }
  }
  return gaps
}

/** True when the intents have no structural requirements, or all are covered. */
export function coverageComplete(context: InvestigationContext): boolean {
  return coverageGaps(context).length === 0
}

/** Pick the most code-like entity for a gap-filling target. */
export function bestEntity(context: InvestigationContext): string | null {
  const candidates = context.entities.filter(Boolean)
  if (!candidates.length) return null
  const scored = candidates.map((entity) => {
    const identifier = /[_A-Z]/.test(entity) && /^[A-Za-z_][\w]*$/.test(entity)
    const hits = context.evidence.filter((item) => (item.snippet ?? "").includes(entity) || item.file.includes(entity)).length
    return { entity, score: (identifier ? 2 : 0) + hits + entity.length / 100 }
  })
  return scored.sort((a, b) => b.score - a.score)[0].entity
}

export function gapTarget(gap: CoverageGap, context: InvestigationContext): InvestigationTarget {
  const entity = bestEntity(context)
  if (!entity) return {}
  if (gap.suggestedCapability === "FIND_DEFINITION" || gap.suggestedCapability === "READ_SYMBOL" || gap.suggestedCapability === "FIND_CALLERS" || gap.suggestedCapability === "FIND_CALLEES" || gap.suggestedCapability === "SYMBOL_SEARCH") {
    const symbol = context.evidence.map((item) => item.symbol).find((value): value is string => Boolean(value))
    return { symbol: symbol ?? entity }
  }
  return { query: entity }
}

export interface JevInput {
  proposal: ActionProposal
  context: InvestigationContext
  machineState: string
  registry: CapabilityRegistry
  restrictions?: {
    userStopped?: boolean
    deniedCapabilities?: CapabilityId[]
    maxDepth?: number
  }
}

export interface JevPolicy {
  /** Minimum score for an action to be considered useful. */
  minUsefulScore: number
  /** Evidence confidence at which the investigation may answer. */
  answerConfidence: number
  /** Evidence count at which the investigation may answer. */
  answerEvidenceCount: number
  /** Minimum executed actions before the investigation may answer. */
  minActionsBeforeAnswer: number
  /** Prefer a cheaper capability when its expected gain is close enough. */
  escalationSlack: number
}

export const DEFAULT_POLICY: JevPolicy = {
  minUsefulScore: 0.15,
  answerConfidence: 0.75,
  answerEvidenceCount: 6,
  minActionsBeforeAnswer: 3,
  escalationSlack: 0.15,
}

const GRAPH_CAPABILITIES = new Set<CapabilityId>(["CALL_GRAPH", "IMPORT_GRAPH", "DEPENDENCY_GRAPH", "REVERSE_DEPENDENCY", "DATA_FLOW", "API_IMPLEMENTATION"])

const INTENT_PREFERENCES: Record<InvestigationIntent, CapabilityId[]> = {
  FIND_API: ["ROUTE_SEARCH", "ENDPOINT_DEFINITION", "API_IMPLEMENTATION", "EXACT_SEARCH", "FUZZY_SEARCH"],
  FIND_FUNCTION: ["SYMBOL_SEARCH", "FIND_DEFINITION", "AST_FUNCTION", "EXACT_SEARCH", "FUZZY_SEARCH"],
  FIND_DEFINITION: ["FIND_DEFINITION", "SYMBOL_SEARCH", "AST_SEARCH", "EXACT_SEARCH"],
  FIND_REFERENCE: ["FIND_REFERENCES", "EXACT_SEARCH", "TEXT_SEARCH"],
  FIND_RELATED_API: ["API_IMPLEMENTATION", "ROUTE_SEARCH", "CALL_GRAPH"],
  TRACE_FLOW: ["CALL_GRAPH", "FIND_CALLEES", "DATA_FLOW", "FIND_CALLERS"],
  UNDERSTAND_FUNCTION: ["FIND_DEFINITION", "AST_FUNCTION", "FIND_CALLEES", "FIND_CALLERS"],
  IMPACT_ANALYSIS: ["FIND_REFERENCES", "FIND_CALLERS", "REVERSE_DEPENDENCY", "DEPENDENCY_GRAPH"],
  SAFE_REMOVAL: ["AST_SCHEMA", "FIND_REFERENCES", "FIND_CALLERS", "REQUEST_SCHEMA", "RESPONSE_SCHEMA", "VALIDATION", "FIND_DEFINITION", "DEPENDENCY_GRAPH"],
  DEPENDENCY_ANALYSIS: ["IMPORT_GRAPH", "DEPENDENCY_GRAPH", "REVERSE_DEPENDENCY", "FIND_CALLERS"],
  CYCLE_DETECTION: ["CYCLE_DETECTION", "IMPORT_GRAPH", "DEPENDENCY_GRAPH"],
  SCHEMA_ANALYSIS: ["AST_SCHEMA", "REQUEST_SCHEMA", "RESPONSE_SCHEMA", "FIND_REFERENCES"],
  ROUTE_ANALYSIS: ["ROUTE_SEARCH", "ENDPOINT_DEFINITION", "API_IMPLEMENTATION", "AUTHORIZATION", "VALIDATION"],
  GENERAL_EXPLORATION: ["EXACT_SEARCH", "SYMBOL_SEARCH", "AST_SEARCH", "FIND_DEFINITION", "ROUTE_SEARCH"],
}

function decision(input: JevInput, partial: Partial<JEVDecision> & Pick<JEVDecision, "decision" | "verdict" | "reason">): JEVDecision {
  return { id: newDecisionId(), at: new Date().toISOString(), ...partial }
}

function signature(proposal: ActionProposal): string {
  return [proposal.capability, JSON.stringify(proposal.target ?? {}), JSON.stringify(proposal.parameters ?? {})].join("|")
}

export function evidenceSufficient(context: InvestigationContext, policy: JevPolicy): boolean {
  const structural = context.intents.some((intent) => (REQUIREMENTS[intent] ?? []).length > 0)
  if (structural) {
    // A structural question is answerable as soon as its required evidence is
    // covered; match volume and an action floor are irrelevant.
    return coverageComplete(context) && context.evidence.length >= 2
  }
  if (context.budget.actions < policy.minActionsBeforeAnswer) return false
  if (context.evidence.length < policy.answerEvidenceCount) return false
  const strong = context.evidence.filter((item) => item.confidence >= 0.7).length
  return strong >= Math.ceil(policy.answerEvidenceCount / 2)
}

export function averageConfidence(context: InvestigationContext): number {
  if (!context.evidence.length) return 0
  return context.evidence.reduce((sum, item) => sum + item.confidence, 0) / context.evidence.length
}

/**
 * JEV decides what the investigation should do and under which constraints.
 * It never executes a capability and never returns an XState transition
 * (role.md sections 2 and 5).
 */
/**
 * Constraints the decision model may never override: user stop, exhausted
 * budget and a repeated action sequence with no new evidence (spec sections
 * 45, 49, 83). They are checked before any model call.
 */
export function globalConstraints(input: JevInput): JEVDecision | null {
  const { proposal, context } = input
  const restrictions = input.restrictions ?? {}

  if (restrictions.userStopped) {
    return decision(input, { decision: "STOP", verdict: "STOP", reason: "The user stopped the investigation." })
  }

  const remaining = budgetRemaining(context.budget)
  if (remaining <= 0 || context.budget.llmIterations >= context.budget.maxLLMIterations) {
    return decision(input, {
      decision: "STOP",
      verdict: "STOP",
      reason: "The investigation budget is exhausted.",
      confidence: averageConfidence(context),
    })
  }

  const loop = detectLoop(proposal, context)
  if (loop) {
    return decision(input, {
      decision: "STOP",
      verdict: "STOP",
      reason: `Repeated action sequence detected for ${loop} with no new evidence.`,
    })
  }

  return null
}

export function decide(input: JevInput, policy: JevPolicy = DEFAULT_POLICY): JEVDecision {
  const { proposal, context, registry } = input
  const restrictions = input.restrictions ?? {}

  const global = globalConstraints(input)
  if (global) return global

  if (restrictions.deniedCapabilities?.includes(proposal.capability)) {
    return decision(input, {
      decision: "EXPLORE",
      verdict: "REJECT",
      reason: `Capability ${proposal.capability} is not permitted for this session.`,
    })
  }

  const remaining = budgetRemaining(context.budget)

  const capability = registry.get(proposal.capability)
  if (!capability) {
    return decision(input, {
      decision: "EXPLORE",
      verdict: "REJECT",
      reason: `Capability ${proposal.capability} is not in the capability registry.`,
    })
  }

  // Duplicate prevention (spec section 82).
  const alreadyRun = context.decisions.some((item) => item.verdict !== "REJECT" && item.capability === proposal.capability && item.target && proposal.target && JSON.stringify(item.target) === JSON.stringify(proposal.target))
  const ranBefore = context.budget.actions > 0 && alreadyRun
  const newEvidenceSince = context.evidence.some((item) => item.discoveredBy === proposal.capability)
  if (ranBefore && newEvidenceSince && !capability.canRepeat) {
    return decision(input, {
      decision: "EXPLORE",
      verdict: "REJECT",
      reason: `Capability ${proposal.capability} already ran for this target and cannot repeat.`,
      capability: proposal.capability,
    })
  }

  // Depth control belongs to JEV (role.md section 10). It applies to graph
  // traversals, not to flat discovery actions.
  const maxDepth = restrictions.maxDepth ?? context.budget.maxGraphDepth
  const graphCapability = GRAPH_CAPABILITIES.has(proposal.capability)
  const requestedDepth = graphCapability
    ? Number(proposal.parameters.depth ?? proposal.parameters.maxDepth ?? context.depth + 1)
    : 0
  if (graphCapability && requestedDepth > maxDepth) {
    if (context.depth >= maxDepth) {
      return decision(input, {
        decision: "STOP",
        verdict: "STOP",
        reason: `Maximum investigation depth (${maxDepth}) reached.`,
      })
    }
    return decision(input, {
      decision: "EXPLORE",
      verdict: "MODIFY",
      capability: proposal.capability,
      target: proposal.target,
      constraints: { ...constraintOf(proposal), maxDepth },
      reason: `Depth ${requestedDepth} exceeds the configured maximum; the action is limited to depth ${maxDepth}.`,
    })
  }

  // Escalation: prefer the cheapest capability that can still provide evidence.
  const escalation = planEscalation(proposal.capability, context, registry, policy)
  if (escalation) {
    if (escalation.kind === "downgrade") {
      return decision(input, {
        decision: "EXPLORE",
        verdict: "MODIFY",
        capability: escalation.capability,
        target: proposal.target,
        constraints: constraintOf(proposal),
        reason: escalation.reason,
        cost: registry.get(escalation.capability)?.cost,
        expectedInformationGain: registry.get(escalation.capability)?.expectedInformationGain,
      })
    }
    if (escalation.kind === "upgrade") {
      return decision(input, {
        decision: "EXPLORE",
        verdict: "MODIFY",
        capability: escalation.capability,
        target: proposal.target,
        constraints: { ...constraintOf(proposal), fuzzy: true },
        reason: escalation.reason,
        cost: registry.get(escalation.capability)?.cost,
        expectedInformationGain: registry.get(escalation.capability)?.expectedInformationGain,
      })
    }
  }

  // Budget cost check: XState enforces hard limits, JEV respects them.
  if (capability.cost > remaining) {
    return decision(input, {
      decision: "STOP",
      verdict: "STOP",
      reason: `Capability ${proposal.capability} costs ${capability.cost} but only ${remaining} action(s) remain.`,
    })
  }

  // Sufficiency: only when the intent's required evidence is covered.
  if (evidenceSufficient(context, policy) && !isVerification(proposal.capability)) {
    return decision(input, {
      decision: "ANSWER",
      verdict: "REJECT",
      reason: "The required evidence for this investigation is covered.",
      confidence: averageConfidence(context),
    })
  }

  // Gap-driven control (role.md section 2): if a structural requirement is
  // still missing and the proposal does not fill it, JEV selects the
  // gap-filling capability instead of allowing another unhelpful action.
  const gaps = coverageGaps(context)
  if (gaps.length > 0 && context.budget.actions >= 1 && !isVerification(proposal.capability) && !proposalFillsGap(proposal, gaps, registry)) {
    const gap = gaps[0]
    return decision(input, {
      decision: "EXPLORE",
      verdict: "MODIFY",
      capability: gap.suggestedCapability,
      target: gapTarget(gap, context),
      constraints: { maxResults: 30, maxDepth: 2 },
      reason: `The investigation still needs ${gap.description}. Using ${gap.suggestedCapability} instead of ${proposal.capability}.`,
      expectedInformationGain: registry.get(gap.suggestedCapability)?.expectedInformationGain,
      cost: registry.get(gap.suggestedCapability)?.cost,
    })
  }

  const relevance = relevanceScore(proposal, context)
  const gain = capability.expectedInformationGain
  const score = Number((gain * 0.6 + relevance * 0.4 - capability.cost * 0.02 - context.depth * 0.02).toFixed(4))
  if (score < policy.minUsefulScore) {
    return decision(input, {
      decision: "STOP",
      verdict: "STOP",
      reason: `The proposed action has low expected value (score ${score}).`,
      score,
    })
  }

  // Ambiguity: if two equally relevant candidates exist, ask the user.
  const ambiguity = detectAmbiguity(context)
  if (ambiguity && !isVerification(proposal.capability)) {
    return decision(input, {
      decision: "ASK_USER",
      verdict: "ASK_USER",
      reason: `The target is ambiguous: ${ambiguity}. Please select the investigation scope.`,
      score,
    })
  }

  const constraints: InvestigationConstraints = {
    ...constraintOf(proposal),
    maxDepth: Math.min(requestedDepth, maxDepth),
  }
  return decision(input, {
    decision: "EXPLORE",
    verdict: "ALLOW",
    capability: proposal.capability,
    target: proposal.target,
    constraints,
    reason: proposal.reason || `Capability ${proposal.capability} is useful and valid.`,
    expectedInformationGain: gain,
    cost: capability.cost,
    score,
  })
}

export function detectLoop(proposal: ActionProposal, context: InvestigationContext): string | null {
  const history: Array<{ capability: CapabilityId | undefined; count: number | undefined }> = [
    ...context.decisions.slice(-4).map((item) => ({ capability: item.capability, count: item.evidenceCount })),
    { capability: proposal.capability, count: context.evidence.length },
  ]
  const seen = new Map<string, number>()
  for (const item of history) {
    if (!item.capability || item.count == null) continue
    const previous = seen.get(item.capability)
    if (previous != null && previous === item.count) return item.capability
    seen.set(item.capability, item.count)
  }
  return null
}

function proposalFillsGap(proposal: ActionProposal, gaps: CoverageGap[], registry: CapabilityRegistry): boolean {
  const capability = registry.get(proposal.capability)
  const produces = capability?.produces ?? []
  return gaps.some((gap) => gap.suggestedCapability === proposal.capability || produces.some((kind) => gap.kinds.includes(kind as EvidenceType)))
}

function constraintOf(proposal: ActionProposal): InvestigationConstraints {
  const raw = proposal.parameters.constraints
  if (raw && typeof raw === "object") return raw as InvestigationConstraints
  return {}
}

export function isVerification(capability: CapabilityId): boolean {
  return capability.endsWith("_CHECK")
}

function relevanceScore(proposal: ActionProposal, context: InvestigationContext): number {
  const preferred = new Set(context.intents.flatMap((intent) => INTENT_PREFERENCES[intent] ?? []))
  let score = 0.4
  if (preferred.has(proposal.capability)) score += 0.4
  if (context.intents.length === 0) score += 0.1
  const target = proposal.target
  if (target) {
    const value = String(target.query ?? target.symbol ?? target.field ?? target.route ?? "").toLowerCase()
    if (value && (context.question.toLowerCase().includes(value) || context.entities.some((entity) => entity.toLowerCase() === value))) score += 0.2
  }
  return Math.min(score, 1)
}

interface EscalationPlan {
  kind: "downgrade" | "upgrade"
  capability: CapabilityId
  reason: string
}

function planEscalation(capability: CapabilityId, context: InvestigationContext, registry: CapabilityRegistry, policy: JevPolicy): EscalationPlan | null {
  const ran = new Set(context.decisions.filter((item) => item.verdict !== "REJECT").map((item) => item.capability))
  const searched = (id: CapabilityId) => context.evidence.some((item) => item.discoveredBy === id)
  const gainedFromSearch = context.evidence.some((item) => item.type === "SEARCH_MATCH" || item.type === "DEFINITION")

  if (capability === "SEMANTIC_SEARCH") {
    if (!ran.has("EXACT_SEARCH")) return { kind: "downgrade", capability: "EXACT_SEARCH", reason: "Prefer exact search before semantic search." }
    if (!ran.has("FUZZY_SEARCH")) return { kind: "downgrade", capability: "FUZZY_SEARCH", reason: "Prefer fuzzy search before semantic search." }
    return null
  }

  if (capability === "FUZZY_SEARCH") {
    const exactRan = ran.has("EXACT_SEARCH")
    const exactFound = searched("EXACT_SEARCH")
    if (!exactRan) return { kind: "downgrade", capability: "EXACT_SEARCH", reason: "Exact search is cheaper; run it first." }
    if (!exactFound && context.budget.fuzzySearches >= context.budget.maxFuzzySearches) {
      return { kind: "downgrade", capability: "TEXT_SEARCH", reason: "The fuzzy search budget is exhausted; use text search." }
    }
    return null
  }

  if (capability === "EXACT_SEARCH" && ran.has("EXACT_SEARCH") && !searched("EXACT_SEARCH") && !gainedFromSearch) {
    if (context.budget.fuzzySearches < context.budget.maxFuzzySearches) {
      return { kind: "upgrade", capability: "FUZZY_SEARCH", reason: "Exact search produced no suitable candidate." }
    }
  }

  // Structural analysis is cheaper than a graph traversal for a single symbol.
  if ((capability === "CALL_GRAPH" || capability === "DEPENDENCY_GRAPH") && !ran.has("FIND_DEFINITION")) {
    const def = registry.get("FIND_DEFINITION")
    if (def && def.cost < (registry.get(capability)?.cost ?? 0)) {
      return { kind: "downgrade", capability: "FIND_DEFINITION", reason: "Resolve the target definition before traversing a graph." }
    }
  }

  return null
}

function detectAmbiguity(context: InvestigationContext): string | null {
  // Ambiguity means the SAME symbol has multiple equally relevant definitions in
  // different files. Different symbols found by one search are not ambiguous.
  const definitions = context.evidence.filter((item) => item.type === "DEFINITION" && item.symbol)
  if (definitions.length < 2) return null
  const byName = new Map<string, typeof definitions>()
  for (const item of definitions) {
    const name = item.symbol as string
    const list = byName.get(name) ?? []
    list.push(item)
    byName.set(name, list)
  }
  for (const [name, items] of byName) {
    const files = new Set(items.map((item) => item.file))
    if (files.size < 2) continue
    const confidences = items.map((item) => item.confidence)
    if (Math.max(...confidences) - Math.min(...confidences) < 0.05) {
      return `the symbol "${name}" is defined in ${[...files].join(", ")}`
    }
  }
  return null
}
