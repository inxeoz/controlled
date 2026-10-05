import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

export const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".idea",
  ".vscode",
  "target",
  "bin",
  "obj",
])

export const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rb",
  ".java",
  ".kt",
  ".rs",
  ".php",
  ".cs",
])

export const TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS,
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".md",
  ".txt",
  ".sql",
  ".graphql",
  ".gql",
  ".proto",
  ".sh",
  ".env",
  ".html",
  ".css",
  ".scss",
])

const MAX_FILE_BYTES = 512 * 1024

export interface WalkedFile {
  absolute: string
  relative: string
  ext: string
  size: number
}

export function isIgnored(relativePath: string, ignores: Set<string> = DEFAULT_IGNORES): boolean {
  const parts = relativePath.split(path.sep)
  return parts.some((part) => ignores.has(part))
}

export function walk(root: string, options: { ignores?: Set<string>; extensions?: Set<string>; limit?: number } = {}): WalkedFile[] {
  const ignores = options.ignores ?? DEFAULT_IGNORES
  const extensions = options.extensions ?? TEXT_EXTENSIONS
  const limit = options.limit ?? 20000
  const out: WalkedFile[] = []
  const stack: string[] = [root]
  while (stack.length && out.length < limit) {
    const dir = stack.pop() as string
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (ignores.has(entry)) continue
      const absolute = path.join(dir, entry)
      let stat
      try {
        stat = statSync(absolute)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        stack.push(absolute)
        continue
      }
      if (!stat.isFile()) continue
      const ext = path.extname(entry).toLowerCase()
      if (!extensions.has(ext)) continue
      if (stat.size > MAX_FILE_BYTES) continue
      out.push({ absolute, relative: path.relative(root, absolute), ext, size: stat.size })
    }
  }
  return out
}

export function readText(absolute: string): string {
  try {
    return readFileSync(absolute, "utf8")
  } catch {
    return ""
  }
}

export function languageOf(ext: string): string {
  switch (ext) {
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return "typescript"
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript"
    case ".py":
      return "python"
    case ".go":
      return "go"
    case ".rb":
      return "ruby"
    case ".java":
    case ".kt":
      return "jvm"
    case ".rs":
      return "rust"
    case ".php":
      return "php"
    case ".cs":
      return "csharp"
    default:
      return "text"
  }
}

export function normalizePath(value: string): string {
  return value.split(path.sep).join("/")
}

export type FileKind = "source" | "test" | "generated" | "fixture" | "docs" | "config" | "script"

const GENERATED_MARKERS = [
  "generated",
  "auto-generated",
  ".gen.",
  "gen_",
  "vendor",
  "dist/",
  "build/",
  "postman",
  "bruno",
  "hurl-api",
  "json-api",
  "openapi",
  "swagger",
]
const TEST_MARKERS = ["test_", "_test.", ".test.", ".spec.", "/tests/", "/test/", "__tests__"]
const FIXTURE_MARKERS = ["fixture", "test-data", "testdata", "mock", "sample"]
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"])
const CONFIG_EXTENSIONS = new Set([".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".env", ".lock"])

/**
 * Classify a path so search results can be ranked. Generated clients, fixtures
 * and scripts must not outrank real source.
 */
export function classifyFile(relative: string): FileKind {
  const value = normalizePath(relative).toLowerCase()
  const ext = path.extname(value)
  if (value.startsWith("scripts/") || value.includes("/scripts/")) return "script"
  if (GENERATED_MARKERS.some((marker) => value.includes(marker))) return "generated"
  if (TEST_MARKERS.some((marker) => value.includes(marker))) return "test"
  if (FIXTURE_MARKERS.some((marker) => value.includes(marker))) return "fixture"
  if (DOC_EXTENSIONS.has(ext)) return "docs"
  if (CONFIG_EXTENSIONS.has(ext)) return "config"
  return "source"
}

/** Higher is more relevant. Source ranks above scripts, tests, fixtures and generated output. */
export const FILE_KIND_RANK: Record<FileKind, number> = {
  source: 1,
  script: 0.5,
  test: 0.4,
  config: 0.35,
  fixture: 0.3,
  docs: 0.25,
  generated: 0.15,
}
