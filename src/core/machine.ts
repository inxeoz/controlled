/**
 * XState-style execution controller.
 *
 * XState owns runtime control only (role.md sections 3 and 10):
 *   - what state the investigation is in,
 *   - which transitions are structurally valid,
 *   - which guards pass,
 *   - when a pending runtime change may apply.
 *
 * XState does NOT select investigation strategy. JEV does that. XState only
 * answers: "Given that decision, is this executable from the current state?"
 */

/**
 * States are dynamic: the visualizer can add or remove them at runtime
 * (spec sections 65-68), so a state id is an open string rather than a closed
 * union. `KnownMachineState` lists the states the base machine ships with.
 */
export type MachineState = string

export type KnownMachineState =
  | "IDLE"
  | "UNDERSTANDING"
  | "READY"
  | "JEV_DECISION"
  | "EXECUTING"
  | "COLLECTING_EVIDENCE"
  | "EVALUATING"
  | "ANSWERING"
  | "COMPLETED"
  | "STOPPED"
  | "WAITING_FOR_USER"
  | "PAUSED"
  | "FAILED"

export type GuardName =
  | "HAS_BUDGET"
  | "DEPTH_ALLOWED"
  | "ACTION_ALLOWED"
  | "TARGET_VALID"
  | "NOT_DUPLICATE"
  | "NOT_ALREADY_EXPLORED"
  | "NO_ACTIVE_CONFLICT"
  | "USER_NOT_STOPPED"
  | "CAPABILITY_AVAILABLE"

export type GuardFlags = Record<GuardName, boolean>

export const ALL_GUARDS_PASS: GuardFlags = {
  HAS_BUDGET: true,
  DEPTH_ALLOWED: true,
  ACTION_ALLOWED: true,
  TARGET_VALID: true,
  NOT_DUPLICATE: true,
  NOT_ALREADY_EXPLORED: true,
  NO_ACTIVE_CONFLICT: true,
  USER_NOT_STOPPED: true,
  CAPABILITY_AVAILABLE: true,
}

export interface TransitionDef {
  id: string
  from: MachineState | "*"
  to: MachineState
  event: string
  guards: GuardName[]
  description?: string
  /** Cost accounting hook: JEV budget is debited when this transition fires. */
  cost?: number
}

export interface StateDef {
  id: MachineState
  category: "LIFECYCLE" | "TERMINAL" | "CONTROL"
  description: string
  disabled?: boolean
}

export interface MachineConfig {
  version: string
  states: StateDef[]
  transitions: TransitionDef[]
}

export type RuntimeChangeType =
  | "ADD_STATE"
  | "REMOVE_STATE"
  | "MODIFY_STATE"
  | "ADD_TRANSITION"
  | "REMOVE_TRANSITION"
  | "MODIFY_TRANSITION"
  | "DISABLE_STATE"
  | "ENABLE_STATE"

export interface RuntimeChange {
  id: string
  type: RuntimeChangeType
  payload: Record<string, unknown>
  requestedAt: string
  applied: boolean
  appliedAt?: string
  /** A change touching an active state waits for a safe transition boundary. */
  pending: boolean
  error?: string
}

export interface TransitionResult {
  ok: boolean
  from: MachineState
  to: MachineState
  event: string
  reason: string
  failedGuards: GuardName[]
}

const TERMINAL: MachineState[] = ["COMPLETED", "STOPPED", "FAILED"]

