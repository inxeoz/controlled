import { describe, expect, test } from "bun:test"
import { ALL_GUARDS_PASS, Controller, baseMachine, type GuardFlags } from "../src/core/machine"

describe("XState controller", () => {
  test("follows the lifecycle from IDLE to COMPLETED", () => {
    const controller = new Controller()
    expect(controller.state).toBe("IDLE")
    expect(controller.send("START").ok).toBe(true)
    expect(controller.send("UNDERSTOOD").ok).toBe(true)
    expect(controller.send("PROPOSE").ok).toBe(true)
    expect(controller.send("EXPLORE").ok).toBe(true)
    expect(controller.send("EXECUTED").ok).toBe(true)
    expect(controller.send("COLLECTED").ok).toBe(true)
    expect(controller.send("NEXT").ok).toBe(true)
    expect(controller.state).toBe("READY")
  })

  test("rejects an invalid transition and preserves the state", () => {
    const controller = new Controller()
    const result = controller.send("EXECUTE")
    expect(result.ok).toBe(false)
    expect(controller.state).toBe("IDLE")
    expect(result.reason).toContain("No transition")
  })

  test("rejects a transition whose guard fails", () => {
    const controller = new Controller()
    controller.send("START")
    controller.send("UNDERSTOOD")
    controller.send("PROPOSE")
    const guards: GuardFlags = { ...ALL_GUARDS_PASS, HAS_BUDGET: false }
    const result = controller.send("EXPLORE", guards)
    expect(result.ok).toBe(false)
    expect(result.failedGuards).toContain("HAS_BUDGET")
    expect(controller.state).toBe("JEV_DECISION")
  })

  test("pause and resume preserve the previous state", () => {
    const controller = new Controller()
    controller.send("START")
    controller.send("UNDERSTOOD")
    expect(controller.send("PAUSE").ok).toBe(true)
    expect(controller.state).toBe("PAUSED")
    expect(controller.send("PROPOSE").ok).toBe(false)
    expect(controller.send("RESUME").ok).toBe(true)
    expect(controller.state).toBe("READY")
  })

  test("stop is terminal", () => {
    const controller = new Controller()
    controller.send("START")
    expect(controller.send("STOP").ok).toBe(true)
    expect(controller.state).toBe("STOPPED")
    expect(controller.send("START").ok).toBe(false)
    expect(controller.isTerminal()).toBe(true)
  })

  test("live modification adds a state and bumps the machine version", () => {
    const controller = new Controller()
    const change = controller.requestChange("ADD_STATE", { id: "DATABASE_SEARCH", category: "LIFECYCLE" })
    expect(change.applied).toBe(true)
    expect(controller.states().some((state) => state.id === "DATABASE_SEARCH")).toBe(true)
    expect(controller.version).toBe("machine-v2")
  })

  test("removing a state with transitions is rejected", () => {
    const controller = new Controller()
    const change = controller.requestChange("REMOVE_STATE", { id: "EXECUTING" })
    expect(change.applied).toBe(false)
    expect(change.error).toContain("transitions")
  })

  test("a change to the active state is pending until a safe boundary", () => {
    const controller = new Controller()
    controller.send("START")
    controller.send("UNDERSTOOD")
    controller.send("PROPOSE")
    controller.send("EXPLORE")
    expect(controller.state).toBe("EXECUTING")
    const change = controller.requestChange("MODIFY_STATE", { id: "EXECUTING", description: "changed" })
    expect(change.pending).toBe(true)
    expect(controller.pendingChanges.length).toBe(1)
    controller.send("EXECUTED")
    controller.send("COLLECTED")
    controller.send("NEXT")
    expect(controller.state).toBe("READY")
    expect(controller.pendingChanges[0].applied).toBe(true)
  })

  test("base machine contains the documented state groups", () => {
    const ids = baseMachine().states.map((state) => state.id)
    for (const state of ["IDLE", "UNDERSTANDING", "READY", "JEV_DECISION", "EXECUTING", "COLLECTING_EVIDENCE", "EVALUATING", "ANSWERING", "COMPLETED", "STOPPED", "WAITING_FOR_USER", "PAUSED", "FAILED"]) {
      expect(ids).toContain(state)
    }
  })
})
