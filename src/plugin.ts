import type { Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import { DEFAULT_JEV_MODEL, DEFAULT_JEV_TIMEOUT_MS, OpenCodeJevModel, normalizeModelId, type JevModel } from "./core/jev-model"
import { ControlledRuntime } from "./core/runtime"
import { createModelAvailability, createModelInvoker, type ProvidersClient } from "./model-invoker"
import {
  CONTROLLED_AGENT_DESCRIPTION,
  CONTROLLED_AGENT_PROMPT,
  DECISION_VISUALIZE_DESCRIPTION,
  DECISION_VISUALIZE_TEMPLATE,
  JEV_AGENT_DESCRIPTION,
  JEV_AGENT_ID,
  JEV_MODEL_SYSTEM,
} from "./prompts"
import { createControlledTools } from "./tools/controlled"
import { VisualizerServer } from "./visualizer/server"

/**
 * Resolve the explicit decision model: plugin option, then environment.
 * Returns null when nothing is configured, which means "inherit the model the
 * main agent is already using". Returns "heuristic" when the model is disabled.
 */
export function resolveJevModel(options?: PluginOptions): string | null {
  const fromOptions = options?.jevModel
  if (typeof fromOptions === "string" && fromOptions.trim()) return normalizeModelId(fromOptions) ?? "heuristic"
  const fromEnv = process.env.CONTROLLED_JEV_MODEL
  if (fromEnv && fromEnv.trim()) return normalizeModelId(fromEnv) ?? "heuristic"
  return null
}

/**
 * The Controlled Mode server plugin.
 *
 * It registers the investigation tools, the `controlled` primary agent, the
 * hidden `controlled-jeve` decision agent, the `/decision-visualize` command
 * and the local visualizer server. It is read-only: it never registers an edit,
 * write or shell tool.
 */
export const ControlledPlugin: Plugin = async (input: PluginInput, options?: PluginOptions): Promise<Hooks> => {
  const jevModelId = resolveJevModel(options)
  const timeoutMs = Number(process.env.CONTROLLED_JEV_TIMEOUT_MS ?? DEFAULT_JEV_TIMEOUT_MS)
  const invoke = createModelInvoker(input.client, { agent: JEV_AGENT_ID, timeoutMs })
  const isAvailable = createModelAvailability(input.client as unknown as ProvidersClient)
  let noteUnavailable: ((note: string) => void) | null = null
  const createJevModel = (modelId: string): JevModel =>
    new OpenCodeJevModel({
      id: modelId,
      model: modelId,
      system: JEV_MODEL_SYSTEM,
      invoke,
      timeoutMs,
      available: async () => {
        const ok = await isAvailable(modelId)
        if (!ok) {
          noteUnavailable?.(
            `Decision model ${modelId} is not available in this instance; the deterministic policy is used. Set CONTROLLED_JEV_MODEL or the jevModel plugin option to an available model.`,
          )
        }
        return ok
      },
    })

  // The model the main agent is using for a session. OpenCode's free tier is
  // only usable from inside OpenCode, so the JEV call reuses that same model
  // through the plugin client instead of calling a provider directly.
  const sessionModels = new Map<string, string>()
  const runtime = new ControlledRuntime(input.directory, {
    jevModelId: resolveJevModel(options),
    fallbackModelId: DEFAULT_JEV_MODEL,
    createJevModel,
    resolveSessionModel: (sessionId) => sessionModels.get(sessionId) ?? null,
  })
  noteUnavailable = (note) => runtime.setJevModelNote(note)
  const visualizer = new VisualizerServer({ runtime, port: Number(process.env.CONTROLLED_VISUALIZER_PORT ?? 4599) })
  const tools = createControlledTools({ runtime, visualizer })

  const controlledTools: Record<string, boolean> = { "*": false }
  for (const name of Object.keys(tools)) controlledTools[name] = true

  // The runtime permission schema accepts arbitrary tool keys; the generated
  // SDK type is narrower, so the record is cast at this boundary.
  const controlledPermissions = {
    "*": "deny",
    edit: "deny",
    bash: "deny",
    task: "deny",
    webfetch: "deny",
    websearch: "deny",
    skill: "deny",
    controlled_start: "allow",
    controlled_step: "allow",
    controlled_finish: "allow",
    controlled_status: "allow",
    controlled_config: "allow",
    decision_visualize: "allow",
  } as never

  return {
    tool: tools,

    "chat.params": async (input) => {
      if (input.model?.providerID && input.model?.id) {
        sessionModels.set(input.sessionID, `${input.model.providerID}/${input.model.id}`)
      }
    },

    "chat.message": async (input) => {
      if (input.model?.providerID && input.model?.modelID) {
        sessionModels.set(input.sessionID, `${input.model.providerID}/${input.model.modelID}`)
      }
    },

    config: async (config) => {
      config.agent = config.agent ?? {}
      config.agent.controlled = {
        description: CONTROLLED_AGENT_DESCRIPTION,
        mode: "primary",
        prompt: CONTROLLED_AGENT_PROMPT,
        color: "#4f9cf9",
        // Read-only: only the controlled investigation tools are permitted.
        tools: controlledTools,
        permission: controlledPermissions,
      }
      // The decision agent has no tools and carries the JEV instruction.
      config.agent[JEV_AGENT_ID] = {
        description: JEV_AGENT_DESCRIPTION,
        mode: "subagent",
        hidden: true,
        prompt: JEV_MODEL_SYSTEM,
        tools: { "*": false } as never,
        permission: { "*": "deny" } as never,
      }
      config.command = config.command ?? {}
      config.command["decision-visualize"] = {
        description: DECISION_VISUALIZE_DESCRIPTION,
        agent: "controlled",
        template: DECISION_VISUALIZE_TEMPLATE,
      }
    },

    dispose: async () => {
      visualizer.stop()
    },
  }
}