export function baseMachine(): MachineConfig {
  const states: StateDef[] = [
    { id: "IDLE", category: "LIFECYCLE", description: "No investigation is active." },
    { id: "UNDERSTANDING", category: "LIFECYCLE", description: "Classifying the question and extracting entities." },
    { id: "READY", category: "LIFECYCLE", description: "Waiting for the next LLM proposal." },
    { id: "JEV_DECISION", category: "LIFECYCLE", description: "Evaluating the proposal against policy." },
    { id: "EXECUTING", category: "LIFECYCLE", description: "Running an approved capability." },
    { id: "COLLECTING_EVIDENCE", category: "LIFECYCLE", description: "Storing the evidence the capability produced." },
    { id: "EVALUATING", category: "LIFECYCLE", description: "Deciding whether the investigation should continue." },
    { id: "ANSWERING", category: "LIFECYCLE", description: "Synthesizing the final answer." },
    { id: "WAITING_FOR_USER", category: "CONTROL", description: "Blocked until the user resolves an ambiguity." },
    { id: "PAUSED", category: "CONTROL", description: "Suspended by the user; context is preserved." },
    { id: "COMPLETED", category: "TERMINAL", description: "The investigation produced an answer." },
    { id: "STOPPED", category: "TERMINAL", description: "The user stopped the investigation." },
    { id: "FAILED", category: "TERMINAL", description: "The investigation failed." },
  ]

  const t = (from: TransitionDef["from"], to: MachineState, event: string, guards: GuardName[] = [], cost = 0): TransitionDef => ({
    id: `${String(from)}--${event}-->${to}`,
    from,
    to,
    event,
    guards,
    cost,
  })

  const transitions: TransitionDef[] = [
    t("IDLE", "UNDERSTANDING", "START"),
    t("UNDERSTANDING", "READY", "UNDERSTOOD"),
    t("READY", "JEV_DECISION", "PROPOSE", ["USER_NOT_STOPPED"]),
    t("READY", "ANSWERING", "ANSWER"),
    t("JEV_DECISION", "EXECUTING", "EXPLORE", [
      "HAS_BUDGET",
      "DEPTH_ALLOWED",
      "ACTION_ALLOWED",
      "TARGET_VALID",
      "NOT_DUPLICATE",
      "NOT_ALREADY_EXPLORED",
      "NO_ACTIVE_CONFLICT",
      "USER_NOT_STOPPED",
      "CAPABILITY_AVAILABLE",
    ]),
    t("JEV_DECISION", "EXECUTING", "VERIFY", ["HAS_BUDGET", "ACTION_ALLOWED", "USER_NOT_STOPPED", "CAPABILITY_AVAILABLE"]),
    t("JEV_DECISION", "READY", "REJECT"),
    t("JEV_DECISION", "ANSWERING", "ANSWER"),
    t("JEV_DECISION", "ANSWERING", "STOP"),
    t("JEV_DECISION", "WAITING_FOR_USER", "ASK_USER"),
    t("EXECUTING", "COLLECTING_EVIDENCE", "EXECUTED"),
    t("EXECUTING", "EVALUATING", "FAILED"),
    t("COLLECTING_EVIDENCE", "EVALUATING", "COLLECTED"),
    t("EVALUATING", "READY", "NEXT"),
    t("EVALUATING", "ANSWERING", "ENOUGH"),
    t("ANSWERING", "COMPLETED", "ANSWERED"),
    t("WAITING_FOR_USER", "READY", "USER_INPUT"),
    t("*", "PAUSED", "PAUSE"),
    t("PAUSED", "READY", "RESUME"),
    t("*", "STOPPED", "STOP"),
    t("*", "FAILED", "FAIL"),
  ]

  return { version: "machine-v1", states, transitions }
}

export interface ControllerOptions {
  config?: MachineConfig
  onChange?: (event: { type: string; from: MachineState; to: MachineState; payload?: Record<string, unknown> }) => void
}

export class Controller {
  config: MachineConfig
  state: MachineState = "IDLE"
  previous: MachineState = "IDLE"
  pausedFrom: MachineState | null = null
  history: TransitionResult[] = []
  pendingChanges: RuntimeChange[] = []

  private readonly onChange?: ControllerOptions["onChange"]

  constructor(options: ControllerOptions = {}) {
    this.config = options.config ?? baseMachine()
    this.onChange = options.onChange
  }

  get version(): string {
    return this.config.version
  }

  states(): StateDef[] {
    return this.config.states
  }

  transitions(): TransitionDef[] {
    return this.config.transitions
  }

  availableEvents(): string[] {
    if (TERMINAL.includes(this.state)) return []
    if (this.state === "PAUSED") return ["RESUME", "STOP"]
    return [...new Set(this.config.transitions.filter((item) => item.from === "*" || item.from === this.state).map((item) => item.event))]
  }

  isTerminal(): boolean {
    return TERMINAL.includes(this.state)
  }

