# Controlled Mode for OpenCode

**Document ID:** CM-OPENCODE-SPEC-001  
**Version:** 0.1  
**Status:** Draft  
**Language:** ASD-STE100-style controlled English  
**Product:** OpenCode Controlled Mode  
**Primary command:** `/decision-visualize`

---

# 1. Purpose

This specification defines the Controlled Mode extension for OpenCode.

Controlled Mode shall provide controlled investigation of a codebase.

Controlled Mode shall support questions about:

- APIs.
- Functions.
- Classes.
- Schemas.
- Parameters.
- Fields.
- References.
- Callers.
- Callees.
- Dependencies.
- Data flow.
- Routes.
- Tests.
- Circular dependencies.
- Impact of code changes.

Controlled Mode shall use three main control components:

1. LLM.
2. JEV Decision Model.
3. XState Controller.

The LLM shall reason about the investigation.

The LLM shall propose the next investigation action.

JEV shall decide if the proposed action is permitted.

XState shall control the execution state.

Investigation tools shall produce evidence.

The LLM shall use the evidence to produce the next proposal or the final answer.

The system shall repeat this process until a termination condition is reached.

---

# 2. Scope

This specification covers:

- Controlled Mode.
- Investigation sessions.
- Investigation actions.
- Investigation capabilities.
- JEV decisions.
- XState state machines.
- Code search.
- Fuzzy search.
- Semantic search.
- AST analysis.
- Symbol analysis.
- Reference analysis.
- API analysis.
- Dependency analysis.
- Graph analysis.
- Cycle detection.
- Evidence collection.
- Investigation budgets.
- Investigation termination.
- Event logging.
- Session replay.
- `/decision-visualize`.
- Live session control.
- Live XState modification.
- Visualizer security boundaries.

This specification does not define:

- OpenCode core implementation.
- A specific LLM provider.
- A specific embedding provider.
- A specific AST library.
- A specific graph database.
- Production code modification.
- Automatic Git commits.

---

# 3. Product Definition

Controlled Mode is an OpenCode execution mode.

Controlled Mode shall be available in the same manner as other OpenCode modes.

The user shall be able to select:

```text
controlled
```

as the active mode.

Controlled Mode shall be optimized for codebase investigation.

Controlled Mode shall be read-only in version 0.1.

Controlled Mode shall not modify source code during an investigation.

---

# 4. Design Principles

## 4.1 Separation of responsibilities

The system shall separate reasoning from control.

The LLM shall not control its own exploration.

JEV shall not execute investigation tools.

XState shall not determine semantic meaning.

Investigation tools shall not decide when to stop.

The responsibility model shall be:

```text
LLM       → Understand and propose.
JEV       → Decide and constrain.
XState    → Control and execute.
Tools     → Inspect and collect evidence.
Evidence  → Support conclusions.
LLM       → Summarize and propose again.
```

---

## 4.2 Evidence before conclusion

The system shall not treat an LLM assumption as codebase evidence.

The system shall identify evidence from the codebase.

The system shall store evidence with its source location.

The final answer shall distinguish verified information from assumptions.

---

## 4.3 Controlled exploration

The system shall not perform unrestricted exploration.

Every investigation action shall pass through the control system.

JEV shall evaluate the proposed action.

XState shall validate the current execution state.

The system shall apply investigation limits.

---

## 4.4 Observable execution

The system shall record important execution events.

The system shall expose the events to the visualizer.

The user shall be able to inspect the current state.

The user shall be able to inspect previous states.

The user shall be able to inspect JEV decisions.

The user shall be able to inspect LLM proposals.

The user shall be able to inspect evidence.

---

# 5. System Architecture

The system shall contain the following components:

```text
OpenCode
   |
   +-- Controlled Mode
          |
          +-- LLM Adapter
          |
          +-- JEV Decision Engine
          |
          +-- XState Controller
          |
          +-- Capability Registry
          |
          +-- Investigation Runtime
          |
          +-- Evidence Store
          |
          +-- Event Store
          |
          +-- Code Intelligence Tools
          |
          +-- Visualizer Server
```

The main execution path shall be:

```text
User
  |
  v
Controlled Mode
  |
  v
LLM
  |
  v
Action Proposal
  |
  v
JEV
  |
  v
XState
  |
  v
Investigation Capability
  |
  v
Evidence
  |
  v
LLM
  |
  +----> JEV
```

---

# 6. Controlled Investigation Loop

Each investigation shall use the following loop:

```text
1. Receive user question.
2. Classify the question.
3. Create investigation context.
4. Ask the LLM to create an initial proposal.
5. Send the proposal to JEV.
6. Apply the JEV decision.
7. Send the approved action to XState.
8. Execute the investigation capability.
9. Collect evidence.
10. Update investigation context.
11. Ask the LLM to evaluate the evidence.
12. Create the next proposal.
13. Repeat the process.
14. Stop when a termination condition is reached.
15. Generate the final answer.
```

The system shall not skip JEV for a normal investigation action.

The system shall not skip XState for a controlled investigation action.

---

# 7. Investigation Session

Each user investigation shall create an investigation session.

The session shall have a unique identifier.

Example:

```text
inv_01JCONTROL123
```

The session shall contain:

