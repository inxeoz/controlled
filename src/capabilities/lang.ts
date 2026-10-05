/**
 * Lightweight structural parser.
 *
 * The extension must not depend only on source text (spec section 26), so this
 * module produces a structural index: declarations, parameters, imports and
 * call sites, with line ranges. It is intentionally dependency-free and
 * language-aware rather than a full compiler front end. Where a project has a
 * real compiler (for example `tsc`), findings are still validated against the
 * source location before they become evidence.
 */

export interface SymbolDef {
  id: string
  name: string
  kind: "function" | "method" | "class" | "interface" | "type" | "variable" | "schema"
  file: string
  line: number
  endLine: number
  params: string[]
  signature: string
  exported: boolean
  container: string | null
}

export interface CallSite {
  file: string
  line: number
  callee: string
  callerId: string | null
}

export interface ImportDef {
  file: string
  line: number
  source: string
  names: string[]
}

export interface FileIndex {
  file: string
  language: string
  lines: string[]
  symbols: SymbolDef[]
  calls: CallSite[]
  imports: ImportDef[]
}

const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "typeof",
  "instanceof",
  "new",
  "delete",
  "void",
  "in",
  "of",
  "do",
  "else",
  "with",
  "await",
  "yield",
  "throw",
  "case",
  "default",
  "class",
  "extends",
  "super",
  "import",
  "export",
  "from",
  "as",
  "satisfies",
  "keyof",
  "readonly",
  "interface",
  "type",
  "enum",
  "namespace",
  "declare",
  "asserts",
  "is",
  "print",
  "len",
  "range",
  "str",
  "int",
  "float",
  "list",
  "dict",
  "set",
  "tuple",
  "None",
  "True",
  "False",
  "def",
  "lambda",
  "not",
  "and",
  "or",
  "elif",
  "try",
  "except",
  "finally",
  "raise",
  "pass",
  "global",
  "nonlocal",
  "del",
  "match",
])

/** Replace comment and string contents with spaces, preserving offsets and line breaks. */
export function stripNonCode(text: string, language: string): string {
  const chars = text.split("")
  let i = 0
  const n = chars.length
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) {
      if (chars[k] !== "\n") chars[k] = " "
    }
  }
  while (i < n) {
    const c = chars[i]
    const next = chars[i + 1]
    if (language === "python") {
      if (c === "#") {
        const end = text.indexOf("\n", i)
        blank(i, end === -1 ? n : end)
        i = end === -1 ? n : end
        continue
      }
      if (c === '"' || c === "'") {
        const triple = text.startsWith(c.repeat(3), i)
        if (triple) {
          const end = text.indexOf(c.repeat(3), i + 3)
          blank(i, end === -1 ? n : end + 3)
          i = end === -1 ? n : end + 3
          continue
        }
        let j = i + 1
        while (j < n && chars[j] !== c && chars[j] !== "\n") {
          if (chars[j] === "\\") j++
          j++
        }
        blank(i + 1, j)
        i = j + 1
        continue
      }
      i++
      continue
    }
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i)
      blank(i, end === -1 ? n : end)
      i = end === -1 ? n : end
      continue
    }
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2)
      blank(i, end === -1 ? n : end + 2)
      i = end === -1 ? n : end + 2
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1
      while (j < n && chars[j] !== c) {
        if (chars[j] === "\\") j++
        j++
      }
      blank(i + 1, j)
      i = j + 1
      continue
    }
    i++
  }
  return chars.join("")
}

function splitParams(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/[:=].*$/, "").replace(/^\.\.\./, "").trim())
    .filter(Boolean)
}

function lineStarts(lines: string[]): number[] {
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  return starts
}

