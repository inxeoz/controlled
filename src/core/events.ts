import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { redact } from "./redact"

/** Versioned visualizer event protocol (spec section 89). */
export const PROTOCOL_VERSION = 1

export interface ControlledEvent {
  version: number
  seq: number
  id: string
  type: string
  sessionId: string
  timestamp: string
  payload: Record<string, unknown>
}

export type EventListener = (event: ControlledEvent) => void

/**
 * Immutable, append-only event stream (spec section 50).
 * It is the single source of session history: the visualizer never keeps its
 * own independent execution history.
 */
export class EventStore {
  private readonly events = new Map<string, ControlledEvent[]>()
  private readonly listeners = new Map<string, Set<EventListener>>()
  private readonly seq = new Map<string, number>()
  private readonly dir: string | null

  constructor(dir: string | null = null) {
    this.dir = dir
    if (dir) mkdirSync(dir, { recursive: true })
  }

  append(sessionId: string, type: string, payload: Record<string, unknown> = {}): ControlledEvent {
    const next = (this.seq.get(sessionId) ?? 0) + 1
    this.seq.set(sessionId, next)
    const event: ControlledEvent = {
      version: PROTOCOL_VERSION,
      seq: next,
      id: `evt_${sessionId}_${next}`,
      type,
      sessionId,
      timestamp: new Date().toISOString(),
      payload: redact(payload) as Record<string, unknown>,
    }
    const list = this.events.get(sessionId) ?? []
    list.push(event)
    this.events.set(sessionId, list)
    this.persist(event)
    for (const listener of this.listeners.get(sessionId) ?? []) {
      try {
        listener(event)
      } catch {
        // A broken visualizer socket must not break the investigation.
      }
    }
    return event
  }

  list(sessionId: string, after = 0): ControlledEvent[] {
    return (this.events.get(sessionId) ?? []).filter((event) => event.seq > after)
  }

  all(sessionId: string): ControlledEvent[] {
    return this.events.get(sessionId) ?? []
  }

  sessions(): string[] {
    return [...this.events.keys()]
  }

  subscribe(sessionId: string, listener: EventListener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set<EventListener>()
    set.add(listener)
    this.listeners.set(sessionId, set)
    return () => {
      set.delete(listener)
    }
  }

  /** Fold events up to and including `at` to reconstruct historical state (spec section 63). */
  replay(sessionId: string, at?: number): ControlledEvent[] {
    const limit = at ?? Number.MAX_SAFE_INTEGER
    return this.all(sessionId).filter((event) => event.seq <= limit)
  }

  private persist(event: ControlledEvent): void {
    if (!this.dir) return
    try {
      appendFileSync(path.join(this.dir, `${event.sessionId}.jsonl`), JSON.stringify(event) + "\n")
    } catch {
      // Persistence is best-effort; the in-memory stream remains authoritative.
    }
  }

  load(sessionId: string): ControlledEvent[] {
    if (!this.dir) return []
    const file = path.join(this.dir, `${sessionId}.jsonl`)
    if (!existsSync(file)) return []
    const events: ControlledEvent[] = []
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as ControlledEvent)
      } catch {
        // Skip corrupt trailing line.
      }
    }
    if (events.length) {
      this.events.set(sessionId, events)
      this.seq.set(sessionId, events[events.length - 1].seq)
    }
    return events
  }
}

export const EVENT = {
  SESSION_CREATED: "SESSION_CREATED",
  SESSION_STATUS: "SESSION_STATUS",
  STATE_ENTERED: "STATE_ENTERED",
  STATE_TRANSITION: "STATE_TRANSITION",
  STATE_REJECTED: "STATE_REJECTED",
  LLM_PROPOSAL: "LLM_PROPOSAL",
  JEV_DECISION: "JEV_DECISION",
  ACTION_STARTED: "ACTION_STARTED",
  ACTION_COMPLETED: "ACTION_COMPLETED",
  ACTION_FAILED: "ACTION_FAILED",
  EVIDENCE_FOUND: "EVIDENCE_FOUND",
  GRAPH_UPDATED: "GRAPH_UPDATED",
  CYCLE_DETECTED: "CYCLE_DETECTED",
  CONTRADICTION_DETECTED: "CONTRADICTION_DETECTED",
  BUDGET_UPDATED: "BUDGET_UPDATED",
  CONTROL_COMMAND: "CONTROL_COMMAND",
  CONTROL_REJECTED: "CONTROL_REJECTED",
  MACHINE_VERSION_CHANGED: "MACHINE_VERSION_CHANGED",
  STATE_ADDED: "STATE_ADDED",
  STATE_REMOVED: "STATE_REMOVED",
  STATE_MODIFIED: "STATE_MODIFIED",
  TRANSITION_ADDED: "TRANSITION_ADDED",
  TRANSITION_REMOVED: "TRANSITION_REMOVED",
  TRANSITION_MODIFIED: "TRANSITION_MODIFIED",
  PENDING_CHANGE: "PENDING_CHANGE",
  CHANGE_APPLIED: "CHANGE_APPLIED",
  ANSWER_READY: "ANSWER_READY",
  SESSION_TERMINATED: "SESSION_TERMINATED",
  ERROR: "ERROR",
} as const
