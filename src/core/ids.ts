let counter = 0

function random(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** Monotonic, sortable-enough identifier for sessions, evidence and events. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 0xffffff
  const stamp = Date.now().toString(36)
  const seq = counter.toString(36).padStart(4, "0")
  return `${prefix}_${stamp}${seq}${random()}`
}

export function newSessionId(): string {
  return newId("inv")
}

export function newEvidenceId(): string {
  return newId("ev")
}

export function newProposalId(): string {
  return newId("pr")
}

export function newDecisionId(): string {
  return newId("jev")
}

export function newEventId(): string {
  return newId("e")
}
