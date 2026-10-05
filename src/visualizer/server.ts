import type { ControlledRuntime, ControlCommand, ControlRequest } from "../core/runtime"
import type { ControlledEvent } from "../core/events"
import { renderVisualizerHtml } from "./ui"

export interface VisualizerOptions {
  port?: number
  hostname?: string
  token?: string
  runtime: ControlledRuntime
}

interface SocketData {
  sessionId: string
}

/**
 * The visualizer server (spec sections 52-53, 75, 89-91).
 * It binds to localhost by default, speaks a versioned event protocol over
 * WebSocket, and validates every browser command against the session and mode.
 */
export class VisualizerServer {
  private server: ReturnType<typeof Bun.serve<SocketData>> | null = null
  private readonly runtime: ControlledRuntime
  readonly token: string
  private readonly portValue: number
  private readonly hostname: string
  private readonly sockets = new Set<unknown>()
  private readonly unsubscribe = new Map<string, () => void>()

  constructor(options: VisualizerOptions) {
    this.runtime = options.runtime
    this.portValue = options.port ?? Number(process.env.CONTROLLED_VISUALIZER_PORT ?? 4599)
    this.hostname = options.hostname ?? "127.0.0.1"
    this.token = options.token ?? process.env.CONTROLLED_VISUALIZER_TOKEN ?? randomToken()
  }

  get port(): number {
    return this.server?.port ?? this.portValue
  }

  get url(): string {
    return `http://${this.hostname}:${this.port}/?token=${this.token}`
  }

  start(): string {
    if (this.server) return this.url
    const runtime = this.runtime
    this.server = Bun.serve<SocketData>({
      port: this.portValue,
      hostname: this.hostname,
      fetch: (request, server) => this.handle(request, server),
      websocket: {
        open: (socket) => {
          const data = socket.data as SocketData
          const unsubscribe = this.runtime.subscribe(data.sessionId, (event) => {
            socket.send(JSON.stringify(event))
          })
          this.unsubscribe.set(socket as unknown as string, unsubscribe)
        },
        message: (socket, message) => {
          try {
            const payload = JSON.parse(String(message)) as { command: ControlCommand; payload?: Record<string, unknown>; mode?: ControlRequest["mode"] }
            const data = socket.data as SocketData
            const result = this.runtime.control({ sessionId: data.sessionId, command: payload.command, payload: payload.payload, mode: payload.mode })
            socket.send(JSON.stringify({ version: 1, type: "CONTROL_RESULT", sessionId: data.sessionId, timestamp: new Date().toISOString(), payload: result }))
          } catch (error) {
            socket.send(JSON.stringify({ version: 1, type: "CONTROL_REJECTED", sessionId: (socket.data as SocketData).sessionId, timestamp: new Date().toISOString(), payload: { message: (error as Error).message } }))
          }
        },
        close: (socket) => {
          const unsubscribe = this.unsubscribe.get(socket as unknown as string)
          unsubscribe?.()
          this.unsubscribe.delete(socket as unknown as string)
          this.sockets.delete(socket)
        },
      },
    })
    return this.url
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribe.values()) unsubscribe()
    this.unsubscribe.clear()
    this.server?.stop(true)
    this.server = null
  }

  get running(): boolean {
    return Boolean(this.server)
  }

  private handle(request: Request, server: ReturnType<typeof Bun.serve<SocketData>>): Response | Promise<Response> | undefined {
    const url = new URL(request.url)
    const token = url.searchParams.get("token") ?? request.headers.get("x-controlled-token")
    if (url.pathname === "/") {
      return new Response(renderVisualizerHtml(this.token), { headers: { "content-type": "text/html; charset=utf-8" } })
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true, version: 1 })
    }
    if (token !== this.token) {
      return Response.json({ error: "unauthorized" }, { status: 401 })
    }
    if (url.pathname === "/api/sessions") {
      return Response.json({ sessions: this.runtime.list().map((session) => ({ id: session.id, question: session.question, status: session.status, state: session.currentState, evidence: session.evidence.length })) })
    }
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (sessionMatch && request.method === "GET") {
      const snapshot = this.runtime.snapshot(sessionMatch[1])
      if (!snapshot) return Response.json({ error: "unknown_session" }, { status: 404 })
      return Response.json(snapshot)
    }
    const eventsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/)
    if (eventsMatch && request.method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0)
      return Response.json({ events: this.runtime.events.list(eventsMatch[1], after) })
    }
    const stateMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/state$/)
    if (stateMatch && request.method === "GET") {
      const at = url.searchParams.get("at")
      return Response.json(reconstruct(this.runtime.events.replay(stateMatch[1], at ? Number(at) : undefined)))
    }
    const commandMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/command$/)
    if (commandMatch && request.method === "POST") {
      return request.json().then((body) => {
        const payload = (body ?? {}) as { command: ControlCommand; payload?: Record<string, unknown>; mode?: ControlRequest["mode"] }
        if (!payload.command) return Response.json({ error: "missing_command" }, { status: 400 })
        const result = this.runtime.control({ sessionId: commandMatch[1], command: payload.command, payload: payload.payload, mode: payload.mode })
        return Response.json(result)
      })
    }
    const wsMatch = url.pathname === "/ws"
    if (wsMatch) {
      const sessionId = url.searchParams.get("session")
      if (!sessionId || !this.runtime.get(sessionId)) return new Response("unknown session", { status: 404 })
      const upgraded = server.upgrade(request, { data: { sessionId } })
      if (upgraded) return undefined
      return new Response("upgrade failed", { status: 500 })
    }
    return new Response("not found", { status: 404 })
  }
}

function randomToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

/** Fold the event stream to reconstruct session state at a point in time (spec sections 63-64). */
export function reconstruct(events: ControlledEvent[]): Record<string, unknown> {
  let state = "IDLE"
  let status = "INITIALIZING"
  let evidence = 0
  let graphNodes = 0
  let graphEdges = 0
  let budget: unknown = null
  const decisions: unknown[] = []
  const transitions: Array<{ from: unknown; to: unknown; event: unknown }> = []
  for (const event of events) {
    switch (event.type) {
      case "STATE_ENTERED":
      case "STATE_TRANSITION":
        state = String(event.payload.to ?? event.payload.state ?? state)
        transitions.push({ from: event.payload.from, to: event.payload.to, event: event.payload.event })
        break
      case "SESSION_STATUS":
        status = String(event.payload.status ?? status)
        break
      case "EVIDENCE_FOUND":
        evidence += 1
        break
      case "GRAPH_UPDATED":
        graphNodes = Number(event.payload.totalNodes ?? graphNodes)
        graphEdges = Number(event.payload.totalEdges ?? graphEdges)
        break
      case "BUDGET_UPDATED":
        budget = event.payload.budget ?? budget
        break
      case "JEV_DECISION":
        decisions.push(event.payload)
        break
      default:
        break
    }
  }
  return { seq: events.length ? events[events.length - 1].seq : 0, state, status, evidence, graphNodes, graphEdges, budget, decisions, transitions }
}
