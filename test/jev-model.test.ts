import { describe, expect, test } from "bun:test"
import path from "node:path"
import { EventStore } from "../src/core/events"
import { buildJevRequest, JevEngine, parseJevOutput, DEFAULT_JEV_MODEL, type JevModel, type JevModelOutput } from "../src/core/jev-model"
import { CapabilityRegistry } from "../src/core/registry"
import { createBudget } from "../src/core/budget"
import { ControlledRuntime } from "../src/core/runtime"
import { extractText, parseModelId } from "../src/model-invoker"
import type { ActionProposal, InvestigationContext, JEVDecision } from "../src/core/types"

const ROOT = path.resolve(import.meta.dir, "../fixtures/sample-repo")

function proposal(capability: string, target: Record<string, unknown> = {}): ActionProposal {
  return { id: "pr_1", capability, target, parameters: {}, reason: "test", expectedResult: "test" }
}

function context(overrides: Partial<InvestigationContext> = {}): InvestigationContext {
  return {
    sessionId: "inv_1",
    question: "Where is the API that creates an order?",
    intents: ["FIND_API"],
    entities: ["create_order"],
    hypothesis: null,
    evidence: [],
    visitedNodes: [],
    visitedEdges: [],
    depth: 0,
    budget: createBudget(),
    decisions: [],
    status: "INVESTIGATING",
    graph: { nodes: [], edges: [] },
    ...overrides,
  }
}

function input(overrides: Partial<InvestigationContext> = {}) {
  return { proposal: proposal("EXACT_SEARCH", { query: "order" }), context: context(overrides), machineState: "JEV_DECISION", registry: new CapabilityRegistry() }
}

class FakeModel implements JevModel {
  readonly id = "fake/model"
  calls = 0
  constructor(private readonly output: JevModelOutput | null) {}
  async decide(): Promise<JevModelOutput | null> {
    this.calls++
    return this.output
  }
}

describe("decision model output parsing", () => {
  test("parses strict JSON", () => {
    const out = parseJevOutput('{"decision":"EXPLORE","capability":"FUZZY_SEARCH","reason":"exact search empty"}')
    expect(out?.decision).toBe("EXPLORE")
    expect(out?.capability).toBe("FUZZY_SEARCH")
  })

  test("parses fenced JSON with surrounding prose", () => {
    const out = parseJevOutput('Here is my decision:\n```json\n{"decision":"STOP","reason":"done"}\n```\n')
    expect(out?.decision).toBe("STOP")
  })

  test("rejects invalid output", () => {
    expect(parseJevOutput("not json")).toBeNull()
    expect(parseJevOutput('{"decision":"MAYBE"}')).toBeNull()
  })

  test("builds a compact request", () => {
    const request = buildJevRequest(input() as never)
    expect(request.question).toContain("API")
    expect(request.budget.remaining).toBe(20)
    expect(request.capabilities.length).toBeGreaterThan(10)
    expect(request.maxDepth).toBe(4)
  })
})