```ts
interface InvestigationSession {
    id: string
    question: string
    status: InvestigationStatus
    intent: InvestigationIntent
    hypothesis: string | null
    evidence: Evidence[]
    actions: InvestigationAction[]
    decisions: JEVDecision[]
    graph: InvestigationGraph
    budget: InvestigationBudget
    currentState: string
    createdAt: string
    updatedAt: string
}
```

---

# 8. Investigation Status

The system shall support the following statuses:

```text
INITIALIZING
CLASSIFYING
INVESTIGATING
VERIFYING
ANSWERING
PAUSED
STOPPED
BLOCKED
COMPLETED
FAILED
```

The system shall not use an undefined status.

---

# 9. Investigation Intent

The system shall support these investigation intents:

```text
FIND_API
FIND_FUNCTION
FIND_DEFINITION
FIND_REFERENCE
FIND_RELATED_API
TRACE_FLOW
UNDERSTAND_FUNCTION
IMPACT_ANALYSIS
SAFE_REMOVAL
DEPENDENCY_ANALYSIS
CYCLE_DETECTION
SCHEMA_ANALYSIS
ROUTE_ANALYSIS
GENERAL_EXPLORATION
```

The system may assign more than one intent.

Example:

```text
SAFE_REMOVAL
IMPACT_ANALYSIS
DEPENDENCY_ANALYSIS
```

---

# 10. LLM Component

The LLM shall perform four primary tasks.

## 10.1 Question interpretation

The LLM shall interpret the user question.

The LLM shall identify the investigation intent.

The LLM shall identify important entities.

Examples:

```text
customer_id
OrderRequest
create_order
/api/orders
```

---

## 10.2 Evidence interpretation

The LLM shall interpret collected evidence.

The LLM shall identify relationships between evidence items.

The LLM shall identify missing information.

The LLM shall identify contradictions.

---

## 10.3 Hypothesis creation

The LLM may create a hypothesis.

Example:

```text
The API may call OrderService.create_order().
```

A hypothesis shall not be treated as verified evidence.

---

## 10.4 Action proposal

The LLM shall propose the next action.

Example:

```json
{
    "action": "FIND_CALLERS",
    "target": "OrderService.create_order",
    "reason": "Verify the API entry point."
}
```

The LLM shall not execute the action directly.

---

# 11. LLM Action Proposal

An action proposal shall contain:

```ts
interface ActionProposal {
    id: string
    capability: CapabilityId
    target: string | null
    parameters: Record<string, unknown>
    reason: string
    expectedResult: string
}
```

The proposal shall contain one primary capability.

The proposal shall contain a reason.

The proposal shall identify the target when a target is required.

---

# 12. JEV Decision Model

JEV shall control investigation decisions.

JEV shall evaluate:

- Relevance.
- Expected information gain.
- Cost.
- Exploration depth.
- Previous execution.
- Duplicate actions.
- Evidence sufficiency.
- Investigation budget.
- Graph coverage.
- Cycle risk.
- Current XState state.
- User restrictions.

JEV shall return one of:

```text
ALLOW
REJECT
MODIFY
STOP
ASK_USER
```

---

# 13. JEV ALLOW

JEV shall return `ALLOW` when the action is useful and valid.

Example:

```json
{
    "decision": "ALLOW",
    "capability": "FUZZY_SEARCH",
    "reason": "Exact search did not produce a suitable candidate."
}
```

---

# 14. JEV REJECT

JEV shall return `REJECT` when the action is not useful or not permitted.

Example:

```json
{
    "decision": "REJECT",
    "reason": "The same search was already executed."
}
```

The rejected action shall not execute.

---

# 15. JEV MODIFY

JEV shall return `MODIFY` when the action is useful but requires limits.

Example:

```json
{
    "decision": "MODIFY",
    "capability": "CALL_GRAPH",
    "constraints": {
        "maxDepth": 2,
        "maxNodes": 20
    }
}
```

The modified action shall be sent to XState.

---

# 16. JEV STOP

JEV shall return `STOP` when the investigation has enough evidence or no useful exploration remains.

The system shall not execute another investigation action after a final `STOP`.

---

# 17. JEV ASK_USER

JEV shall return `ASK_USER` when the system cannot continue safely or correctly without user input.

Examples:

- The target is ambiguous.
- Two APIs have equal relevance.
- The repository contains external references that cannot be verified.
- The user must select the investigation scope.

---

# 18. XState Controller

XState shall control the investigation state.

XState shall define valid transitions.

XState shall reject invalid transitions.

XState shall apply guards.

XState shall apply execution actions.

XState shall maintain the current state.

XState shall expose state changes as events.

---

# 19. XState State Groups

The XState machine shall contain these state groups:

```text
UNDERSTAND

DISCOVERY

AST

SYMBOL

API

GRAPH

VERIFICATION

CONTROL

COMPLETION
```

---

# 20. UNDERSTAND States

The system shall support:

```text
CLASSIFY
EXTRACT_ENTITIES
CREATE_HYPOTHESIS
CREATE_PROPOSAL
```

---

# 21. DISCOVERY States

The system shall support:

```text
EXACT_SEARCH
FUZZY_SEARCH
SEMANTIC_SEARCH
FILENAME_SEARCH
TEXT_SEARCH
```

---

