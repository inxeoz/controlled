import type { FileIndex } from "./lang"

export interface RouteDef {
  file: string
  line: number
  method: string
  path: string
  handler: string | null
  framework: string
}

export interface SchemaDef {
  file: string
  line: number
  name: string
  system: string
  fields: string[]
}

function nextDeclaration(lines: string[], from: number): string | null {
  for (let line = from; line < Math.min(lines.length, from + 12); line++) {
    const fn = lines[line].match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/)
    if (fn) return fn[1]
    const js = lines[line].match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/)
    if (js) return js[1]
    const method = lines[line].match(/^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\(/)
    if (method) return method[1]
    const assign = lines[line].match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/)
    if (assign) return assign[1]
  }
  return null
}

export function detectRoutes(index: FileIndex): RouteDef[] {
  const out: RouteDef[] = []
  const { lines, file, language } = index
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const fastapi = line.match(/@\s*(?:app|router|bp|blueprint|api)\s*\.\s*(get|post|put|patch|delete|head|options)\s*\(\s*["']([^"']+)["']/i)
    if (fastapi) {
      out.push({ file, line: i + 1, method: fastapi[1].toUpperCase(), path: fastapi[2], handler: nextDeclaration(lines, i + 1), framework: "fastapi" })
      continue
    }
    const flaskRoute = line.match(/@\s*(?:app|bp|blueprint)\s*\.\s*route\s*\(\s*["']([^"']+)["'](?:[^)]*methods\s*=\s*\[([^\]]*)\])?/i)
    if (flaskRoute) {
      const methods = flaskRoute[2] ? flaskRoute[2].replace(/["'\s]/g, "").toUpperCase() : "GET"
      for (const method of methods.split(",").filter(Boolean)) {
        out.push({ file, line: i + 1, method, path: flaskRoute[1], handler: nextDeclaration(lines, i + 1), framework: "flask" })
      }
      continue
    }
    const nest = line.match(/@\s*(Get|Post|Put|Patch|Delete|All|Head|Options)\s*\(\s*["']?([^"')]*)["']?/i)
    if (nest && language === "typescript") {
      out.push({ file, line: i + 1, method: nest[1].toUpperCase() === "ALL" ? "ALL" : nest[1].toUpperCase(), path: nest[2] || "/", handler: nextDeclaration(lines, i + 1), framework: "nestjs" })
      continue
    }
    const spring = line.match(/@\s*(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?["']([^"']+)["']/i)
    if (spring) {
      const method = spring[1].replace("Mapping", "").toUpperCase() || "REQUEST"
      out.push({ file, line: i + 1, method, path: spring[2], handler: nextDeclaration(lines, i + 1), framework: "spring" })
      continue
    }
    const express = line.match(/\b(?:app|router|server|route)\s*\.\s*(get|post|put|patch|delete|all|use)\s*\(\s*["'](\/[^"']*)["']/i)
    if (express && language !== "python") {
      out.push({ file, line: i + 1, method: express[1].toUpperCase(), path: express[2], handler: nextDeclaration(lines, i + 1), framework: "express" })
      continue
    }
    const django = line.match(/\b(?:path|re_path|url)\s*\(\s*r?["']([^"']+)["']\s*,\s*([\w.]+)/)
    if (django && language === "python") {
      out.push({ file, line: i + 1, method: "ANY", path: django[1], handler: django[2], framework: "django" })
      continue
    }
    const frappe = line.match(/@\s*(?:frappe|_)\s*\.\s*(?:whitelist|route)\s*\(/)
    if (frappe) {
      out.push({ file, line: i + 1, method: "ANY", path: file.replace(/\.[^.]+$/, "").split(/[\\/]/).join("."), handler: nextDeclaration(lines, i + 1), framework: "frappe" })
      continue
    }
  }
  return out
}

function tsFields(lines: string[], startLine: number, endLine: number): string[] {
  const fields: string[] = []
  for (let line = startLine + 1; line <= endLine && line < lines.length; line++) {
    const match = lines[line].match(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[:?]/)
    if (match) fields.push(match[1])
  }
  return fields
}

export function detectSchemas(index: FileIndex): SchemaDef[] {
  const out: SchemaDef[] = []
  const { lines, file, language } = index
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (language === "python") {
      const pydantic = line.match(/^(\s*)class\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/)
      if (pydantic && /BaseModel|BaseSettings|Schema/.test(pydantic[3])) {
        const indent = pydantic[1].length
        const fields: string[] = []
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j].trim()) continue
          const current = lines[j].match(/^\s*/)?.[0].length ?? 0
          if (current <= indent) break
          const field = lines[j].match(/^\s*([A-Za-z_]\w*)\s*:/)
          if (field && !/^(class|def)$/.test(field[1])) fields.push(field[1])
        }
        out.push({ file, line: i + 1, name: pydantic[2], system: "pydantic", fields })
        continue
      }
      const dataclass = i > 0 && /@dataclass/.test(lines[i - 1])
      const cls = line.match(/^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:/)
      if (dataclass && cls) {
        const indent = cls[1].length
        const fields: string[] = []
        for (let j = i + 1; j < lines.length; j++) {
          if (!lines[j].trim()) continue
          const current = lines[j].match(/^\s*/)?.[0].length ?? 0
          if (current <= indent) break
          const field = lines[j].match(/^\s*([A-Za-z_]\w*)\s*:/)
          if (field) fields.push(field[1])
        }
        out.push({ file, line: i + 1, name: cls[2], system: "dataclass", fields })
        continue
      }
      continue
    }
    if (language === "typescript" || language === "javascript") {
      const iface = line.match(/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/)
      if (iface) {
        let end = i
        let depth = 0
        for (; end < lines.length; end++) {
          for (const ch of lines[end]) {
            if (ch === "{") depth++
            else if (ch === "}") depth--
          }
          if (depth <= 0 && end > i) break
        }
        out.push({ file, line: i + 1, name: iface[1], system: "typescript-interface", fields: tsFields(lines, i, end) })
        continue
      }
      const alias = line.match(/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=\s*\{/)
      if (alias) {
        let end = i
        let depth = 0
        for (; end < lines.length; end++) {
          for (const ch of lines[end]) {
            if (ch === "{") depth++
            else if (ch === "}") depth--
          }
          if (depth <= 0 && end > i) break
        }
        out.push({ file, line: i + 1, name: alias[1], system: "typescript-type", fields: tsFields(lines, i, end) })
        continue
      }
      const zod = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*z\s*\.\s*(?:object|strictObject)\s*\(\s*\{/)
      if (zod) {
        let end = i
        let depth = 0
        for (; end < lines.length; end++) {
          for (const ch of lines[end]) {
            if (ch === "{") depth++
            else if (ch === "}") depth--
          }
          if (depth <= 0 && end > i) break
        }
        const fields: string[] = []
        for (let j = i; j <= end && j < lines.length; j++) {
          const field = lines[j].match(/^\s*([A-Za-z_$][\w$]*)\s*:/)
          if (field) fields.push(field[1])
        }
        out.push({ file, line: i + 1, name: zod[1], system: "zod", fields })
        continue
      }
    }
  }
  return out
}

export interface JsonSchemaHit {
  file: string
  name: string
  system: string
  fields: string[]
}

/** Detect schema systems described in JSON/YAML files (OpenAPI, JSON Schema, Frappe DocType). */
export function detectJsonSchema(file: string, text: string): JsonSchemaHit | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return null
  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!data || typeof data !== "object") return null
  const record = data as Record<string, unknown>
  if (typeof record.doctype === "string" && record.doctype.toLowerCase() === "doctype") {
    const fields = Array.isArray(record.fields)
      ? (record.fields as Array<Record<string, unknown>>).map((field) => String(field.fieldname ?? "")).filter(Boolean)
      : []
    return { file, name: String(record.name ?? file), system: "frappe-doctype", fields }
  }
  if (typeof record.openapi === "string" || typeof record.swagger === "string") {
    const fields = Object.keys((record.components as Record<string, unknown>)?.schemas as Record<string, unknown> ?? {})
    return { file, name: String((record.info as Record<string, unknown>)?.title ?? file), system: "openapi", fields }
  }
  if (record.type === "object" && record.properties && typeof record.properties === "object") {
    return { file, name: file, system: "json-schema", fields: Object.keys(record.properties as Record<string, unknown>) }
  }
  return null
}