describe("JEV engine", () => {
  test("uses the decision model when available", async () => {
    const model = new FakeModel({ decision: "EXPLORE", capability: "FUZZY_SEARCH", reason: "exact search returned nothing", expectedInformationGain: 0.8 })
    const engine = new JevEngine({ registry: new CapabilityRegistry(), model })
    const decision = await engine.decide(input() as never)
    expect(decision.source).toBe("model")
    expect(decision.decision).toBe("EXPLORE")
    expect(decision.capability).toBe("FUZZY_SEARCH")
    expect(decision.verdict).toBe("MODIFY")
    expect(model.calls).toBe(1)
  })

  test("overrides a model decision that selects an unknown capability", async () => {
    const model = new FakeModel({ decision: "EXPLORE", capability: "NOT_A_CAPABILITY", reason: "bad" })
    const engine = new JevEngine({ registry: new CapabilityRegistry(), model })
    const decision = await engine.decide(input() as never)
    expect(decision.source).toBe("model-overridden")
    expect(decision.capability).toBe("EXACT_SEARCH")
  })

  test("falls back to the deterministic policy when the model is unavailable", async () => {
    const model = new FakeModel(null)
    const engine = new JevEngine({ registry: new CapabilityRegistry(), model })
    const decision = await engine.decide(input() as never)
    expect(decision.source).toBe("heuristic")
    expect(decision.verdict).toBe("ALLOW")
  })

  test("hard constraints run before the model call", async () => {
    const model = new FakeModel({ decision: "EXPLORE", capability: "FUZZY_SEARCH", reason: "go" })
    const engine = new JevEngine({ registry: new CapabilityRegistry(), model })
    const budget = createBudget()
    budget.actions = budget.maxActions
    const decision = await engine.decide(input({ budget }) as never)
    expect(decision.decision).toBe("STOP")
    expect(model.calls).toBe(0)
  })

  test("a model ANSWER without evidence is overridden", async () => {
    const model = new FakeModel({ decision: "ANSWER", reason: "done" })
    const engine = new JevEngine({ registry: new CapabilityRegistry(), model })
    const decision = await engine.decide(input() as never)
    expect(decision.source).toBe("model-overridden")
  })

  test("the default decision model id is the documented default", () => {
    expect(DEFAULT_JEV_MODEL).toBe("opencode/jev-1.13-free")
  })
})

describe("runtime decision model configuration", () => {
  test("uses a configured decision model and can change it", async () => {
    const events = new EventStore(null)
    const models = new Map<string, FakeModel>()
    const runtime = new ControlledRuntime(ROOT, {
      events,
      jevModelId: "fake/one",
      createJevModel: (id) => {
        const model = new FakeModel({ decision: "EXPLORE", capability: "FUZZY_SEARCH", reason: "model says fuzzy" })
        models.set(id, model)
        return model
      },
    })
    expect(runtime.getJevModel()).toBe("fake/one")
    const { session } = runtime.start({ question: "find create_order" })
    const step = await runtime.step(session.id, { capability: "EXACT_SEARCH", target: { query: "create_order" } })
    expect(step.executed).toBe(true)
    expect(runtime.get(session.id)?.decisions[0].source).toBe("model")

    runtime.configureJevModel("fake/two", session.id)
    expect(runtime.getJevModel()).toBe("fake/two")
    const types = runtime.events.all(session.id).map((event) => event.type)
    expect(types).toContain("JEV_MODEL_CHANGED")
  })

  test("SET_JEV_MODEL requires MODIFY mode and a provider/model id", () => {
    const runtime = new ControlledRuntime(ROOT, { events: new EventStore(null), jevModelId: "fake/one", createJevModel: () => new FakeModel({ decision: "STOP", reason: "x" }) })
    const { session } = runtime.start({ question: "q" })
    expect(runtime.control({ sessionId: session.id, command: "SET_JEV_MODEL", mode: "OBSERVE", payload: { model: "fake/two" } }).ok).toBe(false)
    expect(runtime.control({ sessionId: session.id, command: "SET_JEV_MODEL", mode: "MODIFY", payload: { model: "nope" } }).ok).toBe(false)
    expect(runtime.control({ sessionId: session.id, command: "SET_JEV_MODEL", mode: "MODIFY", payload: { model: "fake/two" } }).ok).toBe(true)
    expect(runtime.getJevModel()).toBe("fake/two")
  })
})

describe("model invoker helpers", () => {
  test("parses provider/model ids, including nested model ids", () => {
    expect(parseModelId("opencode/jev-1.13-free")).toEqual({ providerID: "opencode", modelID: "jev-1.13-free" })
    expect(parseModelId("openrouter/google/gemma-4-31b-it:free")).toEqual({ providerID: "openrouter", modelID: "google/gemma-4-31b-it:free" })
    expect(parseModelId("noprovider")).toEqual({ providerID: "opencode", modelID: "noprovider" })
  })

  test("extracts text parts", () => {
    expect(extractText([{ type: "step-start" }, { type: "text", text: "hi" }, { type: "text", text: "there" }])).toBe("hi\nthere")
  })
})
