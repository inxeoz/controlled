import path from "node:path"
import { getIndex } from "../capabilities/index"
import { hasCapability, runCapability, signatureOf } from "../capabilities/execute"
import { mergeGraph } from "../capabilities/graph-utils"
import { createBudget, budgetRemaining } from "./budget"
import { EVENT, EventStore, type ControlledEvent } from "./events"
import { newProposalId, newSessionId } from "./ids"
import { DEFAULT_POLICY, evidenceSufficient, averageConfidence, coverageGaps, type JevPolicy } from "./jev"
import { JevEngine, normalizeModelId, type JevModel } from "./jev-model"
import { ALL_GUARDS_PASS, Controller, baseMachine, type GuardFlags, type MachineState, type RuntimeChange, type RuntimeChangeType } from "./machine"
import { CapabilityRegistry, registry as defaultRegistry } from "./registry"
import type {
  ActionProposal,
  CapabilityId,
  Evidence,
  InvestigationAnswer,
  InvestigationBudget,
  InvestigationConstraints,
  InvestigationContext,
  InvestigationIntent,
  InvestigationSession,
  InvestigationStatus,
  InvestigationTarget,
  JEVDecision,
  JEVDisposition,
  JEVVerdict,
  TerminationReason,
} from "./types"

export interface StartOptions {
  question: string
  intents?: InvestigationIntent[]
  entities?: string[]
  budget?: Partial<InvestigationBudget>
  restrictions?: { deniedCapabilities?: CapabilityId[]; maxDepth?: number }
}

export interface StepResult {
  state: MachineState
  status: InvestigationStatus
  verdict: JEVVerdict
  decision: JEVDisposition
  capability: CapabilityId | null
  executed: boolean
  newEvidence: Evidence[]
  evidenceCount: number
  graphSummary: { nodes: number; edges: number }
  budget: InvestigationBudget
  message: string
  mustAnswer: boolean
  mustAskUser: boolean
  question?: string
  /** Required evidence still missing, with the capability that closes it. */
  gaps: Array<{ id: string; description: string; capability: string }>
  error?: string
}

export interface FinishResult {
  state: MachineState
  status: InvestigationStatus
  answer: InvestigationAnswer
  termination: TerminationReason
}

export type ControlCommand =
  | "PAUSE"
  | "RESUME"
  | "STOP"
  | "STEP"
  | "SET_SPEED"
  | "REPLAY"
  | "APPROVE_ACTION"
  | "REJECT_ACTION"
  | "UPDATE_BUDGET"
  | "UPDATE_POLICY"
  | "ADD_STATE"
  | "REMOVE_STATE"
  | "MODIFY_STATE"
  | "ADD_TRANSITION"
  | "REMOVE_TRANSITION"
  | "MODIFY_TRANSITION"
  | "DISABLE_STATE"
  | "ENABLE_STATE"
  | "ADD_CAPABILITY"
  | "SET_JEV_MODEL"

export interface ControlRequest {
  sessionId: string
  command: ControlCommand
  payload?: Record<string, unknown>
  /** OBSERVE cannot change execution; CONTROL may pause/resume/stop/step/speed; MODIFY may change the machine. */
  mode?: "OBSERVE" | "CONTROL" | "MODIFY"
}

export interface ControlResult {
  ok: boolean
  command: ControlCommand
  message: string
  state?: MachineState
  change?: RuntimeChange
}

interface SessionRuntime {
  session: InvestigationSession
  controller: Controller
  policy: JevPolicy
  restrictions: { deniedCapabilities: CapabilityId[]; maxDepth?: number }
  replaySpeed: number
  executionSpeed: number
  pendingAction: ActionProposal | null
  lastStep: StepResult | null
}

const VERIFY_CAPABILITIES = new Set([
  "EVIDENCE_CHECK",
  "COVERAGE_CHECK",
  "DUPLICATE_CHECK",
  "CONTRADICTION_CHECK",
  "CONFIDENCE_CHECK",
])

export interface RuntimeOptions {
  events?: EventStore
  registry?: CapabilityRegistry
  /** Decision model id, for example "opencode/jev-1.13-free". */
  jevModelId?: string | null
  /** Builds a decision model for an id. Returns null when the id is unusable. */
  createJevModel?: (modelId: string) => JevModel | null
}

export class ControlledRuntime {
  readonly events: EventStore
  readonly registry: CapabilityRegistry
  readonly root: string
  private readonly sessions = new Map<string, SessionRuntime>()
  private readonly jev: JevEngine
  private jevModelId: string | null
  private jevModelNote: string | null = null
  private readonly createJevModel?: (modelId: string) => JevModel | null