# 22. EXACT_SEARCH

`EXACT_SEARCH` shall search for an exact text value.

The capability shall support:

- Function names.
- Class names.
- Field names.
- Route names.
- Error messages.
- Variable names.
- File names.

The capability shall return matching locations.

---

# 23. FUZZY_SEARCH

`FUZZY_SEARCH` shall find approximate matches.

The capability shall support:

- Edit distance.
- Token similarity.
- Identifier similarity.
- Word similarity.
- Naming variation.

Example:

```text
create appointment
```

may match:

```text
create_appointment
createAppointment
create_vip_appointment
appointment_create
```

The capability shall return ranked candidates.

The capability shall report its matching method.

---

# 24. SEMANTIC_SEARCH

`SEMANTIC_SEARCH` shall find code that is related by meaning.

The capability may use:

- Embeddings.
- Code embeddings.
- Repository indexes.
- Semantic ranking.

Semantic search shall have a higher default cost than exact search.

JEV should prefer cheaper search methods when they can provide sufficient evidence.

---

# 25. AST State Group

The system shall support:

```text
AST_SEARCH
AST_FUNCTION
AST_CLASS
AST_SCHEMA
AST_IMPORT
AST_DECORATOR
AST_PARAMETER
```

---

# 26. AST_SEARCH

`AST_SEARCH` shall search code structures.

The capability shall not depend only on source text.

Example:

```text
Find functions that have a parameter named customer_id.
```

The capability shall inspect function structure.

The capability shall return:

- File.
- Symbol.
- Parameters.
- Location.
- Relevant AST structure.

---

# 27. AST_SCHEMA

`AST_SCHEMA` shall inspect schema definitions.

The capability should support, where applicable:

```text
Pydantic
TypeScript interfaces
TypeScript types
Zod
JSON Schema
OpenAPI
Frappe DocTypes
Dataclasses
```

The implementation may add additional schema systems.

---

# 28. Symbol State Group

The system shall support:

```text
SYMBOL_SEARCH
FIND_DEFINITION
FIND_REFERENCES
FIND_CALLERS
FIND_CALLEES
FIND_IMPLEMENTATIONS
```

---

# 29. FIND_DEFINITION

The capability shall locate the definition of a symbol.

The result shall contain:

```text
file
line
symbol
symbol type
```

---

# 30. FIND_REFERENCES

The capability shall locate references to a symbol.

The result shall identify:

- File.
- Line.
- Symbol.
- Reference type.

---

# 31. FIND_CALLERS

The capability shall locate functions that call a target function.

Example:

```text
create_order()
```

may return:

```text
OrderAPI.create()
CheckoutService.submit()
TestOrderAPI.test_create()
```

---

# 32. FIND_CALLEES

The capability shall locate functions called by a target function.

---

# 33. API State Group

The system shall support:

```text
ROUTE_SEARCH
ENDPOINT_DEFINITION
REQUEST_SCHEMA
RESPONSE_SCHEMA
VALIDATION
AUTHORIZATION
API_IMPLEMENTATION
```

---

# 34. ROUTE_SEARCH

`ROUTE_SEARCH` shall locate API routes.

The capability shall support, where applicable:

```text
REST
GraphQL
Frappe API methods
Express
FastAPI
Flask
Django
Spring
NestJS
```

The implementation may add additional frameworks.

---

# 35. API Relationship Analysis

The system shall be able to produce:

```text
Route
  |
  v
Controller
  |
  v
Service
  |
  v
Repository
  |
  v
Database
```

The system shall store each verified relationship as graph evidence.

---

# 36. GRAPH State Group

The system shall support:

```text
CALL_GRAPH
IMPORT_GRAPH
DEPENDENCY_GRAPH
REVERSE_DEPENDENCY
DATA_FLOW
CYCLE_DETECTION
```

---

# 37. CALL_GRAPH

The capability shall construct function call relationships.

Example:

```text
A()
 |
 +--> B()
       |
       +--> C()
```

The system shall track traversal depth.

The system shall track visited nodes.

The system shall track visited edges.

---

# 38. IMPORT_GRAPH

The capability shall identify module import relationships.

Example:

```text
api.py
  |
  +--> service.py
          |
          +--> repository.py
```

---

# 39. DEPENDENCY_GRAPH

The capability shall identify dependency relationships.

The capability may include:

- Module dependencies.
- Function dependencies.
- Class dependencies.
- Schema dependencies.
- API dependencies.
- Package dependencies.

---

# 40. CYCLE_DETECTION

The system shall detect cycles independently of the LLM.

Example:

```text
A → B → C → A
```

The system shall create a cycle event.

The event shall contain the complete discovered path.

Example:

```json
{
    "type": "CYCLE_DETECTED",
    "path": ["A", "B", "C", "A"]
}
```

JEV shall decide if further exploration is useful.

The LLM shall explain the meaning of the cycle.

The LLM shall not be the authority for cycle detection.

---

# 41. VERIFICATION State Group

The system shall support:

```text
EVIDENCE_CHECK
COVERAGE_CHECK
DUPLICATE_CHECK
CONTRADICTION_CHECK
CONFIDENCE_CHECK
```

---

# 42. Evidence

Each evidence item shall contain:

```ts
interface Evidence {
    id: string
    type: string
    file: string
    lineStart: number | null
    lineEnd: number | null
    symbol: string | null
    relation: string | null
    confidence: number
    discoveredBy: string
}
```

The system shall preserve the source of evidence.

The system shall not create synthetic source locations.

---

# 43. Evidence Confidence

The system shall store confidence separately from truth.

The following values are recommended:

```text
0.00 - 0.29  Very weak
0.30 - 0.49  Weak
0.50 - 0.69  Medium
0.70 - 0.89  Strong
0.90 - 1.00  Very strong
```

Confidence shall not be used as a replacement for evidence.

---

# 44. Investigation Graph

The system shall maintain an investigation graph.

A node may represent:

```text
File
Module
Function
Class
Variable
Field
Type
Schema
API
Route
DatabaseEntity
```

An edge may represent:

```text
defines
calls
called_by
imports
imported_by
references
returns
accepts
reads
writes
exposes
validates
tests
depends_on
```

---

# 45. Investigation Budget

Each session shall have a budget.

The default budget shall be:

```text
Maximum actions:          20
Maximum files:            50
Maximum graph depth:       4
Maximum fuzzy searches:    3
Maximum semantic searches: 3
Maximum graph nodes:     100
Maximum LLM iterations:   10
```

The values shall be configurable.

JEV shall consider the remaining budget.

XState shall enforce hard limits.

---

# 46. Exploration Escalation

The system shall support controlled escalation.

The default discovery sequence should be:

```text
EXACT_SEARCH
    |
    +-- sufficient --> STRUCTURAL ANALYSIS
    |
    +-- insufficient
           |
           v
      FUZZY_SEARCH
           |
           +-- sufficient --> STRUCTURAL ANALYSIS
           |
           +-- insufficient
                  |
                  v
             SEMANTIC_SEARCH
```

JEV may select another sequence when the question requires it.

---

# 47. Safe Removal Investigation

Controlled Mode shall support safe-removal analysis.

Example question:

```text
Can I remove customer_id from this schema?
```

The system should inspect:

```text
Schema
 |
 +-- Definitions
 |
 +-- References
 |
 +-- API requests
 |
 +-- API responses
 |
 +-- Validation
 |
 +-- Callers
 |
 +-- Frontend usage
 |
 +-- Database usage
 |
 +-- Tests
 |
 +-- External interface indicators
```

The final result shall be one of:

```text
SAFE_TO_REMOVE
NOT_SAFE_TO_REMOVE
INSUFFICIENT_EVIDENCE
```

The system shall include evidence for the result.

---

# 48. Absence of Evidence

The system shall not convert limited search results into absolute statements.

The system shall use:

```text
No reference was found in the explored codebase.
```

instead of:

```text
No reference exists.
```

The final answer shall identify investigation limits.

---

# 49. Termination

The investigation shall terminate when one of the following conditions occurs:

```text
EVIDENCE_SUFFICIENT
NO_USEFUL_ACTION
BUDGET_EXCEEDED
DEPTH_EXCEEDED
REPEATED_ACTION
USER_STOP
USER_REQUESTED_ANSWER
REQUIRES_USER_INPUT
FATAL_ERROR
```

JEV shall recommend termination.

XState shall enforce termination.

---

# 50. Event Store

The system shall store an immutable event stream.

The event stream shall contain:

```text
Session events
State events
LLM events
JEV events
Action events
Evidence events
Graph events
Control events
Visualizer events
```

The event stream shall be the source for session history.

The visualizer shall not create an independent execution history.

---

# 51. Event Examples

```json
{
    "type": "STATE_ENTERED",
    "sessionId": "inv_123",
    "state": "FUZZY_SEARCH",
    "timestamp": "2026-10-05T15:20:00Z"
}
```

```json
{
    "type": "JEV_DECISION",
    "sessionId": "inv_123",
    "decision": "ALLOW",
    "capability": "FUZZY_SEARCH",
    "reason": "Exact search returned no suitable result."
}
```

```json
{
    "type": "EVIDENCE_FOUND",
    "sessionId": "inv_123",
    "file": "src/api/appointment.ts",
    "lineStart": 42,
    "lineEnd": 42
}
```

---

# 52. `/decision-visualize`

The system shall provide:

```text
/decision-visualize
```

The command shall open a web interface for the current Controlled session.

The visualizer shall display:

- Current XState state.
- XState graph.
- State transitions.
- JEV decisions.
- LLM proposals.
- Investigation actions.
- Evidence.
- Graph relationships.
- Budget.
- Execution history.
- Current execution speed.
- Session status.

---

# 53. Visualizer Server

The visualizer server shall run locally by default.

The server shall communicate with the Controlled session.

The preferred transport shall be WebSocket.

The visualizer shall receive event updates without page refresh.

---

# 54. Visualizer Main Areas

The web interface shall contain:

```text
Header
State Graph
Current State
Decision Inspector
Evidence Inspector
Execution Timeline
Session Controls
Capability Registry
```

---

# 55. Current State View

The interface shall display:

```text
Current State
State Type
Target
Execution Status
Depth
Budget
JEV Decision
Elapsed Time
```

Example:

```text
Current State: FUZZY_SEARCH
Target: create appointment
Depth: 2 / 4
Budget: 12 / 20 actions
JEV: ALLOW
Status: RUNNING
```

