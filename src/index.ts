/**
 * opencode-controlled-mode
 *
 * Controlled Mode for OpenCode (CM-OPENCODE-SPEC-001).
 * The LLM proposes, JEV decides, XState enforces, capabilities collect
 * evidence, and the LLM synthesizes a verified answer.
 */
import { ControlledPlugin } from "./plugin"

export default {
  id: "opencode-controlled-mode",
  server: ControlledPlugin,
}

export { ControlledPlugin } from "./plugin"
export { ControlledRuntime, classify } from "./core/runtime"
export { Controller, baseMachine } from "./core/machine"
export { decide, DEFAULT_POLICY } from "./core/jev"
export { CapabilityRegistry, BASE_CAPABILITIES } from "./core/registry"
export { EventStore, EVENT } from "./core/events"
export { CodeIndex, getIndex } from "./capabilities/index"
export { VisualizerServer } from "./visualizer/server"