  constructor(root: string, options: RuntimeOptions = {}) {
    this.root = path.resolve(root)
    this.events = options.events ?? new EventStore(path.join(this.root, ".opencode", "controlled", "events"))
    this.registry = options.registry ?? defaultRegistry
    this.createJevModel = options.createJevModel
    this.jevModelId = options.jevModelId ?? null
    this.jev = new JevEngine({
      registry: this.registry,
      model: this.jevModelId && this.createJevModel ? this.createJevModel(this.jevModelId) : null,
    })
  }

  /** The active decision model id, or "heuristic" when none is configured. */
  getJevModel(): string {
    return this.jevModelId ?? "heuristic"
  }

  /** Why the configured model is not active, when it is not. */
  getJevModelNote(): string | null {
    return this.jevModelNote
  }

  setJevModelNote(note: string | null): void {
    this.jevModelNote = note
  }

  setJevModel(modelId: string | null): void {
    this.jevModelId = modelId
    this.jev.setModel(modelId && this.createJevModel ? this.createJevModel(modelId) : null)
  }

  /** Change the decision model and record it on a session when one is given. */
  configureJevModel(modelId: string | null, sessionId?: string): void {
    this.setJevModel(modelId)
    if (sessionId) this.events.append(sessionId, EVENT.JEV_MODEL_CHANGED, { model: this.getJevModel() })
  }

