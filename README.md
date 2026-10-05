# Controlled Mode for OpenCode

A controlled, explainable, observable, interruptible and replayable codebase
investigation runtime for [OpenCode](https://opencode.ai), implementing
`spec.md` (CM-OPENCODE-SPEC-001) and the boundary in `role.md`.

The engineering objective is not maximum autonomous exploration. It is:

> Perform the minimum useful investigation that produces sufficient evidence for a reliable answer.

## The boundary

```text
LLM        -> PROPOSE   (an ActionProposal, never an execution)
JEV        -> DECIDE    (is it justified? which capability? how deep? when to stop?)
XSTATE     -> ENFORCE   (is it executable from the current state? budget? guards?)
CAPABILITY -> EXECUTE   (read-only inspection)
EVIDENCE   -> VERIFY    (file, line, symbol, relation, confidence)
LLM        -> SYNTHESIZE (the final answer)
```

- JEV decides **what the investigation should do**.
- XState controls **how the investigation executes it**.
- JEV never executes a capability. XState never selects investigation strategy.
- The LLM never bypasses JEV. JEV never bypasses XState. XState never invents evidence.

## Install

### As a project plugin (recommended)

From the project you want to investigate:

```bash
# 1. install the package into the project's .opencode
opencode plugin opencode-controlled-mode

# or manually add it to opencode.json:
#   { "plugin": ["opencode-controlled-mode"] }
```

Or, without npm, drop a file into `.opencode/plugin/`:

```ts
// .opencode/plugin/controlled.ts
export { default } from "/absolute/path/to/opencode-controlled-mode/src/index.ts"
```

The plugin registers everything itself:

- the investigation tools (`controlled_start`, `controlled_step`, `controlled_finish`, `controlled_status`, `decision_visualize`);
- the `controlled` primary agent (read-only, only the controlled tools are permitted);
- the `/decision-visualize` command;
- the local visualizer server.

Verify the registration:

```bash
opencode agent list                 # should include: controlled (primary)
opencode debug config | grep decision-visualize
opencode debug agent controlled     # shows the permission and enabled tools
```

### Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `CONTROLLED_VISUALIZER_PORT` | `4599` | Visualizer HTTP/WebSocket port |
| `CONTROLLED_VISUALIZER_TOKEN` | random per process | Visualizer access token |
| `CONTROLLED_JEV_MODEL` | `opencode/jev-1.13` | Decision model for JEV (a bare id defaults to the `opencode` provider) |
| `CONTROLLED_JEV_TIMEOUT_MS` | `15000` | Decision model timeout before falling back |

## Usage

1. Select the `controlled` mode (`Tab` in the TUI, or `--agent controlled`).
2. Ask a codebase question, for example:
   - `Where is the API that creates a VIP appointment?`
   - `Can I remove customer_id from the OrderRequest schema?`
   - `I have X -> Y -> Z. Which API is related to this flow?`
   - `Is there a circular dependency?`
3. The agent calls `controlled_start`, then proposes actions with `controlled_step`. JEV decides, XState enforces, capabilities collect evidence, and the agent returns an evidence-backed answer with `controlled_finish`.
4. Run `/decision-visualize` at any time to open the live visualizer.

## Architecture

```text
src/
  index.ts                 plugin entry: default { id, server }
  plugin.ts                registers tools, agent, command, visualizer
  prompts.ts               controlled agent system prompt, command template
  core/
    types.ts               Evidence, ActionProposal, JEVDecision, session, graph, budget
    runtime.ts             ControlledRuntime: start / step / finish / control / snapshot
    jev.ts                 decision engine (policy, escalation, sufficiency)
    machine.ts             XState-style controller (states, guards, live modification)
    registry.ts            capability registry and metadata
    budget.ts              investigation budget and hard limits
    events.ts              immutable, persisted, versioned event store
    ids.ts, redact.ts      identifiers and secret redaction
  capabilities/
    index.ts               CodeIndex: structural index over the repository
    lang.ts                dependency-free structural parser (declarations, params, calls, imports)
    frameworks.ts          route and schema detection (FastAPI, Flask, Express, NestJS, Spring, Django, Frappe, GraphQL; Pydantic, TS, Zod, dataclass, OpenAPI, DocTypes)
    execute.ts             capability implementations -> evidence
    graph-utils.ts         cycle detection, reachability, graph merge
    similarity.ts          fuzzy matching (edit distance, token, identifier, word)
    fs.ts                  file walking and language detection
  tools/controlled.ts      OpenCode tool definitions
  visualizer/
    server.ts              localhost HTTP + WebSocket server, command validation, replay
    ui.ts                  single-page visualizer UI
test/                      unit and integration tests (bun test)
fixtures/sample-repo/      fixture repository used by the tests
```

### Investigation loop

```text
controlled_start(question)
   -> classify intents + entities, create session, IDLE -> UNDERSTANDING -> READY

controlled_step(proposal)                       # LLM proposes
   READY -> JEV_DECISION
   JEV decides: EXPLORE | VERIFY | ANSWER | STOP | ASK_USER
                verdict:  ALLOW | MODIFY | REJECT | STOP | ASK_USER
   EXPLORE/VERIFY -> XState guards -> EXECUTING -> capability
                                 -> COLLECTING_EVIDENCE -> EVALUATING -> READY
   REJECT  -> READY (the action did not run)
   ANSWER/STOP -> ANSWERING
   ASK_USER -> WAITING_FOR_USER

controlled_finish(answer) -> ANSWERING -> COMPLETED
```

### JEV policy

JEV evaluates relevance, expected information gain, cost, exploration depth,
duplicate actions, evidence sufficiency, budget, graph coverage, cycle risk,
the current XState state and user restrictions. Default policy
(`src/core/jev.ts`):

| Policy | Default |
| --- | --- |
| `minUsefulScore` | `0.15` |
| `answerEvidenceCount` | `6` |
| `minActionsBeforeAnswer` | `3` |
| `answerConfidence` | `0.75` |

Default escalation: `EXACT_SEARCH -> FUZZY_SEARCH -> SEMANTIC_SEARCH`, and
structural analysis before graph traversal. JEV also downgrades an expensive
proposal to a cheaper capability that can still produce evidence, and limits
graph depth rather than rejecting an otherwise useful action.

### Decision model (JEV model)

JEV is model-backed by default. The decision model decides what the
investigation should do; a deterministic layer enforces the hard constraints
(user stop, budget, loop protection, capability availability, depth) and can
override a model decision that violates them.

- Default model: `opencode/jev-1.13`.
- The model runs through a hidden `controlled-jeve` agent (no tools) so the
  request carries only the JEV instruction and a compact context.
- Each decision is one bounded call (`CONTROLLED_JEV_TIMEOUT_MS`, default
  `15000`). On timeout, error or an unparseable answer, JEV falls back to the
  deterministic policy and records a `JEV_FALLBACK` event.
- The model id is validated against the instance catalog before it is called
  (lazily, once, bounded). A model that does not exist is never called, so it
  cannot produce a visible provider error; JEV simply uses the deterministic
  policy and reports the reason in `controlled_config`.
- Set the model to `heuristic` to disable the model and use the deterministic
  policy only.

Change the decision model in any of these ways:

```jsonc
// 1. plugin option in opencode.json
{ "plugin": [["opencode-controlled-mode", { "jevModel": "opencode/space-bunny-free" }]] }
```

```bash
# 2. environment
CONTROLLED_JEV_MODEL=opencode/space-bunny-free opencode
```

```text
# 3. in a session (MODIFY mode in the visualizer, or the tool)
controlled_config { "jevModel": "opencode/space-bunny-free" }
# visualizer -> MODIFY -> SET_JEV_MODEL
```

Every change is recorded as a `JEV_MODEL_CHANGED` event. The visualizer header
shows the active decision model.

### Search quality and coverage

Two rules keep the investigation honest and make the answer reachable:

**Ranked, truncation-aware search.** Every file is classified
(`source | test | generated | fixture | docs | config | script`). Search results
are ranked: definition lines first, then real source, then scripts, tests,
fixtures and generated output. Each result reports `total`, `showing`,
`truncated` and the top files with match counts, so a capped result is never
mistaken for a complete one. `target.file` or `parameters.pathPrefix` narrows a
search, and `parameters.offset` pages it.

**Coverage-based sufficiency.** JEV does not answer on match volume. Each intent
declares the evidence it needs, for example:

| Intent | Required evidence |
| --- | --- |
| `FIND_API`, `ROUTE_ANALYSIS` | a route and a definition |
| `FIND_DEFINITION`, `FIND_FUNCTION` | a definition |
| `FIND_REFERENCE` | references, calls or imports |
| `IMPACT_ANALYSIS` | references and callers |
| `SAFE_REMOVAL` | schema, references, callers and routes |
| `DEPENDENCY_ANALYSIS` | import or graph edges |
| `CYCLE_DETECTION` | a completed cycle detection |

The investigation answers only when those groups are covered (or their
capability was attempted). Until then JEV is **gap-driven**: if the proposal
does not close a missing group, JEV selects the capability that does and
returns `MODIFY`. A run that keeps issuing text searches is steered to
`ROUTE_SEARCH`, `FIND_DEFINITION` or `READ_SYMBOL` instead. The step result
lists the remaining gaps and the capability that closes each one.

### XState controller

Lifecycle states: `IDLE`, `UNDERSTANDING`, `READY`, `JEV_DECISION`,
`EXECUTING`, `COLLECTING_EVIDENCE`, `EVALUATING`, `ANSWERING`,
`WAITING_FOR_USER`, `PAUSED`, `COMPLETED`, `STOPPED`, `FAILED`.

Guards: `HAS_BUDGET`, `DEPTH_ALLOWED`, `ACTION_ALLOWED`, `TARGET_VALID`,
`NOT_DUPLICATE`, `NOT_ALREADY_EXPLORED`, `NO_ACTIVE_CONFLICT`,
`USER_NOT_STOPPED`, `CAPABILITY_AVAILABLE`.

XState rejects invalid transitions, preserves the previous valid state, and
enforces the hard limits. A live modification that touches the active state is
held as `PENDING_CHANGE` until a safe transition boundary, then applied and
recorded with a new machine version (`machine-v1 -> machine-v2 -> ...`).

### Capabilities

Discovery: `EXACT_SEARCH`, `FILENAME_SEARCH`, `TEXT_SEARCH`, `FUZZY_SEARCH`,
`SEMANTIC_SEARCH` (not implemented in v0.1).

AST: `AST_SEARCH`, `AST_FUNCTION`, `AST_CLASS`, `AST_SCHEMA`, `AST_IMPORT`,
`AST_DECORATOR`, `AST_PARAMETER`.

Symbol: `SYMBOL_SEARCH`, `FIND_DEFINITION`, `FIND_REFERENCES`,
`FIND_CALLERS`, `FIND_CALLEES`, `FIND_IMPLEMENTATIONS`, `READ_SYMBOL`.

API: `ROUTE_SEARCH`, `ENDPOINT_DEFINITION`, `REQUEST_SCHEMA`,
`RESPONSE_SCHEMA`, `VALIDATION`, `AUTHORIZATION`, `API_IMPLEMENTATION`.

Graph: `CALL_GRAPH`, `IMPORT_GRAPH`, `DEPENDENCY_GRAPH`, `REVERSE_DEPENDENCY`,
`DATA_FLOW`, `CYCLE_DETECTION`.

Verify: `EVIDENCE_CHECK`, `COVERAGE_CHECK`, `DUPLICATE_CHECK`,
`CONTRADICTION_CHECK`, `CONFIDENCE_CHECK`.

Every capability returns `Evidence` with `file`, `lineStart`, `lineEnd`,
`symbol`, `relation`, `confidence` and `discoveredBy`. The system never
creates synthetic source locations.

### Budget

| Limit | Default |
| --- | --- |
| Maximum actions | 20 |
| Maximum files | 50 |
| Maximum graph depth | 4 |
| Maximum fuzzy searches | 3 |
| Maximum semantic searches | 3 |
| Maximum graph nodes | 100 |
| Maximum LLM iterations | 10 |

JEV decides what is worth the remaining budget. XState enforces the hard limit.

### Termination

`EVIDENCE_SUFFICIENT`, `NO_USEFUL_ACTION`, `BUDGET_EXCEEDED`, `DEPTH_EXCEEDED`,
`REPEATED_ACTION`, `USER_STOP`, `USER_REQUESTED_ANSWER`, `REQUIRES_USER_INPUT`,
`FATAL_ERROR`.

### Event store and visualizer

The event store is an immutable, append-only, per-session JSONL stream and the
single source of session history. Events use a versioned protocol:

```json
{ "version": 1, "seq": 12, "type": "JEV_DECISION", "sessionId": "inv_...", "timestamp": "...", "payload": { "decision": "EXPLORE", "verdict": "MODIFY", "capability": "FUZZY_SEARCH", "reason": "Exact search produced no suitable candidate." } }
```

Secret redaction is applied before persistence.

The visualizer (`/decision-visualize`) shows the XState graph, the current
state, JEV decisions, evidence, the execution timeline, the budget, the
capability registry and session controls. It binds to `127.0.0.1` and requires
a token for the API and WebSocket.

Control modes:

- **OBSERVE** (default): inspect only.
- **CONTROL**: `PAUSE`, `RESUME`, `STOP`, `STEP`, `SET_SPEED`, `REPLAY`, `APPROVE_ACTION`, `REJECT_ACTION`.
- **MODIFY**: `ADD_STATE`, `REMOVE_STATE`, `MODIFY_STATE`, `ADD_TRANSITION`, `REMOVE_TRANSITION`, `MODIFY_TRANSITION`, `DISABLE_STATE`, `ENABLE_STATE`, `ADD_CAPABILITY`, `UPDATE_BUDGET`, `UPDATE_POLICY`.

The runtime validates every browser command (session id, command type, mode,
state machine validity). Replay folds the event stream; it never executes a
capability. Execution speed never bypasses JEV or the XState guards.

## Testing

```bash
bun test          # 67 unit and integration tests
bun run typecheck # tsc --noEmit
```

Coverage includes JEV decisions, XState transitions and guards, live state
modification, capability validation, search/AST/symbol/API/graph capabilities,
cycle detection, evidence collection, budget enforcement, duplicate and loop
prevention, event serialization, replay, visualizer commands and WebSocket
streaming.

## Scope of version 0.1

Implemented: the full controlled loop, JEV, XState, the capability registry,
exact/fuzzy/filename/text search, structural AST analysis, symbol and reference
analysis, callers/callees, API route analysis, import/call/dependency graphs,
cycle detection, evidence and confidence, the budget, the event store, the
visualizer with pause/resume/stop/step/speed/replay, and live XState
modification.

Deferred (per the specification): `SEMANTIC_SEARCH` (embeddings), code
modification, refactoring, Git integration, test execution, runtime tracing,
persistent repository graphs, remote visualizer, and multi-agent investigations.

## Assumptions and limitations

- **Structural parser.** The AST analysis is a dependency-free structural
  parser (declarations, parameters, calls, imports) with framework-aware route
  and schema detection. It is not a compiler front end; it can miss dynamic or
  highly generated code. Findings always carry a real source location.
- **Read-only.** Controlled Mode never registers an edit, write or shell tool.
  The `controlled` agent permits only the controlled investigation tools.
- **Depth semantics.** "Depth" is the maximum graph traversal depth reached,
  not the number of actions.
- **Evidence sufficiency** is a policy decision. Defaults are conservative; the
  visualizer can change the policy for the current session in MODIFY mode.
- **Decision model latency.** A free decision model can take several seconds per
  decision (and longer on a cold start). The default 15s timeout falls back to
  the deterministic policy when the model is too slow. Raise
  `CONTROLLED_JEV_TIMEOUT_MS` for a slow model.
- **Ports.** The visualizer uses `127.0.0.1:4599` by default.

## Spec mapping

| Spec area | Implementation |
| --- | --- |
| §6-10 investigation loop, LLM tasks | `core/runtime.ts`, `prompts.ts` |
| §11-17 JEV | `core/jev.ts`, `core/jev-model.ts` |
| §18-24, §46 XState + escalation | `core/machine.ts`, `core/jev.ts` |
| §25-27 AST | `capabilities/lang.ts`, `capabilities/frameworks.ts`, `capabilities/execute.ts` |
| §28-35 symbol/API | `capabilities/execute.ts`, `capabilities/index.ts` |
| §36-40 graph and cycles | `capabilities/graph-utils.ts`, `capabilities/index.ts` |
| §41-43 evidence and confidence | `core/types.ts`, `capabilities/execute.ts` |
| §44 investigation graph | `capabilities/graph-utils.ts`, `core/runtime.ts` |
| §45, §79 budget and cost | `core/budget.ts`, `core/registry.ts` |
| §50-51 event store | `core/events.ts` |
| §52-74 visualizer | `visualizer/server.ts`, `visualizer/ui.ts` |
| §75-76 security and isolation | `core/redact.ts`, `visualizer/server.ts` |
| §77-78 capability registry | `core/registry.ts` |
| §80-84 guards, duplicates, loops, contradictions | `core/machine.ts`, `core/jev.ts`, `capabilities/execute.ts` |
| §85-88 final answer and examples | `core/runtime.ts`, `test/runtime.test.ts` |
| §89-93 event protocol, commands, versioning | `core/events.ts`, `core/machine.ts`, `visualizer/server.ts` |
| §94-97 failure handling | `core/runtime.ts`, `core/events.ts` |
| §100-101 testing | `test/` |
