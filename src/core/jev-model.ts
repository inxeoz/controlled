import { hasCapability } from "../capabilities/execute"
import { budgetRemaining } from "./budget"
import { newDecisionId } from "./ids"
import { averageConfidence, coverageGaps, decide, globalConstraints, isVerification, type JevInput, type JevPolicy, DEFAULT_POLICY } from "./jev"
import type { CapabilityRegistry } from "./registry"
import type {
  ActionProposal,
  CapabilityId,
  InvestigationConstraints,
  InvestigationContext,
  InvestigationTarget,
  JEVDecision,
  JEVDisposition,
  JEVVerdict,
} from "./types"

/** A compact, token-cheap view of the investigation for the decision model. */
export interface JevModelRequest {
  question: string
  intents: string[]
  entities: string[]
  hypothesis: string | null
  proposal: {
    capability: CapabilityId
    target: InvestigationTarget | null
    parameters: Record<string, unknown>
    reason: string
    expectedResult: string
  }
  evidence: {
    total: number
    strong: number
    byType: Record<string, number>
    files: string[]
    symbols: string[]
  }
  decisions: Array<{ decision: JEVDisposition; verdict: JEVVerdict; capability?: CapabilityId; reason: string }>
  budget: { actions: number; maxActions: number; llmIterations: number; maxLLMIterations: number; remaining: number }
  depth: number
  maxDepth: number
  /** Required evidence still missing for the current intents. */
  gaps: Array<{ id: string; description: string; capability: string }>
  machineState: string
  capabilities: Array<{ id: string; category: string; cost: number; expectedInformationGain: number; description: string }>
}

export interface JevModelOutput {
  decision: JEVDisposition
  capability?: CapabilityId
  target?: InvestigationTarget | null
  constraints?: InvestigationConstraints
  reason: string
  expectedInformationGain?: number
  cost?: number
  confidence?: number
}

/** A decision model. Returning `null` means "unavailable; fall back". */
export interface JevModel {
  readonly id: string
  decide(request: JevModelRequest): Promise<JevModelOutput | null>
}

export type ModelInvoker = (input: { model: string; system: string; user: string; timeoutMs: number }) => Promise<string>

const GRAPH_CAPABILITIES = new Set<CapabilityId>(["CALL_GRAPH", "IMPORT_GRAPH", "DEPENDENCY_GRAPH", "REVERSE_DEPENDENCY", "DATA_FLOW", "API_IMPLEMENTATION"])
const DISPOSITIONS: JEVDisposition[] = ["EXPLORE", "VERIFY", "ANSWER", "STOP", "ASK_USER"]

/** The default decision model. Changeable through options, env or the visualizer. */
export const DEFAULT_JEV_MODEL = "opencode/jev-1.13"

/** Normalize a model id to `provider/model`. A bare id defaults to the opencode provider. */
export function normalizeModelId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === "heuristic") return null
  return trimmed.includes("/") ? trimmed : `opencode/${trimmed}`
}
export const DEFAULT_JEV_TIMEOUT_MS = 15000

export function buildJevRequest(input: JevInput): JevModelRequest {
  const { proposal, context, registry } = input
  const byType: Record<string, number> = {}
  for (const item of context.evidence) byType[item.type] = (byType[item.type] ?? 0) + 1
  return {
    question: context.question,
    intents: context.intents,
    entities: context.entities,
    hypothesis: context.hypothesis,
    proposal: {
      capability: proposal.capability,
      target: proposal.target,
      parameters: proposal.parameters,
      reason: proposal.reason,
      expectedResult: proposal.expectedResult,
    },
    evidence: {
      total: context.evidence.length,
      strong: context.evidence.filter((item) => item.confidence >= 0.7).length,
      byType,
      files: topValues(context.evidence.map((item) => item.file).filter(Boolean), 12),
      symbols: topValues(context.evidence.map((item) => item.symbol).filter((value): value is string => Boolean(value)), 12),
    },
    decisions: context.decisions.slice(-5).map((item) => ({ decision: item.decision, verdict: item.verdict, capability: item.capability, reason: item.reason })),
    budget: {
      actions: context.budget.actions,
      maxActions: context.budget.maxActions,
      llmIterations: context.budget.llmIterations,
      maxLLMIterations: context.budget.maxLLMIterations,
      remaining: budgetRemaining(context.budget),
    },
    depth: context.depth,
    maxDepth: input.restrictions?.maxDepth ?? context.budget.maxGraphDepth,
    gaps: coverageGaps(context).map((gap) => ({ id: gap.id, description: gap.description, capability: gap.suggestedCapability })),
    machineState: input.machineState,
    capabilities: registry.list().map((capability) => ({
      id: capability.id,
      category: capability.category,
      cost: capability.cost,
      expectedInformationGain: capability.expectedInformationGain,
      description: capability.description,
    })),
  }
}

