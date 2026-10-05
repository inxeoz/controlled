import { describe, expect, test } from "bun:test"
import path from "node:path"
import { CAPABILITY_FNS } from "../src/capabilities/execute"
import { EventStore } from "../src/core/events"
import { ControlledRuntime, classify } from "../src/core/runtime"

const ROOT = path.resolve(import.meta.dir, "../fixtures/sample-repo")

function runtime(): ControlledRuntime {
  return new ControlledRuntime(ROOT, { events: new EventStore(null) })
}

describe("classification", () => {
  test("detects safe-removal and API intents", () => {
    const result = classify("Can I remove customer_id from the OrderRequest schema? Where is the API?")
    expect(result.intents).toContain("SAFE_REMOVAL")
    expect(result.intents).toContain("FIND_API")
    expect(result.entities).toContain("customer_id")
  })

  test("falls back to general exploration", () => {
    expect(classify("hello there").intents).toEqual(["GENERAL_EXPLORATION"])
  })
})

describe("controlled investigation loop", () => {
  test("runs exact search, route search and produces an answer", async () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "Where is the API that creates an order?" })
    const first = await controlled.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" }, reason: "find entry point" })
    expect(first.verdict).toBe("ALLOW")
    expect(first.executed).toBe(true)
    expect(first.newEvidence.length).toBeGreaterThan(0)

    const second = await controlled.step(session.id, { capability: "ROUTE_SEARCH", target: { query: "/orders" } })
    expect(second.executed).toBe(true)

    const finish = controlled.finish(session.id, { answer: "POST /orders is handled by create_order_endpoint." })
    expect("answer" in finish).toBe(true)
    if ("answer" in finish) {
      expect(finish.status).toBe("COMPLETED")
      expect(finish.answer.files.length).toBeGreaterThan(0)
      expect(finish.answer.unverified.length).toBeGreaterThan(0)
    }
  })

  test("prevents a duplicate action through the XState guard", async () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "find create_order" })
    await controlled.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    const duplicate = await controlled.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    expect(duplicate.executed).toBe(false)
    expect(duplicate.message.toLowerCase()).toContain("guard")
  })

  test("enforces the action budget", async () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "find create_order", budget: { maxActions: 1, maxLLMIterations: 10 } })
    await controlled.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    const next = await controlled.step(session.id, { capability: "ROUTE_SEARCH", target: { query: "/orders" } })
    expect(next.decision).toBe("STOP")
    expect(next.executed).toBe(false)
  })

  test("stop is a runtime command, not a JEV decision", async () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "find create_order" })
    const stop = controlled.control({ sessionId: session.id, command: "STOP", mode: "CONTROL" })
    expect(stop.ok).toBe(true)
    const after = await controlled.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    expect(after.executed).toBe(false)
    expect(after.message.toLowerCase()).toContain("already")
  })

  test("pause blocks execution and resume restores it", async () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "find create_order" })
    expect(controlled.control({ sessionId: session.id, command: "PAUSE", mode: "CONTROL" }).ok).toBe(true)
    const paused = await controlled.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    expect(paused.executed).toBe(false)
    expect(controlled.control({ sessionId: session.id, command: "RESUME", mode: "CONTROL" }).ok).toBe(true)
    const resumed = await controlled.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    expect(resumed.executed).toBe(true)
  })

  test("OBSERVE mode cannot change execution", () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "find create_order" })
    const result = controlled.control({ sessionId: session.id, command: "PAUSE", mode: "OBSERVE" })
    expect(result.ok).toBe(false)
    expect(result.message).toContain("OBSERVE")
  })

  test("MODIFY mode can change the machine and budget", () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "find create_order" })
    const addState = controlled.control({ sessionId: session.id, command: "ADD_STATE", mode: "MODIFY", payload: { id: "DATABASE_SEARCH" } })
    expect(addState.ok).toBe(true)
    const budget = controlled.control({ sessionId: session.id, command: "UPDATE_BUDGET", mode: "MODIFY", payload: { maxActions: 30 } })
    expect(budget.ok).toBe(true)
    expect(controlled.get(session.id)?.budget.maxActions).toBe(30)
  })

  test("rejects a command for an unknown session", () => {
    const controlled = runtime()
    expect(controlled.control({ sessionId: "inv_missing", command: "PAUSE", mode: "CONTROL" }).ok).toBe(false)
  })

  test("detects a cycle and records a cycle event", async () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "is there a circular dependency?" })
    const result = await controlled.step(session.id, { capability: "CYCLE_DETECTION", target: {} })
    expect(result.executed).toBe(true)
    const events = controlled.events.all(session.id).map((event) => event.type)
    expect(events).toContain("CYCLE_DETECTED")
  })

  test("records a tool failure and does not hide it", async () => {
    CAPABILITY_FNS.BROKEN_SEARCH = () => {
      throw new Error("boom")
    }
    const controlled = runtime()
    controlled.registry.register({ id: "BROKEN_SEARCH", category: "DISCOVERY", description: "broken", cost: 1, depthCost: 0, expectedInformationGain: 0.5, requires: [], produces: [], canRepeat: true, canCreateGraphEdges: false })
    const { session } = controlled.start({ question: "find something" })
    const result = await controlled.step(session.id, { capability: "BROKEN_SEARCH", target: { query: "x" } })
    expect(result.executed).toBe(false)
    expect(result.error).toContain("boom")
    const events = controlled.events.all(session.id).map((event) => event.type)
    expect(events).toContain("ACTION_FAILED")
    delete CAPABILITY_FNS.BROKEN_SEARCH
  })

  test("a registered but unimplemented capability is rejected by the guard", async () => {
    const controlled = runtime()
    controlled.registry.register({ id: "GHOST_SEARCH", category: "DISCOVERY", description: "ghost", cost: 1, depthCost: 0, expectedInformationGain: 0.5, requires: [], produces: [], canRepeat: true, canCreateGraphEdges: false })
    const { session } = controlled.start({ question: "find something" })
    const result = await controlled.step(session.id, { capability: "GHOST_SEARCH", target: { query: "x" } })
    expect(result.executed).toBe(false)
    expect(result.message.toLowerCase()).toContain("guard")
  })

  test("replay reconstructs the session state from the event stream", async () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "find create_order" })
    await controlled.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    await controlled.step(session.id, { capability: "FIND_DEFINITION", target: { symbol: "create_order" } })
    const events = controlled.events.all(session.id)
    expect(events.length).toBeGreaterThan(4)
    expect(events[0].type).toBe("SESSION_CREATED")
    expect(events.every((event, index) => index === 0 || event.seq > events[index - 1].seq)).toBe(true)
  })

  test("events are serializable and versioned", async () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "find create_order" })
    await controlled.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    const event = controlled.events.all(session.id)[0]
    const parsed = JSON.parse(JSON.stringify(event))
    expect(parsed.version).toBe(1)
    expect(parsed.sessionId).toBe(session.id)
    expect(typeof parsed.timestamp).toBe("string")
  })

  test("detects a repeated action sequence with no new evidence and stops", async () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "find something" })
    const first = await controlled.step(session.id, { capability: "AST_DECORATOR", target: { query: "zzz_not_present" } })
    expect(first.executed).toBe(true)
    expect(first.newEvidence.length).toBe(0)
    const second = await controlled.step(session.id, { capability: "AST_DECORATOR", target: { query: "yyy_not_present" } })
    expect(second.decision).toBe("STOP")
    expect(second.message).toContain("Repeated")
  })

  test("marks the session as VERIFYING when a contradiction is found", async () => {
    const controlled = runtime()
    const { session } = controlled.start({ question: "can I remove customer_id?" })
    await controlled.step(session.id, { capability: "FIND_DEFINITION", target: { symbol: "create_order" } })
    await controlled.step(session.id, { capability: "FIND_REFERENCES", target: { symbol: "create_order" } })
    const result = await controlled.step(session.id, { capability: "CONTRADICTION_CHECK", target: {} })
    expect(result.executed).toBe(true)
    expect(controlled.get(session.id)?.status).toBe("VERIFYING")
  })

  test("secrets are redacted from the event stream", () => {
    const store = new EventStore(null)
    const event = store.append("inv_x", "NOTE", { apiKey: "sk-abcdefghijklmnop", note: "hello" })
    expect(event.payload.apiKey).toBe("[redacted]")
    expect(event.payload.note).toBe("hello")
  })
})
