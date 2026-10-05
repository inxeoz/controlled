import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { ControlledRuntime } from "./core/runtime"
import { CONTROLLED_AGENT_DESCRIPTION, CONTROLLED_AGENT_PROMPT, DECISION_VISUALIZE_DESCRIPTION, DECISION_VISUALIZE_TEMPLATE } from "./prompts"
import { createControlledTools } from "./tools/controlled"
import { VisualizerServer } from "./visualizer/server"

/**
 * The Controlled Mode server plugin.
 *
 * It registers the investigation tools, the `controlled` primary agent, the
 * `/decision-visualize` command and the local visualizer server. It is
 * read-only: it never registers an edit, write or shell tool.
 */
export const ControlledPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const runtime = new ControlledRuntime(input.directory)
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
    decision_visualize: "allow",
  } as never

  return {
    tool: tools,

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