---

# 56. XState Graph View

The interface shall display the current state machine.

The interface shall highlight the current state.

The interface shall display available transitions.

The interface shall display previous transitions.

The interface shall display disabled states.

The interface shall allow the user to select a state.

Selecting a state shall open its configuration.

---

# 57. Execution Timeline

The visualizer shall display the session timeline.

Example:

```text
CLASSIFY
   |
EXACT_SEARCH
   |
JEV_ALLOW
   |
SEARCH_RESULT
   |
LLM_SYNTHESIS
   |
FUZZY_SEARCH
   |
EVIDENCE
```

The user shall be able to select a timeline event.

The interface shall display event details.

---

# 58. Pause Control

The interface shall provide:

```text
PAUSE
```

Pause shall stop further state transitions.

The current state shall remain visible.

The system shall preserve the current context.

---

# 59. Resume Control

The interface shall provide:

```text
RESUME
```

Resume shall continue execution from the current state.

---

# 60. Stop Control

The interface shall provide:

```text
STOP
```

Stop shall terminate the current investigation.

The system shall preserve the session history.

The system shall mark the session as:

```text
STOPPED
```

---

# 61. Step Control

The interface shall provide:

```text
STEP
```

Step shall execute one permitted transition.

The system shall pause after the transition.

The system shall record the transition.

---

# 62. Speed Control

The interface shall provide:

```text
0.25x
0.5x
1x
2x
5x
10x
```

The system shall separate:

```text
Execution Speed
Replay Speed
```

Replay speed shall not change investigation decisions.

Execution speed shall not bypass JEV.

Execution speed shall not bypass XState guards.

---

# 63. Replay

The visualizer shall support session replay.

Replay shall use the event store.

Replay shall reconstruct:

- XState state.
- JEV decisions.
- Evidence.
- Graph state.
- Action history.
- LLM proposals.

Replay shall not execute investigation tools.

---

# 64. Time Travel

The visualizer should allow the user to select a previous event.

The interface shall display the session state at that event.

The system shall not modify the actual active session during normal replay.

---

# 65. Live XState Modification

The visualizer shall support controlled modification of the XState configuration.

The system shall support:

```text
ADD_STATE
REMOVE_STATE
MODIFY_STATE
ADD_TRANSITION
REMOVE_TRANSITION
MODIFY_TRANSITION
DISABLE_STATE
ENABLE_STATE
```

---

# 66. Safe Application of Live Changes

The system shall not immediately destroy an active state.

A change to an active state shall enter:

```text
PENDING_CHANGE
```

The change shall apply at a safe transition boundary.

The system shall record the change as an event.

The system shall show the change in the visualizer.

---

# 67. Add State

The user shall be able to add an XState state.

The user shall provide:

```text
State ID
State category
Input
Output
Allowed transitions
Cost
Depth cost
Capability
```

The system shall validate the state before activation.

---

# 68. Remove State

The user shall be able to request removal of a state.

The system shall check:

- Current state.
- Incoming transitions.
- Outgoing transitions.
- JEV references.
- Capability references.

The system shall reject removal if the state would create an invalid machine.

---

# 69. Live Capability Addition

The system should support adding a capability during development.

Example:

```text
DATABASE_SEARCH
```

The capability shall define:

```text
ID
Category
Input
Output
Cost
Expected information gain
Depth cost
Repeat policy
```

JEV shall receive the updated capability registry.

---

# 70. JEV Inspection

The visualizer shall display JEV decisions.

The user shall be able to inspect:

```text
Decision
Candidate action
Score
Reason
Constraints
Budget
Expected information gain
Cost
Current depth
```

Example:

```text
Decision: ALLOW

Action: FUZZY_SEARCH

Reason:
Exact search returned no suitable candidate.

Expected information gain:
0.71

Cost:
0.20

Depth:
2 / 4
```

---

# 71. LLM Inspection

The visualizer shall display the LLM proposal.

The interface should display:

```text
Question
Current hypothesis
Available evidence
Proposed action
Reason
Expected result
```

The visualizer may provide a compact representation of the LLM context.

The visualizer shall avoid exposing secrets.

---

# 72. User Override

The user shall be able to override a pending investigation action.

Supported overrides shall include:

```text
APPROVE
REJECT
STOP
PAUSE
```

A user override shall be recorded as an event.

A user override shall not silently change the JEV decision.

The event shall identify:

```text
JEV decision
User decision
Final execution decision
```

---

# 73. Modify JEV Policy

The visualizer may provide policy controls.

Example:

```text
Maximum depth: 4 → 6
Maximum actions: 20 → 30
Semantic search threshold: 0.70 → 0.60
```

Policy changes shall be recorded.

The policy change shall apply only to the current session unless the user explicitly saves it as a persistent configuration.

---

# 74. Control Modes

The visualizer shall provide three control modes.

## OBSERVE

The user can inspect the session.

The user cannot change execution.

## CONTROL

The user can:

- Pause.
- Resume.
- Stop.
- Step.
- Change speed.

## MODIFY

The user can:

- Add states.
- Remove states.
- Modify transitions.
- Modify capabilities.
- Modify investigation limits.

The default mode shall be:

```text
OBSERVE
```

---

# 75. Security

The visualizer shall bind to localhost by default.

The visualizer shall not expose the control interface to the network by default.

Remote access shall require explicit configuration.

The visualizer shall not expose:

- API keys.
- Authentication tokens.
- Environment variables.
- Passwords.
- Private credentials.
- Full secret configuration files.

The event store shall apply secret redaction.

---

# 76. Session Isolation

Each visualizer connection shall identify a session.

A user shall not control another session without explicit access.

The system shall reject commands for an unknown session.

---

# 77. Capability Registry

The system shall maintain a capability registry.

The initial registry shall contain:

```text
EXACT_SEARCH
FUZZY_SEARCH
SEMANTIC_SEARCH
FILENAME_SEARCH

AST_SEARCH
AST_FUNCTION
AST_CLASS
AST_SCHEMA
AST_IMPORT
AST_DECORATOR
AST_PARAMETER

SYMBOL_SEARCH
FIND_DEFINITION
FIND_REFERENCES
FIND_CALLERS
FIND_CALLEES
FIND_IMPLEMENTATIONS

ROUTE_SEARCH
ENDPOINT_DEFINITION
REQUEST_SCHEMA
RESPONSE_SCHEMA
VALIDATION
AUTHORIZATION
API_IMPLEMENTATION

CALL_GRAPH
IMPORT_GRAPH
DEPENDENCY_GRAPH
REVERSE_DEPENDENCY
DATA_FLOW
CYCLE_DETECTION

EVIDENCE_CHECK
COVERAGE_CHECK
DUPLICATE_CHECK
CONTRADICTION_CHECK
CONFIDENCE_CHECK
```

---

# 78. Capability Metadata

Each capability shall define:

```ts
interface Capability {
    id: string
    category: string
    cost: number
    depthCost: number
    expectedInformationGain: number
    requires: string[]
    produces: string[]
    canRepeat: boolean
    canCreateGraphEdges: boolean
}
```

---

# 79. Capability Cost

The system shall assign a relative cost to each capability.

Example:

```text
EXACT_SEARCH       = 1
FILENAME_SEARCH    = 1
FUZZY_SEARCH       = 2
AST_SEARCH         = 2
SYMBOL_SEARCH      = 2
REFERENCE_SEARCH   = 3
CALL_GRAPH         = 4
DEPENDENCY_GRAPH   = 5
SEMANTIC_SEARCH    = 7
```

These values are defaults.

JEV may use project-specific values.

---

# 80. State Guards

XState shall support guards for:

```text
HAS_BUDGET
DEPTH_ALLOWED
ACTION_ALLOWED
TARGET_VALID
NOT_DUPLICATE
NOT_ALREADY_EXPLORED
NO_ACTIVE_CONFLICT
USER_NOT_STOPPED
CAPABILITY_AVAILABLE
```

---

# 81. Investigation Context

The XState context shall contain:

```ts
interface InvestigationContext {
    sessionId: string
    question: string
    intent: InvestigationIntent[]
    hypothesis: string | null

    currentAction: InvestigationAction | null

    evidence: Evidence[]

    visitedNodes: string[]
    visitedEdges: string[]

    depth: number

    budget: InvestigationBudget

    decisions: JEVDecision[]

    pendingChanges: RuntimeChange[]

    status: InvestigationStatus
}
```

---

# 82. Duplicate Prevention

The system shall detect duplicate actions.

Example:

```text
FUZZY_SEARCH("appointment")
```

shall not execute repeatedly without a new reason.

JEV may allow a repeated action when:

- The search parameters changed.
- New evidence changed the context.
- The previous action failed.
- The user explicitly requested repetition.

---

# 83. Exploration Loop Protection

The system shall detect repeated state sequences.

Example:

```text
FUZZY_SEARCH
→ SYNTHESIZE
→ FUZZY_SEARCH
→ SYNTHESIZE
```

If no new evidence appears, JEV should recommend termination.

XState shall enforce the configured loop limit.

---

# 84. Contradiction Detection

The verification system shall identify conflicting evidence.

Example:

```text
Evidence A:
customer_id is used by API A.

Evidence B:
customer_id is not referenced in API A.
```

The system shall not select one result silently.

The system shall mark the investigation as requiring verification.

---

# 85. Final Answer

The final answer shall contain, where applicable:

```text
Answer
Evidence
Files
Symbols
Relationships
Confidence
Investigation Scope
Unverified Areas
Recommendation
```

The final answer shall not claim verification for unvisited code.

---

# 86. Example: Find API

User:

```text
Where is the API that creates a VIP appointment?
```

Expected investigation:

```text
CLASSIFY
    ↓
EXACT_SEARCH
    ↓
FUZZY_SEARCH
    ↓
ROUTE_SEARCH
    ↓
FIND_DEFINITION
    ↓
API_IMPLEMENTATION
    ↓
VERIFY
    ↓
ANSWER
```

JEV may skip states when sufficient evidence exists.

---

# 87. Example: Flow Investigation

User:

```text
I have X → Y → Z.
Which API is related to this flow?
```

Expected process:

```text
IDENTIFY X
IDENTIFY Y
IDENTIFY Z
       ↓
SEARCH CANDIDATES
       ↓
BUILD GRAPH
       ↓
TRACE RELATIONSHIPS
       ↓
FIND API
       ↓
VERIFY
```

