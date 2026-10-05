/** String similarity helpers used by FUZZY_SEARCH (spec section 23). */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(current[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    prev = current
  }
  return prev[b.length]
}

export function editDistanceSimilarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (max === 0) return 1
  return 1 - levenshtein(a, b) / max
}

export function tokenize(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.toLowerCase())
    .filter(Boolean)
}

export function tokenSimilarity(a: string, b: string): number {
  const left = new Set(tokenize(a))
  const right = new Set(tokenize(b))
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection++
  return (2 * intersection) / (left.size + right.size)
}

export function identifierSimilarity(a: string, b: string): number {
  return Math.max(editDistanceSimilarity(a.toLowerCase(), b.toLowerCase()), tokenSimilarity(a, b))
}

export interface FuzzyCandidate {
  value: string
  score: number
  method: "edit_distance" | "token_similarity" | "identifier_similarity" | "word_similarity"
}

export function rankCandidates(query: string, candidates: string[], limit = 20, threshold = 0.4): FuzzyCandidate[] {
  const scored: FuzzyCandidate[] = []
  for (const candidate of candidates) {
    const edit = editDistanceSimilarity(query.toLowerCase(), candidate.toLowerCase())
    const token = tokenSimilarity(query, candidate)
    const word = wordSimilarity(query, candidate)
    const best = Math.max(edit, token, word)
    const method: FuzzyCandidate["method"] =
      best === edit ? "edit_distance" : best === token ? "token_similarity" : "word_similarity"
    if (best >= threshold) scored.push({ value: candidate, score: Number(best.toFixed(4)), method })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

function wordSimilarity(a: string, b: string): number {
  const words = tokenize(b)
  const queryWords = tokenize(a)
  if (!queryWords.length) return 0
  let hits = 0
  for (const word of queryWords) {
    if (words.some((candidate) => identifierSimilarity(word, candidate) > 0.8)) hits++
  }
  return hits / queryWords.length
}