function topValues(values: string[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value]) => value)
}

/** Parse a decision model response. Accepts fenced JSON and surrounding prose. */
export function parseJevOutput(text: string): JevModelOutput | null {
  const json = extractJson(text)
  if (!json) return null
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  const decision = String(record.decision ?? "").toUpperCase() as JEVDisposition
  if (!DISPOSITIONS.includes(decision)) return null
  const output: JevModelOutput = {
    decision,
    reason: String(record.reason ?? "Decision model returned no reason."),
  }
  if (record.capability) output.capability = String(record.capability)
  if (record.target && typeof record.target === "object") output.target = record.target as InvestigationTarget
  if (record.constraints && typeof record.constraints === "object") output.constraints = record.constraints as InvestigationConstraints
  if (typeof record.expectedInformationGain === "number") output.expectedInformationGain = record.expectedInformationGain
  if (typeof record.cost === "number") output.cost = record.cost
  if (typeof record.confidence === "number") output.confidence = record.confidence
  return output
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const source = fenced ? fenced[1] : text
  const start = source.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < source.length; i++) {
    const char = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth++
    else if (char === "}") {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

/** A decision model backed by an OpenCode model through the plugin client. */
export class OpenCodeJevModel implements JevModel {
  private failures = 0
  private checked = false
  private available = true
  private static readonly MAX_FAILURES = 2

  constructor(
    private readonly options: {
      id: string
      model: string
      system: string
      invoke: ModelInvoker
      timeoutMs?: number
      onError?: (error: Error) => void
      /** Lazy availability check. A false result disables the model. */
      available?: () => Promise<boolean>
    },
  ) {}

  get id(): string {
    return this.options.model
  }

  get unavailable(): boolean {
    return this.failures >= OpenCodeJevModel.MAX_FAILURES
  }

  async decide(request: JevModelRequest): Promise<JevModelOutput | null> {
    if (this.unavailable) return null
    if (!this.checked) {
      this.checked = true
      if (this.options.available) {
        try {
          this.available = await this.options.available()
        } catch {
          this.available = false
        }
        if (!this.available) {
          this.failures = OpenCodeJevModel.MAX_FAILURES
          this.options.onError?.(new Error(`Decision model ${this.options.model} is not available`))
          return null
        }
      }
    }
    try {
      const text = await this.options.invoke({
        model: this.options.model,
        system: this.options.system,
        user: JSON.stringify(request, null, 2),
        timeoutMs: this.options.timeoutMs ?? DEFAULT_JEV_TIMEOUT_MS,
      })
      const parsed = parseJevOutput(text)
      if (!parsed) {
        this.failures += 1
        return null
      }
      this.failures = 0
      return parsed
    } catch (error) {
      this.failures += 1
      this.options.onError?.(error as Error)
      return null
    }
  }
}

export interface JevEngineOptions {
  registry: CapabilityRegistry
  model?: JevModel | null
  policy?: JevPolicy
  onFallback?: (reason: string) => void
}

/**
 * JEV engine: the decision model decides, the deterministic layer enforces.
 * Hard constraints (user stop, budget, loop) are checked before the model call
 * and can never be overridden.
 */
export class JevEngine {
  private model: JevModel | null
  policy: JevPolicy
  readonly registry: CapabilityRegistry
  private readonly onFallback?: (reason: string) => void

  constructor(options: JevEngineOptions) {
    this.registry = options.registry
    this.model = options.model ?? null
    this.policy = options.policy ?? DEFAULT_POLICY
    this.onFallback = options.onFallback
  }

  get decisionModel(): string {
    return this.model?.id ?? "heuristic"
  }

  setModel(model: JevModel | null): void {
    this.model = model
  }

  async decide(input: JevInput, policy: JevPolicy = this.policy): Promise<JEVDecision> {
    const global = globalConstraints(input)
    if (global) return global

    if (!this.model) {
      const heuristic = decide(input, policy)
      heuristic.source = "heuristic"
      return heuristic
    }

    let output: JevModelOutput | null = null
    try {
      output = await this.model.decide(buildJevRequest(input))
    } catch {
      output = null
    }
    if (!output) {
      this.onFallback?.("The decision model was unavailable; the deterministic policy decided instead.")
      const heuristic = decide(input, policy)
      heuristic.source = "heuristic"
      return heuristic
    }

    const override = this.validate(input, output, policy)
    if (override) return override
    return this.fromModel(input, output)
  }

  /** Apply hard constraints to a model decision. Returns an override or null. */
  private validate(input: JevInput, output: JevModelOutput, policy: JevPolicy = this.policy): JEVDecision | null {
    const { context } = input
    const remaining = budgetRemaining(context.budget)
    const overridden = (reason: string, fallback: JEVDecision = decide(input, policy)): JEVDecision => {
      fallback.source = "model-overridden"
      fallback.reason = `${reason} Deterministic policy: ${fallback.reason}`
      return fallback
    }

    if (output.decision === "EXPLORE" || output.decision === "VERIFY") {
      const capability = output.capability
      if (!capability) return overridden("The decision model returned no capability.")
      if (!this.registry.has(capability)) return overridden(`The decision model selected an unknown capability (${capability}).`)
      if (!hasCapability(capability)) return overridden(`The decision model selected an unimplemented capability (${capability}).`)
      if (input.restrictions?.deniedCapabilities?.includes(capability)) return overridden(`The decision model selected a denied capability (${capability}).`)
      const cost = output.cost ?? this.registry.get(capability)?.cost ?? 1
      if (cost > remaining) return overridden(`The decision model selected an action that exceeds the remaining budget.`)
      if (isDuplicate(context, capability, output.target)) return overridden(`The decision model selected an action that was already executed.`)
      if (GRAPH_CAPABILITIES.has(capability)) {
        const maxDepth = input.restrictions?.maxDepth ?? context.budget.maxGraphDepth
        const requested = Number(output.constraints?.maxDepth ?? context.depth + 1)
        output.constraints = { ...(output.constraints ?? {}), maxDepth: Math.min(requested, maxDepth) }
      }
      return null
    }

    if (output.decision === "ANSWER" && (context.evidence.length === 0 || coverageGaps(context).length > 0)) {
      return overridden("The decision model tried to answer before the required evidence was covered.")
    }
    return null
  }

  private fromModel(input: JevInput, output: JevModelOutput): JEVDecision {
    const { context, proposal } = input
    const capability = output.capability ?? proposal.capability
    const changed = capability !== proposal.capability || JSON.stringify(output.constraints ?? {}) !== JSON.stringify(proposal.parameters.constraints ?? {})
    const verdict: JEVVerdict =
      output.decision === "ANSWER"
        ? "REJECT"
        : output.decision === "STOP"
          ? "STOP"
          : output.decision === "ASK_USER"
            ? "ASK_USER"
            : changed
              ? "MODIFY"
              : "ALLOW"
    const capabilityMeta = this.registry.get(capability)
    return {
      id: newDecisionId(),
      decision: output.decision,
      verdict,
      capability: output.decision === "EXPLORE" || output.decision === "VERIFY" ? capability : undefined,
      target: output.target ?? proposal.target,
      constraints: output.constraints,
      reason: output.reason,
      expectedInformationGain: output.expectedInformationGain ?? capabilityMeta?.expectedInformationGain,
      cost: output.cost ?? capabilityMeta?.cost,
      confidence: output.confidence ?? averageConfidence(context),
      evidenceCount: context.evidence.length,
      source: "model",
      at: new Date().toISOString(),
    }
  }
}

function isDuplicate(context: InvestigationContext, capability: CapabilityId, target: InvestigationTarget | null | undefined): boolean {
  const key = targetKey(target)
  if (!key) return false
  return context.decisions.some(
    (item) => item.verdict !== "REJECT" && item.capability === capability && targetKey(item.target ?? null) === key,
  )
}

function targetKey(target: InvestigationTarget | null | undefined): string {
  if (!target) return ""
  return [target.query, target.symbol, target.file, target.route, target.field].find((value) => value && String(value).trim()) ?? ""
}

export { isVerification }
