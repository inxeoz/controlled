import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { EventStore } from "../src/core/events"
import { ControlledRuntime } from "../src/core/runtime"
import { VisualizerServer, reconstruct } from "../src/visualizer/server"

const ROOT = path.resolve(import.meta.dir, "../fixtures/sample-repo")
const TOKEN = "test-token"

const runtime = new ControlledRuntime(ROOT, { events: new EventStore(null) })
const server = new VisualizerServer({ runtime, port: 0, token: TOKEN })
let base = ""

beforeAll(() => {
  const url = server.start()
  base = url.split("/?")[0]
})

afterAll(() => {
  server.stop()
})

describe("visualizer server", () => {
  test("binds to localhost and reports health", async () => {
    expect(base).toContain("127.0.0.1")
    const response = await fetch(base + "/health")
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; version: number }
    expect(body.ok).toBe(true)
    expect(body.version).toBe(1)
  })

  test("serves the visualizer UI without a token", async () => {
    const response = await fetch(base + "/")
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain("CONTROLLED MODE")
    expect(html).toContain("XState graph")
  })

  test("requires the token for the API", async () => {
    expect((await fetch(base + "/api/sessions")).status).toBe(401)
    expect((await fetch(base + "/api/sessions?token=" + TOKEN)).status).toBe(200)
  })

  test("lists sessions and returns a snapshot", async () => {
    const { session } = runtime.start({ question: "where is the API?" })
    const list = (await (await fetch(base + "/api/sessions?token=" + TOKEN)).json()) as { sessions: unknown[] }
    expect(list.sessions.length).toBeGreaterThan(0)
    const snapshot = (await (await fetch(base + "/api/sessions/" + session.id + "?token=" + TOKEN)).json()) as { machine: { state: string }; registry: unknown[] }
    expect(snapshot.machine.state).toBe("READY")
    expect(Array.isArray(snapshot.registry)).toBe(true)
  })

  test("validates commands against the control mode", async () => {
    const { session } = runtime.start({ question: "where is the API?" })
    const observe = (await (await fetch(base + "/api/sessions/" + session.id + "/command?token=" + TOKEN, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "PAUSE", mode: "OBSERVE" }) })).json()) as { ok: boolean }
    expect(observe.ok).toBe(false)
    const control = (await (await fetch(base + "/api/sessions/" + session.id + "/command?token=" + TOKEN, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "PAUSE", mode: "CONTROL" }) })).json()) as { ok: boolean }
    expect(control.ok).toBe(true)
  })

  test("rejects a command for an unknown session", async () => {
    const response = await fetch(base + "/api/sessions/inv_missing/command?token=" + TOKEN, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: "PAUSE", mode: "CONTROL" }) })
    const body = (await response.json()) as { ok: boolean }
    expect(body.ok).toBe(false)
  })

  test("streams events over WebSocket", async () => {
    const { session } = runtime.start({ question: "find create_order" })
    const received: unknown[] = []
    const socket = new WebSocket(base.replace("http", "ws") + "/ws?session=" + session.id + "&token=" + TOKEN)
    await new Promise<void>((resolve) => {
      socket.onopen = () => resolve()
    })
    socket.onmessage = (message) => received.push(JSON.parse(String(message.data)))
    await runtime.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    await new Promise((resolve) => setTimeout(resolve, 50))
    socket.close()
    expect(received.length).toBeGreaterThan(0)
    const types = received.map((event) => (event as { type: string }).type)
    expect(types).toContain("JEV_DECISION")
    expect(types).toContain("EVIDENCE_FOUND")
  })

  test("reconstructs historical state from the event stream", async () => {
    const { session } = runtime.start({ question: "find create_order" })
    await runtime.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    const events = runtime.events.all(session.id)
    const atStart = reconstruct(runtime.events.replay(session.id, events[0].seq))
    expect(atStart.state).toBe("IDLE")
    const atEnd = reconstruct(runtime.events.replay(session.id))
    expect(atEnd.evidence).toBeGreaterThan(0)
    expect((atEnd.transitions as unknown[]).length).toBeGreaterThan(0)
  })
})
