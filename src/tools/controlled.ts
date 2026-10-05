import { tool } from "@opencode-ai/plugin"
import { normalizeModelId } from "../core/jev-model"
import type { ControlledRuntime, StepResult } from "../core/runtime"
import type { VisualizerServer } from "../visualizer/server"
import type { CapabilityId, InvestigationIntent, InvestigationTarget } from "../core/types"

const INTENTS: InvestigationIntent[] = [
  "FIND_API",
  "FIND_FUNCTION",
  "FIND_DEFINITION",
  "FIND_REFERENCE",
  "FIND_RELATED_API",
  "TRACE_FLOW",
  "UNDERSTAND_FUNCTION",
  "IMPACT_ANALYSIS",
  "SAFE_REMOVAL",
  "DEPENDENCY_ANALYSIS",
  "CYCLE_DETECTION",
  "SCHEMA_ANALYSIS",
  "ROUTE_ANALYSIS",
  "GENERAL_EXPLORATION",
]

export interface ToolDeps {
  runtime: ControlledRuntime
  visualizer: VisualizerServer
}

export function createControlledTools(deps: ToolDeps) {
  const { runtime, visualizer } = deps
  const sessionMap = new Map<string, string>()

  const requireSession = (opencodeSessionID: string): string | null => sessionMap.get(opencodeSessionID) ?? null

  return {
    controlled_start: tool({
      description:
        "Start a Controlled Mode investigation for a codebase question. Returns a session id, the classified intents and entities, the available investigation capabilities, and the budget. Call this once per question, then use controlled_step to propose actions and controlled_finish to answer.",
      args: {
        question: tool.schema.string().describe("The user question to investigate."),
        intents: tool.schema.array(tool.schema.enum(INTENTS as [InvestigationIntent, ...InvestigationIntent[]])).optional().describe("Optional investigation intents you identified."),
        entities: tool.schema.array(tool.schema.string()).optional().describe("Optional important entities (symbols, fields, routes)."),
      },
      async execute(args, context) {
        const existing = requireSession(context.sessionID)
        const { session, state } = runtime.start({ question: args.question, intents: args.intents, entities: args.entities })
        sessionMap.set(context.sessionID, session.id)
        const capabilities = runtime.registry.snapshot()
        return [
          `CONTROLLED SESSION ${session.id}`,
          `state: ${state}`,
          existing ? `note: replaced previous session ${existing} for this OpenCode session` : "",
          `question: ${session.question}`,
          `intents: ${session.intent.join(", ")}`,
          `entities: ${session.entities.join(", ") || "(none)"}`,
          `budget: ${session.budget.maxActions} actions, depth ${session.budget.maxGraphDepth}, ${session.budget.maxFuzzySearches} fuzzy, ${session.budget.maxLLMIterations} LLM iterations`,
          "",
          "Available capabilities:",
          ...capabilities.map((capability) => `- ${capability.id} (${capability.category}, cost ${capability.cost}, gain ${capability.expectedInformationGain}): ${capability.description}`),
          "",
          "Next: call controlled_step with one capability and a target. JEV will decide, XState will enforce, and the tool will return evidence.",
        ]
          .filter(Boolean)
          .join("\n")
      },
    }),

    controlled_step: tool({
      description:
        "Propose the next investigation action. JEV decides whether the action is justified and under which constraints; XState enforces the execution state; the approved capability collects evidence. Returns the decision, the collected evidence, the graph and budget state, and whether you must answer now.",
      args: {
        capability: tool.schema.string().describe("The capability id to propose, for example EXACT_SEARCH, FIND_CALLERS, AST_SCHEMA, CYCLE_DETECTION."),
        target: tool.schema
          .object({
            query: tool.schema.string().optional(),
            symbol: tool.schema.string().optional(),
            file: tool.schema.string().optional(),
            route: tool.schema.string().optional(),
            field: tool.schema.string().optional(),
          })
          .optional()
          .describe("What the action targets."),
        parameters: tool.schema.record(tool.schema.string(), tool.schema.unknown()).optional().describe("Extra parameters, for example { method: 'POST' } or { param: 'customer_id' }."),
        reason: tool.schema.string().optional().describe("Why this action is useful now."),
        expectedResult: tool.schema.string().optional().describe("What you expect to learn."),
      },
      async execute(args, context) {
        const sessionId = requireSession(context.sessionID)
        if (!sessionId) return "No Controlled session exists for this OpenCode session. Call controlled_start first."
        const result = await runtime.step(sessionId, {
          capability: args.capability as CapabilityId,
          target: (args.target ?? null) as InvestigationTarget | null,
          parameters: (args.parameters ?? {}) as Record<string, unknown>,
          reason: args.reason,
          expectedResult: args.expectedResult,
        })
        return formatStep(result)
      },
    }),

    controlled_finish: tool({
      description:
        "Produce the final answer for the current Controlled session. JEV/XState must have moved the investigation to the ANSWERING state (the tool result from controlled_step says mustAnswer, or JEV decided ANSWER/STOP). The answer must distinguish verified evidence from assumptions and state the investigation scope and unverified areas.",
      args: {
        answer: tool.schema.string().describe("The final answer, grounded in the collected evidence."),
        confidence: tool.schema.number().optional().describe("Overall confidence between 0 and 1."),
        unverified: tool.schema.array(tool.schema.string()).optional().describe("Areas that were not verified."),
        recommendation: tool.schema.string().optional().describe("Optional recommendation."),
      },
      async execute(args, context) {
        const sessionId = requireSession(context.sessionID)
        if (!sessionId) return "No Controlled session exists for this OpenCode session. Call controlled_start first."
        const result = runtime.finish(sessionId, {
          answer: args.answer,
          confidence: args.confidence,
          unverified: args.unverified,
          recommendation: args.recommendation,
        })
        if ("error" in result) return `Cannot finish: ${result.error}`
        return [
          "FINAL ANSWER (session " + sessionId + ")",
          `termination: ${result.termination}`,
          `state: ${result.state}`,
          `confidence: ${result.answer.confidence.toFixed(2)}`,
          "",
          result.answer.answer,
          "",
          `files: ${result.answer.files.join(", ") || "(none)"}`,
          `symbols: ${result.answer.symbols.join(", ") || "(none)"}`,
          `capabilities used: ${result.answer.scope.join(", ")}`,
          `unverified: ${result.answer.unverified.join(", ") || "(none)"}`,
          result.answer.recommendation ? `recommendation: ${result.answer.recommendation}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      },
    }),

    controlled_status: tool({
      description: "Return the current Controlled session state, budget, evidence count, graph size and the last JEV decision.",
      args: {},
      async execute(_args, context) {
        const sessionId = requireSession(context.sessionID)
        if (!sessionId) return "No Controlled session exists for this OpenCode session."
        const snapshot = runtime.snapshot(sessionId)
        if (!snapshot) return `Unknown session ${sessionId}.`
        const session = snapshot.session as { status: string; currentState: string; evidence: unknown[]; budget: Record<string, number>; termination: string | null; graph: { nodes: unknown[]; edges: unknown[] } }
        return [
          `session: ${sessionId}`,
          `state: ${session.currentState}`,
          `status: ${session.status}`,
          `evidence: ${session.evidence.length}`,
          `graph: ${session.graph.nodes.length} nodes / ${session.graph.edges.length} edges`,
          `budget: ${session.budget.actions}/${session.budget.maxActions} actions, ${session.budget.llmIterations}/${session.budget.maxLLMIterations} LLM iterations`,
          `termination: ${session.termination ?? "-"}`,
        ].join("\n")
      },
    }),

    controlled_config: tool({
      description:
        "Read or change the Controlled Mode configuration. With no arguments it reports the current decision model, budget and JEV policy. Pass jevModel to change the decision model used by JEV (for example opencode/jev-1.13-free, or 'heuristic' to use the deterministic policy).",
      args: {
        jevModel: tool.schema.string().optional().describe("Decision model as provider/model, or 'heuristic' to disable the model."),
      },
      async execute(args, context) {
        const sessionId = requireSession(context.sessionID)
        if (args.jevModel !== undefined) {
          runtime.configureJevModel(normalizeModelId(args.jevModel), sessionId ?? undefined)
        }
        const snapshot = sessionId ? runtime.snapshot(sessionId) : null
        const policy = snapshot?.policy as Record<string, number> | undefined
        const note = runtime.getJevModelNote()
        return [
          `decision model: ${runtime.getJevModel()}`,
          note ? `note: ${note}` : "",
          `visualizer: ${visualizer.running ? visualizer.url : "not running"}`,
          policy ? `policy: ${JSON.stringify(policy)}` : "policy: (no session)",
          sessionId ? `session: ${sessionId}` : "session: none",
        ].filter(Boolean).join("\n")
      },
    }),

    decision_visualize: tool({
      description:
        "Start the local Decision Visualizer web interface for Controlled Mode and return its URL. The visualizer shows the XState graph, current state, JEV decisions, evidence, the execution timeline, the budget and live controls (pause, resume, stop, step, speed, replay, live XState modification).",
      args: {},
      async execute(_args, context) {
        const url = visualizer.start()
        const sessionId = requireSession(context.sessionID)
        const target = sessionId ? `${url}&session=${sessionId}` : url
        return [
          "Decision Visualizer is running (localhost only).",
          `URL: ${target}`,
          sessionId ? `session: ${sessionId}` : "note: no active Controlled session; start one with controlled_start.",
          "Control modes: OBSERVE (inspect), CONTROL (pause/resume/stop/step/speed), MODIFY (live XState changes).",
        ].join("\n")
      },
    }),
  }
}

function formatStep(result: StepResult): string {
  const lines = [
    `state: ${result.state}`,
    `status: ${result.status}`,
    `JEV: ${result.decision} (${result.verdict})${result.capability ? " -> " + result.capability : ""}`,
    `executed: ${result.executed}`,
    `message: ${result.message}`,
  ]
  if (result.error) lines.push(`error: ${result.error}`)
  if (result.newEvidence.length) {
    lines.push(`new evidence: ${result.newEvidence.length}`)
    for (const item of result.newEvidence.slice(0, 12)) {
      lines.push(`  - ${item.type} ${item.file}${item.lineStart ? ":" + item.lineStart : ""} ${item.symbol ?? ""} (conf ${item.confidence})`)
    }
    if (result.newEvidence.length > 12) lines.push(`  ... ${result.newEvidence.length - 12} more`)
  } else if (result.executed) {
    lines.push("new evidence: 0")
  }
  lines.push(`evidence total: ${result.evidenceCount}`)
  lines.push(`graph: ${result.graphSummary.nodes} nodes / ${result.graphSummary.edges} edges`)
  lines.push(`budget: ${result.budget.actions}/${result.budget.maxActions} actions, ${result.budget.llmIterations}/${result.budget.maxLLMIterations} LLM iterations`)
  if (result.gaps.length) {
    lines.push(`missing evidence: ${result.gaps.map((gap) => `${gap.description} (use ${gap.capability})`).join("; ")}`)
  }
  if (result.mustAskUser) lines.push(`ASK_USER: ${result.question ?? "The investigation needs user input."}`)
  if (result.mustAnswer) lines.push("NEXT: call controlled_finish with the final answer.")
  else if (!result.mustAskUser) lines.push("NEXT: propose another controlled_step, or call controlled_finish if the evidence is sufficient.")
  return lines.join("\n")
}
