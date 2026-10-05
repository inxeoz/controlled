const SECRET_KEY = /(api[-_]?key|secret|password|passwd|token|authorization|auth|cookie|credential|private[-_]?key|access[-_]?key|session[-_]?key)/i
const SECRET_VALUE = /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|Bearer\s+[A-Za-z0-9._-]{8,})/

/**
 * The event store applies secret redaction (spec section 75) so the visualizer
 * never exposes API keys, tokens, credentials or full secret configuration.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[depth-limit]"
  if (typeof value === "string") return SECRET_VALUE.test(value) ? "[redacted]" : value
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1)
  }
  return out
}