  can(event: string, guards: GuardFlags = ALL_GUARDS_PASS): TransitionResult {
    const from = this.state
    if (this.state === "PAUSED" && event !== "RESUME" && event !== "STOP") {
      return this.fail(from, event, "The investigation is paused.")
    }
    if (TERMINAL.includes(from)) {
      return this.fail(from, event, `The investigation is already ${from.toLowerCase()}.`)
    }
    // Resume returns to the state the investigation was paused from.
    if (from === "PAUSED" && event === "RESUME") {
      return { ok: true, from, to: this.pausedFrom ?? "READY", event, reason: "Resumed from the paused state.", failedGuards: [] }
    }
    const candidates = this.config.transitions.filter(
      (item) => item.event === event && (item.from === from || item.from === "*"),
    )
    if (candidates.length === 0) {
      return this.fail(from, event, `No transition for ${event} from ${from}.`)
    }
    for (const candidate of candidates) {
      const stateDef = this.config.states.find((item) => item.id === candidate.to)
      if (stateDef?.disabled) continue
      const failed = candidate.guards.filter((guard) => guards[guard] === false)
      if (failed.length === 0) {
        return { ok: true, from, to: candidate.to, event, reason: "Transition is valid.", failedGuards: [] }
      }
      if (candidates.length === 1) {
        return this.fail(from, event, `Guard(s) failed: ${failed.join(", ")}.`, failed)
      }
    }
    return this.fail(from, event, `No enabled transition for ${event} from ${from}.`)
  }

  send(event: string, guards: GuardFlags = ALL_GUARDS_PASS): TransitionResult {
    const result = this.can(event, guards)
    if (!result.ok) {
      this.onChange?.({ type: "STATE_REJECTED", from: this.state, to: this.state, payload: { event, reason: result.reason } })
      return result
    }
    this.previous = this.state
    if (result.to === "PAUSED") this.pausedFrom = this.state
    if (this.state === "PAUSED" && result.to !== "PAUSED") this.pausedFrom = null
    this.state = result.to
    this.history.push(result)
    this.applyPendingChangesIfSafe()
    this.onChange?.({ type: "STATE_TRANSITION", from: result.from, to: result.to, payload: { event } })
    return result
  }

  /** A safe transition boundary is any non-transient state. */
  private isSafeBoundary(): boolean {
    return ["IDLE", "UNDERSTANDING", "READY", "WAITING_FOR_USER", "ANSWERING", "PAUSED", "COMPLETED", "STOPPED", "FAILED"].includes(this.state)
  }

  private applyPendingChangesIfSafe(): void {
    if (!this.isSafeBoundary()) return
    for (const change of this.pendingChanges) {
      if (!change.pending) continue
      const result = this.applyChange(change)
      if (result.ok) {
        change.pending = false
        change.applied = true
        change.appliedAt = new Date().toISOString()
        this.onChange?.({ type: "CHANGE_APPLIED", from: this.state, to: this.state, payload: { change: change.id, type: change.type } })
      }
    }
  }