  start(options: StartOptions): { session: InvestigationSession; state: MachineState } {
    const id = newSessionId()
    const classification = options.intents?.length ? { intents: options.intents, entities: options.entities ?? [] } : classify(options.question)
    const session: InvestigationSession = {
      id,
      question: options.question,
      status: "CLASSIFYING",
      intent: classification.intents,
      entities: options.entities ?? classification.entities,
      hypothesis: null,
      evidence: [],
      actions: [],
      decisions: [],
      graph: { nodes: [], edges: [] },
      budget: createBudget(options.budget),
      depth: 0,
      currentState: "IDLE",
      answer: null,
      termination: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    const controller = new Controller({
      config: baseMachine(),
      onChange: (change) => {
        session.currentState = controller.state
        session.updatedAt = new Date().toISOString()
        this.events.append(id, change.type, { state: controller.state, from: change.from, to: change.to, ...(change.payload ?? {}) })
      },
    })
    const runtime: SessionRuntime = {
      session,
      controller,
      policy: { ...DEFAULT_POLICY },
      restrictions: { deniedCapabilities: options.restrictions?.deniedCapabilities ?? [], maxDepth: options.restrictions?.maxDepth },
      replaySpeed: 1,
      executionSpeed: 1,
      pendingAction: null,
      lastStep: null,
    }
    this.sessions.set(id, runtime)
    this.events.append(id, EVENT.SESSION_CREATED, { question: options.question, intents: session.intent, entities: session.entities })

    controller.send("START", this.guards(runtime))
    controller.send("UNDERSTOOD", this.guards(runtime))
    session.status = "INVESTIGATING"
    this.events.append(id, EVENT.SESSION_STATUS, { status: session.status })
    return { session, state: controller.state }
  }

  get(sessionId: string): InvestigationSession | undefined {
    return this.sessions.get(sessionId)?.session
  }

  runtimeOf(sessionId: string): SessionRuntime | undefined {
    return this.sessions.get(sessionId)
  }

  list(): InvestigationSession[] {
    return [...this.sessions.values()].map((item) => item.session)
  }

  context(sessionId: string): InvestigationContext | null {
    const runtime = this.sessions.get(sessionId)
    if (!runtime) return null
    const session = runtime.session
    return {
      sessionId,
      question: session.question,
      intents: session.intent,
      entities: session.entities,
      hypothesis: session.hypothesis,
      evidence: session.evidence,
      visitedNodes: session.graph.nodes.map((node) => node.id),
      visitedEdges: session.graph.edges.map((edge) => edge.id),
      depth: session.depth,
      budget: session.budget,
      decisions: session.decisions,
      status: session.status,
      graph: session.graph,
    }
  }

  /** The single controlled investigation step: LLM proposes, JEV decides, XState enforces. */
  async step(sessionId: string, input: {
    capability: CapabilityId
    target?: InvestigationTarget | null
    parameters?: Record<string, unknown>
    reason?: string
    expectedResult?: string
  }): Promise<StepResult> {
    const runtime = this.sessions.get(sessionId)
    if (!runtime) return this.missing(sessionId)
    const session = runtime.session
    const controller = runtime.controller

    if (controller.state === "PAUSED") {
      return this.result(runtime, { verdict: "REJECT", decision: "EXPLORE", capability: null, executed: false, message: "The investigation is paused. Resume it before proposing another action." })
    }
    if (controller.isTerminal()) {
      return this.result(runtime, { verdict: "REJECT", decision: "STOP", capability: null, executed: false, message: `The investigation is already ${controller.state.toLowerCase()}.` })
    }
    if (controller.state === "WAITING_FOR_USER") {
      return this.result(runtime, { verdict: "REJECT", decision: "ASK_USER", capability: null, executed: false, message: "The investigation is waiting for user input.", mustAskUser: true })
    }

    session.budget.llmIterations += 1
    const proposal: ActionProposal = {
      id: newProposalId(),
      capability: input.capability,
      target: input.target ?? null,
      parameters: input.parameters ?? {},
      reason: input.reason ?? "",
      expectedResult: input.expectedResult ?? "",
    }
    runtime.pendingAction = proposal
    this.events.append(sessionId, EVENT.LLM_PROPOSAL, { proposal })
    this.events.append(sessionId, EVENT.BUDGET_UPDATED, { budget: session.budget })

    controller.send("PROPOSE", this.guards(runtime))
    const context = this.context(sessionId) as InvestigationContext
    const decision = await this.jev.decide(
      { proposal, context, machineState: controller.state, registry: this.registry, restrictions: { userStopped: session.status === "STOPPED", deniedCapabilities: runtime.restrictions.deniedCapabilities, maxDepth: runtime.restrictions.maxDepth } },
      runtime.policy,
    )
    decision.evidenceCount = session.evidence.length
    if (decision.source === "heuristic" && this.jev.decisionModel !== "heuristic") {
      this.events.append(sessionId, EVENT.JEV_FALLBACK, { model: this.jevModelId, reason: "The decision model was unavailable; the deterministic policy decided instead." })
    }
    session.decisions.push(decision)
    this.events.append(sessionId, EVENT.JEV_DECISION, {
      decision: decision.decision,
      verdict: decision.verdict,
      capability: decision.capability ?? proposal.capability,
      reason: decision.reason,
      score: decision.score,
      expectedInformationGain: decision.expectedInformationGain,
      cost: decision.cost,
      constraints: decision.constraints,
      depth: context.depth,
      budget: session.budget,
      source: decision.source,
      gaps: coverageGaps(context).map((gap) => ({ id: gap.id, description: gap.description, capability: gap.suggestedCapability })),
    })

    if (decision.decision === "STOP") {
      controller.send("STOP", this.guards(runtime))
      session.status = "ANSWERING"
      session.termination = session.budget.actions >= session.budget.maxActions ? "BUDGET_EXCEEDED" : "NO_USEFUL_ACTION"
      this.terminate(sessionId, session.termination)
      return this.result(runtime, { verdict: "STOP", decision: "STOP", capability: null, executed: false, message: decision.reason, mustAnswer: true })
    }

    if (decision.decision === "ANSWER") {
      controller.send("ANSWER", this.guards(runtime))
      session.status = "ANSWERING"
      session.termination = "EVIDENCE_SUFFICIENT"
      this.events.append(sessionId, EVENT.SESSION_TERMINATED, { reason: session.termination })
      return this.result(runtime, { verdict: "REJECT", decision: "ANSWER", capability: null, executed: false, message: decision.reason, mustAnswer: true })
    }

    if (decision.decision === "ASK_USER") {
      controller.send("ASK_USER", this.guards(runtime))
      session.status = "BLOCKED"
      this.events.append(sessionId, EVENT.SESSION_STATUS, { status: session.status })
      return this.result(runtime, { verdict: "ASK_USER", decision: "ASK_USER", capability: null, executed: false, message: decision.reason, mustAskUser: true, question: decision.reason })
    }

    if (decision.verdict === "REJECT") {
      controller.send("REJECT", this.guards(runtime))
      return this.result(runtime, { verdict: "REJECT", decision: decision.decision, capability: decision.capability ?? null, executed: false, message: decision.reason })
    }

    const capability = decision.capability ?? proposal.capability
    const target = decision.target ?? proposal.target
    const constraints: InvestigationConstraints = decision.constraints ?? {}
    const guards = this.guards(runtime, { capability, target, constraints })
    const transitionEvent = VERIFY_CAPABILITIES.has(capability) ? "VERIFY" : "EXPLORE"
    const transition = controller.send(transitionEvent, guards)
    if (!transition.ok) {
      this.events.append(sessionId, EVENT.STATE_REJECTED, { event: transitionEvent, reason: transition.reason, failedGuards: transition.failedGuards })
      controller.send("REJECT", this.guards(runtime))
      return this.result(runtime, { verdict: "REJECT", decision: decision.decision, capability, executed: false, message: `XState rejected the transition: ${transition.reason}` })
    }

    this.events.append(sessionId, EVENT.ACTION_STARTED, { capability, target, constraints })
    const index = getIndex(this.root)
    let execution
    try {
      execution = await runCapability(capability, { target, parameters: proposal.parameters, constraints }, { index, session })
    } catch (error) {
      execution = { capability, ok: false, message: (error as Error).message, evidence: [], graphNodes: [], graphEdges: [], filesTouched: [], error: (error as Error).message }
    }

    if (!execution.ok) {
      this.events.append(sessionId, EVENT.ACTION_FAILED, { capability, error: execution.error, message: execution.message })
      controller.send("FAILED", this.guards(runtime))
      controller.send("NEXT", this.guards(runtime))
      return this.result(runtime, { verdict: "MODIFY", decision: decision.decision, capability, executed: false, message: execution.message, error: execution.error })
    }

    session.actions.push(proposal)
    session.evidence.push(...execution.evidence)
    mergeGraph(session.graph, execution.graphNodes, execution.graphEdges)
    session.budget.actions += 1
    if (capability === "FUZZY_SEARCH") session.budget.fuzzySearches += 1
    if (capability === "SEMANTIC_SEARCH") session.budget.semanticSearches += 1
    session.budget.files = Math.min(session.budget.maxFiles, session.budget.files + execution.filesTouched.length)
    if (GRAPH_CAPABILITIES.has(capability)) {
      session.depth = Math.max(session.depth, Number(constraints.maxDepth ?? 1))
    }

    this.events.append(sessionId, EVENT.ACTION_COMPLETED, { capability, message: execution.message, evidence: execution.evidence.length, files: execution.filesTouched.length })
    for (const item of execution.evidence) {
      this.events.append(sessionId, EVENT.EVIDENCE_FOUND, { evidence: item })
    }
    if (execution.graphNodes.length || execution.graphEdges.length) {
      this.events.append(sessionId, EVENT.GRAPH_UPDATED, { nodes: execution.graphNodes.length, edges: execution.graphEdges.length, totalNodes: session.graph.nodes.length, totalEdges: session.graph.edges.length })
    }
    for (const item of execution.evidence) {
      if (item.type === "CYCLE") this.events.append(sessionId, EVENT.CYCLE_DETECTED, { path: (item.data as { path?: string[] })?.path ?? [], symbol: item.symbol })
      if (item.type === "CONTRADICTION") {
        session.status = "VERIFYING"
        this.events.append(sessionId, EVENT.CONTRADICTION_DETECTED, { symbol: item.symbol, data: item.data })
      }
    }
    this.events.append(sessionId, EVENT.BUDGET_UPDATED, { budget: session.budget })

    controller.send("EXECUTED", this.guards(runtime))
    controller.send("COLLECTED", this.guards(runtime))
    const enough = evidenceSufficient(this.context(sessionId) as InvestigationContext, runtime.policy)
    controller.send(enough ? "ENOUGH" : "NEXT", this.guards(runtime))
    if (enough) {
      session.status = "ANSWERING"
      session.termination = "EVIDENCE_SUFFICIENT"
      this.events.append(sessionId, EVENT.SESSION_TERMINATED, { reason: session.termination })
    }
    session.updatedAt = new Date().toISOString()

    return this.result(runtime, {
      verdict: decision.verdict,
      decision: decision.decision,
      capability,
      executed: true,
      newEvidence: execution.evidence,
      message: execution.message,
      mustAnswer: enough,
    })
  }

  finish(sessionId: string, input: { answer: string; confidence?: number; unverified?: string[]; recommendation?: string; symbols?: string[] }): FinishResult | { error: string } {
    const runtime = this.sessions.get(sessionId)
    if (!runtime) return { error: `Unknown session ${sessionId}.` }
    const session = runtime.session
    if (runtime.controller.state !== "ANSWERING") {
      const transition = runtime.controller.send("ANSWER", this.guards(runtime))
      if (!transition.ok) return { error: `Cannot finish from state ${runtime.controller.state}.` }
    }
    const files = [...new Set(session.evidence.map((item) => item.file).filter(Boolean))]
    const symbols = input.symbols ?? [...new Set(session.evidence.map((item) => item.symbol).filter((value): value is string => Boolean(value)))]
    const answer: InvestigationAnswer = {
      answer: input.answer,
      evidence: session.evidence,
      files,
      symbols,
      relationships: session.graph.edges,
      confidence: input.confidence ?? averageConfidence(this.context(sessionId) as InvestigationContext),
      scope: [...new Set(session.actions.map((action) => action.capability))],
      unverified: input.unverified ?? unverifiedAreas(session),
      recommendation: input.recommendation,
    }
    session.answer = answer
    session.status = "COMPLETED"
    session.termination = session.termination ?? "USER_REQUESTED_ANSWER"
    this.events.append(sessionId, EVENT.ANSWER_READY, { answer })
    runtime.controller.send("ANSWERED", this.guards(runtime))
    this.events.append(sessionId, EVENT.SESSION_TERMINATED, { reason: session.termination })
    session.updatedAt = new Date().toISOString()
    return { state: runtime.controller.state, status: session.status, answer, termination: session.termination }
  }

  control(request: ControlRequest): ControlResult {
    const runtime = this.sessions.get(request.sessionId)
    if (!runtime) return { ok: false, command: request.command, message: `Unknown session ${request.sessionId}.` }
    const session = runtime.session
    const controller = runtime.controller
    const mode = request.mode ?? "OBSERVE"
    const payload = request.payload ?? {}

    this.events.append(session.id, EVENT.CONTROL_COMMAND, { command: request.command, mode, payload })

    const requireControl = (): ControlResult | null => {
      if (mode === "OBSERVE") return { ok: false, command: request.command, message: "The visualizer is in OBSERVE mode; execution cannot be changed." }
      return null
    }
    const requireModify = (): ControlResult | null => {
      if (mode !== "MODIFY") return { ok: false, command: request.command, message: "This command requires MODIFY mode." }
      return null
    }

    switch (request.command) {
      case "PAUSE": {
        const denied = requireControl()
        if (denied) return this.reject(session.id, denied)
        const result = controller.send("PAUSE", this.guards(runtime))
        if (result.ok) {
          session.status = "PAUSED"
          this.events.append(session.id, EVENT.SESSION_STATUS, { status: session.status })
        }
        return { ok: result.ok, command: request.command, message: result.ok ? "Investigation paused." : result.reason, state: controller.state }
      }
      case "RESUME": {
        const denied = requireControl()
        if (denied) return this.reject(session.id, denied)
        const result = controller.send("RESUME", this.guards(runtime))
        if (result.ok) {
          session.status = "INVESTIGATING"
          this.events.append(session.id, EVENT.SESSION_STATUS, { status: session.status })
        }
        return { ok: result.ok, command: request.command, message: result.ok ? "Investigation resumed." : result.reason, state: controller.state }
      }
      case "STOP": {
        const denied = requireControl()
        if (denied) return this.reject(session.id, denied)
        const result = controller.send("STOP", this.guards(runtime))
        if (result.ok) {
          session.status = "STOPPED"
          session.termination = "USER_STOP"
          this.events.append(session.id, EVENT.SESSION_STATUS, { status: session.status })
          this.events.append(session.id, EVENT.SESSION_TERMINATED, { reason: session.termination })
        }
        return { ok: result.ok, command: request.command, message: result.ok ? "Investigation stopped." : result.reason, state: controller.state }
      }
      case "STEP": {
        const denied = requireControl()
        if (denied) return this.reject(session.id, denied)
        return { ok: true, command: request.command, message: "Step recorded. The next proposal executes one transition.", state: controller.state }
      }
      case "SET_SPEED": {
        const denied = requireControl()
        if (denied) return this.reject(session.id, denied)
        const value = Number(payload.value ?? 1)
        const target = payload.target === "replay" ? "replay" : "execution"
        if (!Number.isFinite(value) || value <= 0 || value > 10) {
          return this.reject(session.id, { ok: false, command: request.command, message: `Unsupported speed ${value}.` })
        }
        if (target === "replay") runtime.replaySpeed = value
        else runtime.executionSpeed = value
        this.events.append(session.id, EVENT.CONTROL_COMMAND, { command: "SET_SPEED", target, value })
        return { ok: true, command: request.command, message: `${target} speed set to ${value}x.`, state: controller.state }
      }
      case "REPLAY":
        return { ok: true, command: request.command, message: `Replaying ${this.events.all(session.id).length} event(s).`, state: controller.state }
      case "APPROVE_ACTION":
      case "REJECT_ACTION": {
        const denied = requireControl()
        if (denied) return this.reject(session.id, denied)
        const pending = runtime.pendingAction
        const jev = session.decisions[session.decisions.length - 1]
        this.events.append(session.id, EVENT.CONTROL_COMMAND, {
          command: request.command,
          jevDecision: jev?.decision,
          userDecision: request.command === "APPROVE_ACTION" ? "APPROVE" : "REJECT",
          finalDecision: request.command === "APPROVE_ACTION" ? "EXECUTE" : "BLOCK",
          proposal: pending,
        })
        return { ok: true, command: request.command, message: `User override recorded (${request.command}).`, state: controller.state }
      }
      case "UPDATE_BUDGET": {
        const denied = requireModify()
        if (denied) return this.reject(session.id, denied)
        const next = { ...session.budget, ...(payload as Partial<InvestigationBudget>) }
        session.budget = next
        this.events.append(session.id, EVENT.BUDGET_UPDATED, { budget: next, source: "user" })
        return { ok: true, command: request.command, message: "Budget updated.", state: controller.state }
      }
      case "UPDATE_POLICY": {
        const denied = requireModify()
        if (denied) return this.reject(session.id, denied)
        runtime.policy = { ...runtime.policy, ...(payload as Partial<JevPolicy>) }
        this.events.append(session.id, EVENT.CONTROL_COMMAND, { command: "UPDATE_POLICY", policy: runtime.policy })
        return { ok: true, command: request.command, message: "JEV policy updated.", state: controller.state }
      }
      case "SET_JEV_MODEL": {
        const denied = requireModify()
        if (denied) return this.reject(session.id, denied)
        const model = normalizeModelId(payload.model === undefined ? undefined : String(payload.model))
        this.configureJevModel(model, session.id)
        return { ok: true, command: request.command, message: `Decision model set to ${this.getJevModel()}.`, state: controller.state }
      }
      case "ADD_CAPABILITY": {
        const denied = requireModify()
        if (denied) return this.reject(session.id, denied)
        const capability = payload.capability as { id?: string } | undefined
        if (!capability?.id) return this.reject(session.id, { ok: false, command: request.command, message: "A capability definition is required." })
        this.registry.register({
          id: capability.id,
          category: (capability as { category?: "DISCOVERY" }).category ?? "DISCOVERY",
          description: String((capability as { description?: string }).description ?? "User-defined capability."),
          cost: Number((capability as { cost?: number }).cost ?? 2),
          depthCost: Number((capability as { depthCost?: number }).depthCost ?? 1),
          expectedInformationGain: Number((capability as { expectedInformationGain?: number }).expectedInformationGain ?? 0.5),
          requires: (capability as { requires?: string[] }).requires ?? [],
          produces: (capability as { produces?: string[] }).produces ?? [],
          canRepeat: (capability as { canRepeat?: boolean }).canRepeat ?? true,
          canCreateGraphEdges: (capability as { canCreateGraphEdges?: boolean }).canCreateGraphEdges ?? false,
        })
        this.events.append(session.id, EVENT.CONTROL_COMMAND, { command: "ADD_CAPABILITY", capability })
        return { ok: true, command: request.command, message: `Capability ${capability.id} registered.`, state: controller.state }
      }
      default: {
        const denied = requireModify()
        if (denied) return this.reject(session.id, denied)
        const change = controller.requestChange(request.command as RuntimeChangeType, payload)
        if (change.error && !change.pending && !change.applied) {
          return this.reject(session.id, { ok: false, command: request.command, message: change.error, state: controller.state, change })
        }
        return { ok: true, command: request.command, message: change.pending ? "Change is pending until a safe transition boundary." : "Change applied.", state: controller.state, change }
      }
    }
  }

  snapshot(sessionId: string): Record<string, unknown> | null {
    const runtime = this.sessions.get(sessionId)
    if (!runtime) return null
    const session = runtime.session
    return {
      session,
      jevModel: this.getJevModel(),
      jevModelNote: this.jevModelNote,
      machine: { version: runtime.controller.version, state: runtime.controller.state, previous: runtime.controller.previous, states: runtime.controller.states(), transitions: runtime.controller.transitions(), available: runtime.controller.availableEvents(), pendingChanges: runtime.controller.pendingChanges },
      policy: runtime.policy,
      registry: this.registry.snapshot(),
      speed: { execution: runtime.executionSpeed, replay: runtime.replaySpeed },
      events: this.events.all(sessionId).length,
    }
  }

  subscribe(sessionId: string, listener: (event: ControlledEvent) => void): () => void {
    return this.events.subscribe(sessionId, listener)
  }

  private guards(runtime: SessionRuntime, action?: { capability?: CapabilityId; target?: InvestigationTarget | null; constraints?: InvestigationConstraints }): GuardFlags {
    const session = runtime.session
    const remaining = budgetRemaining(session.budget)
    const context = {
      sessionId: session.id,
      question: session.question,
      intents: session.intent,
      entities: session.entities,
      hypothesis: session.hypothesis,
      evidence: session.evidence,
      visitedNodes: session.graph.nodes.map((node) => node.id),
      visitedEdges: session.graph.edges.map((node) => node.id),
      depth: session.depth,
      budget: session.budget,
      decisions: session.decisions,
      status: session.status,
      graph: session.graph,
    }
    const capability = action?.capability
    const target = action?.target
    const targetKey = target ? String(target.query ?? target.symbol ?? target.file ?? target.route ?? target.field ?? "") : ""
    const duplicate = Boolean(capability && targetKey) && session.actions.some(
      (proposal) =>
        proposal.capability === capability &&
        String(proposal.target?.query ?? proposal.target?.symbol ?? proposal.target?.file ?? proposal.target?.route ?? proposal.target?.field ?? "") === targetKey,
    )
    const alreadyExplored = Boolean(target) && context.visitedNodes.includes(String(target?.query ?? target?.symbol ?? target?.file ?? ""))
    return {
      ...ALL_GUARDS_PASS,
      HAS_BUDGET: remaining > 0 && session.budget.llmIterations <= session.budget.maxLLMIterations,
      DEPTH_ALLOWED: context.depth <= (runtime.restrictions.maxDepth ?? session.budget.maxGraphDepth),
      ACTION_ALLOWED: !capability || (!runtime.restrictions.deniedCapabilities.includes(capability) && hasCapability(capability)),
      TARGET_VALID: !capability || !REQUIRES_TARGET.has(capability) || Boolean(target && (target.query || target.symbol || target.file || target.route || target.field)),
      NOT_DUPLICATE: !capability || !duplicate,
      NOT_ALREADY_EXPLORED: !alreadyExplored,
      NO_ACTIVE_CONFLICT: true,
      USER_NOT_STOPPED: session.status !== "STOPPED",
      CAPABILITY_AVAILABLE: !capability || (this.registry.has(capability) && hasCapability(capability)),
    }
  }

  private result(runtime: SessionRuntime, partial: {
    verdict: JEVVerdict
    decision: JEVDisposition
    capability: CapabilityId | null
    executed: boolean
    message: string
    newEvidence?: Evidence[]
    mustAnswer?: boolean
    mustAskUser?: boolean
    question?: string
    error?: string
  }): StepResult {
    const session = runtime.session
    session.updatedAt = new Date().toISOString()
    const result: StepResult = {
      state: runtime.controller.state,
      status: session.status,
      verdict: partial.verdict,
      decision: partial.decision,
      capability: partial.capability,
      executed: partial.executed,
      newEvidence: partial.newEvidence ?? [],
      evidenceCount: session.evidence.length,
      graphSummary: { nodes: session.graph.nodes.length, edges: session.graph.edges.length },
      budget: session.budget,
      message: partial.message,
      mustAnswer: partial.mustAnswer ?? false,
      mustAskUser: partial.mustAskUser ?? false,
      question: partial.question,
      gaps: coverageGaps(this.context(session.id) as InvestigationContext).map((gap) => ({ id: gap.id, description: gap.description, capability: gap.suggestedCapability })),
      error: partial.error,
    }
    runtime.lastStep = result
    return result
  }

  private missing(sessionId: string): StepResult {
    return {
      state: "FAILED",
      status: "FAILED",
      verdict: "REJECT",
      decision: "STOP",
      capability: null,
      executed: false,
      newEvidence: [],
      evidenceCount: 0,
      graphSummary: { nodes: 0, edges: 0 },
      budget: createBudget(),
      message: `Unknown session ${sessionId}.`,
      mustAnswer: false,
      mustAskUser: false,
      gaps: [],
      error: "unknown_session",
    }
  }

  private terminate(sessionId: string, reason: TerminationReason): void {
    const runtime = this.sessions.get(sessionId)
    if (!runtime) return
    runtime.session.termination = reason
    if (runtime.controller.state !== "STOPPED") runtime.session.status = "STOPPED"
    this.events.append(sessionId, EVENT.SESSION_TERMINATED, { reason })
  }

  private reject(sessionId: string, result: ControlResult): ControlResult {
    this.events.append(sessionId, EVENT.CONTROL_REJECTED, { command: result.command, message: result.message })
    return result
  }
}

const GRAPH_CAPABILITIES = new Set<CapabilityId>(["CALL_GRAPH", "IMPORT_GRAPH", "DEPENDENCY_GRAPH", "REVERSE_DEPENDENCY", "DATA_FLOW", "API_IMPLEMENTATION"])

const REQUIRES_TARGET = new Set<CapabilityId>([
  "EXACT_SEARCH",
  "TEXT_SEARCH",
  "FILENAME_SEARCH",
  "FUZZY_SEARCH",
  "SEMANTIC_SEARCH",
  "SYMBOL_SEARCH",
  "FIND_DEFINITION",
  "FIND_REFERENCES",
  "FIND_CALLERS",
  "FIND_CALLEES",
  "FIND_IMPLEMENTATIONS",
  "READ_SYMBOL",
  "AST_FUNCTION",
  "AST_CLASS",
  "AST_SCHEMA",
  "AST_IMPORT",
  "AST_DECORATOR",
  "AST_PARAMETER",
  "ROUTE_SEARCH",
  "ENDPOINT_DEFINITION",
  "API_IMPLEMENTATION",
  "CALL_GRAPH",
  "REVERSE_DEPENDENCY",
  "DATA_FLOW",
])

const INTENT_KEYWORDS: Array<{ intent: InvestigationIntent; patterns: RegExp[] }> = [
  { intent: "SAFE_REMOVAL", patterns: [/\b(remove|delete|drop|safe to remove|can i delete)\b/i] },
  { intent: "CYCLE_DETECTION", patterns: [/\b(cycle|circular|loop)\b/i] },
  { intent: "IMPACT_ANALYSIS", patterns: [/\b(impact|affect|break|regression|ripple)\b/i] },
  { intent: "DEPENDENCY_ANALYSIS", patterns: [/\b(dependenc|dependents|imports?)\b/i] },
  { intent: "SCHEMA_ANALYSIS", patterns: [/\b(schema|model|doctype|interface|type definition|pydantic|zod)\b/i] },
  { intent: "ROUTE_ANALYSIS", patterns: [/\b(route|endpoint)\b/i] },
  { intent: "FIND_API", patterns: [/\b(api|endpoint|route|http|graphql|rest)\b/i] },
  { intent: "TRACE_FLOW", patterns: [/\b(flow|trace|pipeline|from .* to )\b/i] },
  { intent: "UNDERSTAND_FUNCTION", patterns: [/\b(what does|how does|understand|explain)\b/i] },
  { intent: "FIND_REFERENCE", patterns: [/\b(references?|used by|usage|callers?)\b/i] },
  { intent: "FIND_DEFINITION", patterns: [/\b(where is|definition|defined|declare)\b/i] },
  { intent: "FIND_FUNCTION", patterns: [/\b(function|method|def)\b/i] },
]

export function classify(question: string): { intents: InvestigationIntent[]; entities: string[] } {
  const intents = INTENT_KEYWORDS.filter((entry) => entry.patterns.some((pattern) => pattern.test(question))).map((entry) => entry.intent)
  if (!intents.length) intents.push("GENERAL_EXPLORATION")
  const entities = new Set<string>()
  for (const match of question.matchAll(/["'`]([^"'`]+)["'`]/g)) entities.add(match[1])
  for (const match of question.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*[A-Z][a-zA-Z0-9_]*|[a-z]+_[a-z_]+)\b/g)) entities.add(match[1])
  for (const match of question.matchAll(/\/[a-zA-Z0-9_\-/{}.]+/g)) entities.add(match[0])
  for (const match of question.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)/g)) entities.add(match[1])
  return { intents, entities: [...entities].slice(0, 20) }
}

function unverifiedAreas(session: InvestigationSession): string[] {
  const used = new Set(session.actions.map((action) => action.capability))
  const areas: string[] = []
  if (!used.has("FIND_REFERENCES") && !used.has("EXACT_SEARCH")) areas.push("symbol references")
  if (!used.has("ROUTE_SEARCH") && session.intent.includes("FIND_API")) areas.push("API routes")
  if (!used.has("AST_SCHEMA")) areas.push("schema definitions")
  if (!used.has("CYCLE_DETECTION")) areas.push("dependency cycles")
  if (session.graph.nodes.length === 0) areas.push("call and import relationships")
  return areas
}