The system shall identify the strongest verified path.

---

# 88. Example: Safe Field Removal

User:

```text
Can I delete customer_id from this schema?
```

Expected process:

```text
AST_SCHEMA
    ↓
FIND_REFERENCES
    ↓
FIND_CALLERS
    ↓
REQUEST_SCHEMA
    ↓
RESPONSE_SCHEMA
    ↓
FRONTEND_REFERENCES
    ↓
DATABASE_USAGE
    ↓
TEST_USAGE
    ↓
DEPENDENCY_GRAPH
    ↓
VERIFY
    ↓
ANSWER
```

JEV shall skip unnecessary operations.

---

# 89. Visualizer Event Protocol

The visualizer shall use a versioned event protocol.

Example:

```json
{
    "version": 1,
    "type": "STATE_ENTERED",
    "sessionId": "inv_123",
    "timestamp": "2026-10-05T15:20:00Z",
    "payload": {
        "state": "AST_SCHEMA"
    }
}
```

The protocol shall support future event types.

Unknown event types shall not terminate the visualizer.

---

# 90. Visualizer Commands

The browser shall send commands such as:

```text
PAUSE
RESUME
STOP
STEP
SET_SPEED
REPLAY
APPROVE_ACTION
REJECT_ACTION
ADD_STATE
REMOVE_STATE
MODIFY_STATE
ADD_TRANSITION
REMOVE_TRANSITION
MODIFY_TRANSITION
UPDATE_BUDGET
UPDATE_POLICY
```

The runtime shall validate every command.

---

# 91. Runtime Command Validation

The runtime shall not trust browser commands.

The runtime shall validate:

- Session ID.
- Command type.
- Current state.
- User permission.
- State machine validity.
- Capability availability.
- Safety constraints.

---

# 92. State Machine Versioning

Each XState configuration shall have a version.

Example:

```text
machine-v1
machine-v2
machine-v3
```

A live modification shall create a new runtime configuration version.

The event store shall record:

```text
Previous version
New version
Change
User
Timestamp
```

---

# 93. Runtime Modification Example

Initial:

```text
EXACT_SEARCH
      ↓
FUZZY_SEARCH
      ↓
AST_SEARCH
```

User adds:

```text
SYMBOL_SEARCH
```

New:

```text
EXACT_SEARCH
      ↓
SYMBOL_SEARCH
      ↓
FUZZY_SEARCH
      ↓
AST_SEARCH
```

The change shall be recorded as:

```text
STATE_ADDED
TRANSITION_ADDED
MACHINE_VERSION_CHANGED
```

---

# 94. Failure Handling

If an investigation tool fails, XState shall enter an error state.

The system shall record the error.

JEV may select an alternative capability.

Example:

```text
AST_SEARCH
    ↓
FAILED
    ↓
JEV
    ↓
FALLBACK
    ↓
TEXT_SEARCH
```

The system shall not hide tool failures from the user.

---

# 95. LLM Failure

If the LLM fails to produce a valid proposal, the system shall not execute an undefined action.

XState shall enter:

```text
LLM_ERROR
```

The system may retry according to the configured retry policy.

The retry shall be recorded.

---

# 96. JEV Failure

If JEV fails, the system shall not execute the proposed action.

The system shall enter:

```text
DECISION_ERROR
```

The user shall be informed.

---

# 97. XState Failure

If an invalid transition occurs, the system shall stop the affected transition.

The system shall record the failure.

The system shall preserve the previous valid state.

---

# 98. Observability

The system shall expose:

```text
Current state
Previous state
Next allowed states
Current action
JEV decision
LLM proposal
Evidence count
Graph node count
Graph edge count
Current depth
Remaining budget
Elapsed time
```

The visualizer shall update these values during execution.

---

# 99. Logging Levels

The system should support:

```text
ERROR
WARN
INFO
DEBUG
TRACE
```

`TRACE` shall include state transitions and decision events.

---

# 100. Testing Requirements

The extension shall contain unit tests for:

- JEV decisions.
- XState transitions.
- XState guards.
- Capability validation.
- Search capabilities.
- AST capabilities.
- Graph traversal.
- Cycle detection.
- Evidence collection.
- Budget enforcement.
- Duplicate prevention.
- Loop prevention.
- Event serialization.
- Event replay.
- Visualizer commands.
- Live state modification.

---

# 101. Integration Tests

The system shall test complete investigations.

At minimum, the tests shall cover:

```text
Find API
Find function
Find references
Trace X → Y → Z
Safe field removal
Cycle detection
Search escalation
Tool failure
LLM failure
JEV rejection
JEV modification
User stop
Visualizer pause
Visualizer step
Visualizer replay
Live XState modification
```

---

# 102. Acceptance Criteria

Controlled Mode shall be accepted when:

1. The user can select Controlled Mode.
2. The user can ask a codebase question.
3. The LLM can create an investigation proposal.
4. JEV can evaluate the proposal.
5. XState can execute an approved capability.
6. The system can collect evidence.
7. The system can return evidence to the LLM.
8. The system can repeat the investigation loop.
9. The system can stop the loop.
10. The system records the execution history.
11. `/decision-visualize` opens the active session.
12. The visualizer displays the current state.
13. The visualizer displays the execution history.
14. The user can pause execution.
15. The user can resume execution.
16. The user can stop execution.
17. The user can step through execution.
18. The user can change execution speed.
19. The user can inspect JEV decisions.
20. The user can inspect evidence.
21. The system can detect dependency cycles.
22. The system can prevent uncontrolled exploration.
23. The system can enforce investigation budgets.
24. The system can reject invalid XState transitions.
25. The system can preserve the event history.

---

# 103. MVP Boundary

Version 0.1 shall contain:

```text
Controlled Mode
       |
       +-- LLM
       |
       +-- JEV
       |
       +-- XState
       |
       +-- Exact Search
       +-- Fuzzy Search
       +-- AST Search
       +-- Symbol Search
       +-- References
       +-- Callers / Callees
       +-- Basic Graph
       +-- Cycle Detection
       +-- Evidence
       +-- Budget
       +-- Event Store
       |
       +-- /decision-visualize
              |
              +-- State Graph
              +-- Timeline
              +-- JEV Inspector
              +-- Evidence Inspector
              +-- Pause
              +-- Resume
              +-- Stop
              +-- Step
              +-- Speed
              +-- Replay
```

Semantic search may be added after the basic investigation loop is stable.

Live XState modification should be enabled first in development mode.

---

# 104. Future Extensions

Future versions may add:

```text
Code modification
Automatic refactoring
Git integration
Test execution
Build verification
Database inspection
Runtime tracing
Browser tracing
HTTP request tracing
Distributed tracing
Multiple investigation agents
Persistent repository graph
User-defined capabilities
User-defined JEV policies
Shared investigation sessions
Remote visualizer
```

These features are outside version 0.1.

---

# 105. Core System Rule

The following rule is mandatory:

```text
LLM → PROPOSE
JEV → DECIDE
XSTATE → ENFORCE
TOOL → EXECUTE
EVIDENCE → VERIFY
LLM → SYNTHESIZE
```

The LLM shall not bypass JEV.

JEV shall not bypass XState.

XState shall not invent evidence.

Tools shall not decide the final answer.

The final answer shall use verified evidence.

---

# 106. Core Product Concept

Controlled Mode shall behave as a controlled investigation runtime.

It shall not behave as an unrestricted autonomous agent.

The system shall answer:

```text
What should I investigate?
        ↓
Which capability should I use?
        ↓
Is this capability justified?
        ↓
How far should I explore?
        ↓
What evidence did I find?
        ↓
Is the evidence sufficient?
        ↓
What should I investigate next?
```

The system shall expose these decisions to the user through `/decision-visualize`.

The visualizer shall provide a real-time view of the investigation.

The visualizer shall provide a debugger-like interface for the investigation state machine.

The event stream shall provide the historical record.

The XState machine shall provide the execution boundary.

JEV shall provide the exploration boundary.

The LLM shall provide the reasoning layer.

---

# 107. Reference Execution Model

The complete system shall implement the following conceptual loop:

```text
                     ┌─────────────┐
                     │    USER     │
                     └──────┬──────┘
                            │
                            ▼
                     ┌─────────────┐
                     │     LLM     │
                     │  UNDERSTAND │
                     └──────┬──────┘
                            │
                         PROPOSE
                            │
                            ▼
                     ┌─────────────┐
                     │     JEV     │
                     │    DECIDE   │
                     └──────┬──────┘
                            │
                    ALLOW / MODIFY
                            │
                            ▼
                     ┌─────────────┐
                     │   XSTATE    │
                     │   CONTROL   │
                     └──────┬──────┘
                            │
                            ▼
              ┌───────────────────────────┐
              │     CAPABILITY LAYER      │
              │                           │
              │ EXACT      FUZZY          │
              │ SEMANTIC   AST            │
              │ SYMBOL     REFERENCES     │
              │ API        GRAPH          │
              │ CYCLES     VERIFY         │
              └─────────────┬─────────────┘
                            │
                            ▼
                     ┌─────────────┐
                     │   EVIDENCE  │
                     └──────┬──────┘
                            │
                            ▼
                     ┌─────────────┐
                     │     LLM     │
                     │  SYNTHESIZE │
                     └──────┬──────┘
                            │
                            ▼
                         JEV AGAIN
                            │
                            ▼
                         XSTATE
                            │
                            └─────────── LOOP


                  EVENT STREAM
                       │
                       ▼
              /decision-visualize
                       │
       ┌───────────────┼────────────────┐
       │               │                │
     GRAPH          TIMELINE         EVIDENCE
       │               │                │
       └───────────────┼────────────────┘
                       │
                USER CONTROL
                       │
       ┌───────────────┼────────────────┐
       │               │                │
     PAUSE           STEP            STOP
       │               │                │
       └───────────────┼────────────────┘
                       │
                 LIVE MODIFY
                       │
                 XSTATE VERSION
```

# 108. Final Requirement

The extension shall make the investigation process **controlled, explainable, observable, interruptible, and replayable**.

The primary engineering objective shall not be maximum autonomous exploration.

The primary engineering objective shall be:

> **Perform the minimum useful investigation that produces sufficient evidence for a reliable answer.**