function offsetToLine(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (starts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low
}

function braceBlockEnd(lines: string[], startLine: number): number {
  let depth = 0
  let started = false
  for (let line = startLine; line < lines.length; line++) {
    for (const ch of lines[line]) {
      if (ch === "{") {
        depth++
        started = true
      } else if (ch === "}") {
        depth--
      }
    }
    if (started && depth <= 0) return line
  }
  return lines.length - 1
}

function indentBlockEnd(lines: string[], startLine: number): number {
  const indent = lines[startLine].match(/^\s*/)?.[0].length ?? 0
  for (let line = startLine + 1; line < lines.length; line++) {
    if (!lines[line].trim()) continue
    const current = lines[line].match(/^\s*/)?.[0].length ?? 0
    if (current <= indent) return line - 1
  }
  return lines.length - 1
}

export function parseFile(file: string, text: string, language: string): FileIndex {
  const lines = text.split("\n")
  const stripped = stripNonCode(text, language).split("\n")
  const symbols: SymbolDef[] = []
  const imports: ImportDef[] = []
  const calls: CallSite[] = []
  const starts = lineStarts(lines)

  const addSymbol = (input: Omit<SymbolDef, "id" | "file">) => {
    symbols.push({ ...input, file, id: `${file}#${input.name}@${input.line + 1}` })
  }

  if (language === "typescript" || language === "javascript") {
    const patterns: Array<{ re: RegExp; kind: SymbolDef["kind"] }> = [
      { re: /^\s*(export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/, kind: "function" },
      { re: /^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
      { re: /^\s*(export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
      { re: /^\s*(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, kind: "type" },
      { re: /^\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/, kind: "function" },
    ]
    for (let line = 0; line < stripped.length; line++) {
      const content = stripped[line]
      for (const { re, kind } of patterns) {
        const match = content.match(re)
        if (!match) continue
        const name = match[2]
        if (!name || KEYWORDS.has(name)) continue
        const params = kind === "function" ? splitParams(match[3] ?? "") : []
        const endLine = kind === "class" || kind === "interface" ? braceBlockEnd(stripped, line) : braceBlockEnd(stripped, line)
        addSymbol({
          name,
          kind,
          line: line + 1,
          endLine: endLine + 1,
          params,
          signature: lines[line].trim(),
          exported: /export\s/.test(content),
          container: null,
        })
        break
      }
    }
    // Class methods.
    for (const cls of symbols.filter((item) => item.kind === "class")) {
      for (let line = cls.line; line < cls.endLine - 1; line++) {
        const content = stripped[line]
        if (!content || !content.trim()) continue
        const match = content.match(
          /^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|override\s+|abstract\s+|\*\s*)*(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::[^{;=]+)?\{/,
        )
        if (!match) continue
        const name = match[1]
        if (!name || KEYWORDS.has(name) || name === "constructor" && false) continue
        addSymbol({
          name,
          kind: "method",
          line: line + 1,
          endLine: braceBlockEnd(stripped, line) + 1,
          params: splitParams(match[2] ?? ""),
          signature: lines[line].trim(),
          exported: false,
          container: cls.name,
        })
      }
    }
    // Imports.
    const importRe = /^\s*import\s+(?:type\s+)?(?:([\s\S]*?)\s+from\s+)?["']([^"']+)["']/gm
    let m: RegExpExecArray | null
    while ((m = importRe.exec(text))) {
      const line = offsetToLine(starts, m.index)
      const names = (m[1] ?? "")
        .replace(/[{}*]/g, " ")
        .split(",")
        .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean)
      imports.push({ file, line: line + 1, source: m[2], names })
    }
  } else if (language === "python") {
    for (let line = 0; line < stripped.length; line++) {
      const content = stripped[line]
      const fn = content.match(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/)
      if (fn) {
        const indent = fn[1].length
        let container: string | null = null
        for (let back = line - 1; back >= 0; back--) {
          const cls = stripped[back].match(/^(\s*)class\s+([A-Za-z_]\w*)/)
          if (cls && cls[1].length < indent) {
            container = cls[2]
            break
          }
          if (stripped[back].trim() && (stripped[back].match(/^\s*/)?.[0].length ?? 0) === 0) break
        }
        addSymbol({
          name: fn[2],
          kind: container ? "method" : "function",
          line: line + 1,
          endLine: indentBlockEnd(stripped, line) + 1,
          params: splitParams(fn[3] ?? ""),
          signature: lines[line].trim(),
          exported: true,
          container,
        })
        continue
      }
      const cls = content.match(/^(\s*)class\s+([A-Za-z_]\w*)/)
      if (cls) {
        addSymbol({
          name: cls[2],
          kind: "class",
          line: line + 1,
          endLine: indentBlockEnd(stripped, line) + 1,
          params: [],
          signature: lines[line].trim(),
          exported: true,
          container: null,
        })
      }
    }
    const fromRe = /^\s*from\s+([\w.]+)\s+import\s+(.+)$/gm
    const plainRe = /^\s*import\s+([\w.,\s]+)$/gm
    let m: RegExpExecArray | null
    const joined = text
    while ((m = fromRe.exec(joined))) {
      const line = offsetToLine(starts, m.index)
      imports.push({
        file,
        line: line + 1,
        source: m[1],
        names: m[2].replace(/[()]/g, "").split(",").map((part) => part.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean),
      })
    }
    while ((m = plainRe.exec(joined))) {
      const line = offsetToLine(starts, m.index)
      imports.push({ file, line: line + 1, source: m[1].trim(), names: [] })
    }
  }

  // Call sites (all structured languages).
  if (language !== "text") {
    const callRe = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g
    let m: RegExpExecArray | null
    while ((m = callRe.exec(stripped.join("\n")))) {
      const full = m[1]
      const last = full.split(".").pop() as string
      if (KEYWORDS.has(last)) continue
      if (last === "constructor") continue
      const line = offsetToLine(starts, m.index)
      const caller = symbols
        .filter((symbol) => symbol.line - 1 <= line && symbol.endLine - 1 >= line && (symbol.kind === "function" || symbol.kind === "method"))
        .sort((a, b) => b.line - a.line)[0]
      // A declaration line is not a call site.
      if (caller && caller.line - 1 === line && caller.name === last) continue
      calls.push({ file, line: line + 1, callee: last, callerId: caller?.id ?? null })
    }
  }

  return { file, language, lines, symbols, calls, imports }
}
