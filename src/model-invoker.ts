import type { ModelInvoker } from "./core/jev-model"

export interface ModelInvokerOptions {
  /** The hidden agent whose system prompt is the JEV instruction. */
  agent: string
  timeoutMs?: number
  /** Reports a model call failure without failing the investigation. */
  onError?: (error: Error) => void
}

interface SessionClient {
  session: {
    create(input: { body?: { title?: string } }): Promise<{ data?: { id: string }; error?: unknown }>
    prompt(input: {
      path: { id: string }
      body: { agent?: string; model?: { providerID: string; modelID: string }; parts: Array<{ type: "text"; text: string }> }
      signal?: AbortSignal
    }): Promise<{ data?: { parts?: Array<{ type: string; text?: string }> }; error?: unknown }>
    delete(input: { path: { id: string } }): Promise<unknown>
  }
}

export function parseModelId(model: string): { providerID: string; modelID: string } {
  const index = model.indexOf("/")
  if (index <= 0) return { providerID: "opencode", modelID: model }
  return { providerID: model.slice(0, index), modelID: model.slice(index + 1) }
}

export function extractText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n")
}

/**
 * Runs a one-shot prompt on an OpenCode model and returns its text.
 *
 * A dedicated hidden agent is used so the request carries the JEV instruction
 * instead of a full coding agent system prompt. The temporary session is always
 * deleted, and the call is bounded by a timeout so a slow model cannot stall the
 * investigation.
 */
export function createModelInvoker(client: SessionClient, options: ModelInvokerOptions): ModelInvoker {
  return async ({ model, user, timeoutMs }) => {
    const created = await client.session.create({ body: { title: "[controlled] JEV decision" } })
    const id = created.data?.id
    if (!id) throw new Error("could not create the JEV session")
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs || options.timeoutMs || 15000)
    try {
      const result = await client.session.prompt({
        path: { id },
        body: { agent: options.agent, model: parseModelId(model), parts: [{ type: "text", text: user }] },
        signal: controller.signal,
      })
      if (result.error) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error))
      return extractText(result.data?.parts ?? [])
    } catch (error) {
      options.onError?.(error as Error)
      throw error
    } finally {
      clearTimeout(timer)
      await client.session.delete({ path: { id } }).catch(() => undefined)
    }
  }
}