  /** Request a live XState modification (spec sections 65-68). */
  requestChange(type: RuntimeChangeType, payload: Record<string, unknown>): RuntimeChange {
    const change: RuntimeChange = {
      id: `chg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      type,
      payload,
      requestedAt: new Date().toISOString(),
      applied: false,
      pending: false,
    }
    const validation = this.validateChange(change)
    if (!validation.ok) {
      change.error = validation.reason
      this.onChange?.({ type: "CONTROL_REJECTED", from: this.state, to: this.state, payload: { change: change.id, reason: validation.reason } })
      return change
    }
    if (!this.isSafeBoundary()) {
      change.pending = true
      this.pendingChanges.push(change)
      this.onChange?.({ type: "PENDING_CHANGE", from: this.state, to: this.state, payload: { change: change.id, type } })
      return change
    }
    const applied = this.applyChange(change)
    change.applied = applied.ok
    change.error = applied.reason
    if (applied.ok) change.appliedAt = new Date().toISOString()
    return change
  }

  private validateChange(change: RuntimeChange): { ok: boolean; reason: string } {
    const { type, payload } = change
    if (type === "REMOVE_STATE") {
      const id = String(payload.id)
      if (id === this.state) return { ok: false, reason: "Cannot remove the active state." }
      if (TERMINAL.includes(id as MachineState) || id === "IDLE" || id === "READY") {
        return { ok: false, reason: `State ${id} is required by the machine.` }
      }
      const incoming = this.config.transitions.filter((item) => item.to === id)
      const outgoing = this.config.transitions.filter((item) => item.from === id)
      if (incoming.length > 0 || outgoing.length > 0) {
        return { ok: false, reason: `State ${id} still has transitions. Remove them first.` }
      }
    }
    if (type === "ADD_TRANSITION" || type === "MODIFY_TRANSITION") {
      const from = String(payload.from)
      const to = String(payload.to)
      const known = new Set(this.config.states.map((item) => item.id))
      if (from !== "*" && !known.has(from as MachineState)) return { ok: false, reason: `Unknown source state ${from}.` }
      if (!known.has(to as MachineState)) return { ok: false, reason: `Unknown target state ${to}.` }
    }
    if (type === "DISABLE_STATE" && String(payload.id) === this.state) {
      return { ok: false, reason: "Cannot disable the active state." }
    }
    return { ok: true, reason: "Valid change." }
  }

  private applyChange(change: RuntimeChange): { ok: boolean; reason: string } {
    const { type, payload } = change
    const bump = () => {
      const n = Number(this.config.version.replace(/[^0-9]/g, "")) || 1
      this.config = { ...this.config, version: `machine-v${n + 1}` }
      this.onChange?.({ type: "MACHINE_VERSION_CHANGED", from: this.state, to: this.state, payload: { version: this.config.version } })
    }
    switch (type) {
      case "ADD_STATE": {
        const id = String(payload.id) as MachineState
        if (this.config.states.some((item) => item.id === id)) return { ok: false, reason: `State ${id} already exists.` }
        this.config.states.push({
          id,
          category: (payload.category as StateDef["category"]) ?? "LIFECYCLE",
          description: String(payload.description ?? "User-defined state."),
        })
        bump()
        return { ok: true, reason: "State added." }
      }
      case "REMOVE_STATE": {
        const id = String(payload.id)
        this.config.states = this.config.states.filter((item) => item.id !== id)
        bump()
        return { ok: true, reason: "State removed." }
      }
      case "MODIFY_STATE": {
        const id = String(payload.id)
        const state = this.config.states.find((item) => item.id === id)
        if (!state) return { ok: false, reason: `Unknown state ${id}.` }
        if (payload.description !== undefined) state.description = String(payload.description)
        if (payload.category !== undefined) state.category = payload.category as StateDef["category"]
        bump()
        return { ok: true, reason: "State modified." }
      }
      case "ADD_TRANSITION": {
        const id = String(payload.id ?? `${String(payload.from)}--${String(payload.event)}-->${String(payload.to)}`)
        if (this.config.transitions.some((item) => item.id === id)) return { ok: false, reason: `Transition ${id} already exists.` }
        this.config.transitions.push({
          id,
          from: String(payload.from) as TransitionDef["from"],
          to: String(payload.to) as MachineState,
          event: String(payload.event),
          guards: (payload.guards as GuardName[]) ?? [],
          description: payload.description ? String(payload.description) : undefined,
          cost: typeof payload.cost === "number" ? payload.cost : 0,
        })
        bump()
        return { ok: true, reason: "Transition added." }
      }
      case "REMOVE_TRANSITION": {
        const id = String(payload.id)
        this.config.transitions = this.config.transitions.filter((item) => item.id !== id)
        bump()
        return { ok: true, reason: "Transition removed." }
      }
      case "MODIFY_TRANSITION": {
        const id = String(payload.id)
        const transition = this.config.transitions.find((item) => item.id === id)
        if (!transition) return { ok: false, reason: `Unknown transition ${id}.` }
        if (payload.to !== undefined) transition.to = String(payload.to) as MachineState
        if (payload.event !== undefined) transition.event = String(payload.event)
        if (payload.guards !== undefined) transition.guards = payload.guards as GuardName[]
        if (payload.cost !== undefined) transition.cost = Number(payload.cost)
        bump()
        return { ok: true, reason: "Transition modified." }
      }
      case "DISABLE_STATE":
      case "ENABLE_STATE": {
        const id = String(payload.id)
        const state = this.config.states.find((item) => item.id === id)
        if (!state) return { ok: false, reason: `Unknown state ${id}.` }
        state.disabled = type === "DISABLE_STATE"
        bump()
        return { ok: true, reason: type === "DISABLE_STATE" ? "State disabled." : "State enabled." }
      }
      default:
        return { ok: false, reason: `Unsupported change type ${type}.` }
    }
  }

  private fail(from: MachineState, event: string, reason: string, failedGuards: GuardName[] = []): TransitionResult {
    return { ok: false, from, to: from, event, reason, failedGuards }
  }
}
