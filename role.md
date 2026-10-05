
## 1. The fundamental boundary

```text
                 LLM
                  │
                  │ proposes
                  ▼
          ┌─────────────────┐
          │       JEV       │
          │ Decision Model  │
          └────────┬────────┘
                   │
              decision
                   │
                   ▼
          ┌─────────────────┐
          │     XState      │
          │    Controller   │
          └────────┬────────┘
                   │
                execute
                   │
                   ▼
              Capability
                   │
                   ▼
                Evidence
                   │
                   └──────────► LLM
```

### JEV answers:

> **"Should we do this, and under what constraints?"**

### XState answers:

> **"Given that decision, what state are we in, what can happen next, and how do we execute it safely?"**

That distinction should be strict.

---

# 2. JEV responsibilities

JEV is the **investigation decision engine**.

JEV should own **exploration strategy**.

### JEV decides:

| Question | Owner |
|---|---|
| Should we explore? | **JEV** |
| Should we stop? | **JEV** |
| Which capability should we use? | **JEV** |
| Is fuzzy search justified? | **JEV** |
| Should we escalate exact → fuzzy? | **JEV** |
| Should we use semantic search? | **JEV** |
| How deep should graph exploration go? | **JEV** |
| Is another search redundant? | **JEV** |
| Is expected information gain sufficient? | **JEV** |
| Is the exploration budget sufficient? | **JEV** |
| Is the evidence sufficient to answer? | **JEV** |
| Should we investigate another relationship? | **JEV** |
| Should we ask the user? | **JEV** |
| Should we verify a conclusion? | **JEV** |
| Which constraints should apply? | **JEV** |

So JEV operates at the **semantic/strategic level**.

---

# 3. XState responsibilities

XState is the **execution state machine**.

XState should own **runtime control**.

### XState decides/enforces:

| Question | Owner |
|---|---|
| What state are we currently in? | **XState** |
| Is this transition structurally valid? | **XState** |
| What transition is available from this state? | **XState** |
| Has an action completed? | **XState** |
| What happens after success? | **XState** |
| What happens after failure? | **XState** |
| Are we paused? | **XState** |
| Are we stopped? | **XState** |
| Are we waiting for JEV? | **XState** |
| Are we waiting for the LLM? | **XState** |
| Are we waiting for a tool? | **XState** |
| What is the current execution lifecycle? | **XState** |
| Should a pending runtime change apply now? | **XState** |

XState operates at the **operational/runtime level**.

---

# 4. Very important distinction

Do **not** make XState decide:

```text
"Should I perform fuzzy search?"
```

Instead:

```text
JEV:
"FUZZY_SEARCH is justified."

        ↓

XState:
"FUZZY_SEARCH is an allowed transition
from the current execution state."

        ↓

Execute FUZZY_SEARCH
```

Likewise, XState should not decide:

```text
"we have enough evidence."
```

JEV decides that.

XState only handles:

```text
JEV → STOP
```

and transitions the machine into:

```text
COMPLETED
```

---

# 5. Recommended JEV output

JEV should not directly return an XState transition.

It should return an **Investigation Decision**.

```ts
interface JEVDecision {
    decision:
        | "EXPLORE"
        | "VERIFY"
        | "ANSWER"
        | "STOP"
        | "ASK_USER";

    capability?: CapabilityId;

    target?: InvestigationTarget;

    constraints?: InvestigationConstraints;

    reason: string;

    expectedInformationGain?: number;

    cost?: number;

    confidence?: number;
}
```

Example:

```json
{
  "decision": "EXPLORE",
  "capability": "FUZZY_SEARCH",
  "target": {
    "query": "create appointment"
  },
  "constraints": {
    "maxResults": 20,
    "maxDepth": 1
  },
  "reason": "Exact search produced no suitable candidate.",
  "expectedInformationGain": 0.78,
  "cost": 2
}
```

---

# 6. XState then interprets the decision

XState receives:

```text
EXPLORE
FUZZY_SEARCH
```

and determines how to execute it.

For example:

```text
JEV_DECISION
     │
     ▼
┌─────────────┐
│  EXPLORE    │
└──────┬──────┘
       │
       ▼
VALIDATE_DECISION
       │
       ▼
EXECUTE_CAPABILITY
       │
       ▼
WAIT_FOR_RESULT
       │
       ▼
STORE_EVIDENCE
       │
       ▼
REQUEST_NEXT_DECISION
```

---

# 7. XState should have states like these

I would define the machine around **lifecycle**, not investigation techniques.

```text
IDLE
  ↓
UNDERSTANDING
  ↓
LLM_PROPOSAL
  ↓
JEV_DECISION
  ↓
EXECUTING
  ↓
COLLECTING_EVIDENCE
  ↓
EVALUATING
  ↓
LLM_SYNTHESIS
  ↓
JEV_DECISION
  ↓
...
```

And terminal states:

```text
ANSWERING
COMPLETED
STOPPED
WAITING_FOR_USER
FAILED
```

This is much cleaner than making XState itself contain:

```text
FUZZY_SEARCH
AST_SEARCH
SEMANTIC_SEARCH
...
```

as the primary semantic decision system.

Those should be **capabilities**.

---

# 8. Capabilities are separate

This gives you three layers:

```text
JEV
 │
 │ selects
 ▼
Capability
 │
 │ executed by
 ▼
XState
```

For example:

```text
JEV
 │
 │ "use AST_SEARCH"
 ▼
Capability Registry
 │
 │ resolve
 ▼
AST_SEARCH implementation
 │
 ▼
XState EXECUTING
```

The capability itself should not decide whether it should run.

---

# 9. Then where does fuzzy → AST → semantic logic live?

This is the key part.

Do **not** encode this as a hard-coded XState flow:

```text
EXACT
 ↓
FUZZY
 ↓
SEMANTIC
 ↓
AST
```

Instead, expose capabilities and let JEV choose.

For example:

### Situation A

```text
User:
Where is create_appointment?
```

JEV:

```text
EXACT_SEARCH
```

Result:

```text
3 exact matches
```

JEV:

```text
VERIFY
```

No fuzzy search.

---

### Situation B

```text
User:
Where is the appointment creation API?
```

JEV:

```text
EXACT_SEARCH
```

Result:

```text
No useful result
```

JEV:

```text
FUZZY_SEARCH
```

Result:

```text
create_appointment
create_vip_appointment
```

JEV:

```text
AST_SEARCH
```

to distinguish the candidates.

---

### Situation C

```text
No structural candidate exists.
```

JEV:

```text
SEMANTIC_SEARCH
```

This makes the exploration adaptive.

---

# 10. JEV owns exploration depth

This should definitely belong to JEV.

Example:

```text
Current depth: 2
Maximum useful depth: 4
```

JEV decides:

```text
Continue to depth 3.
```

or:

```text
STOP.
```

XState only enforces the runtime constraint:

```text
depth <= configured maximum
```

So:

```text
JEV:
"Depth 3 is useful."

XState:
"Depth 3 is permitted."

```

If JEV says depth 7 but XState has a hard safety limit of 4:

```text
JEV → EXPLORE depth 7
          ↓
XState guard
          ↓
REJECT EXECUTION
```

This is an important distinction:

> **JEV determines what is desirable. XState determines what is executable.**

---

# 11. Cycle detection

Cycle detection should actually have **three responsibilities**.

### Capability

The graph engine detects the cycle.

```text
A → B → C → A
```

### XState

XState records the execution event and moves to the appropriate runtime state.

```text
CYCLE_DETECTED
```

### JEV

JEV decides what the cycle means for the investigation.

For example:

```text
Cycle detected.

JEV:
STOP
```

or:

```text
Cycle detected.

JEV:
CONTINUE with another branch.
```

Therefore:

```text
Graph Engine → detects
XState        → controls
JEV           → decides
```

---

# 12. Budget ownership

Same principle.

### JEV

Determines:

```text
Is this action worth the remaining budget?
```

### XState

Enforces:

```text
actionCount < hardMaximum
```

Example:

```text
Budget remaining: 2

JEV:
"Semantic search is worth the cost."

XState:
"Semantic search costs 3."

XState:
REJECT.
```

This prevents a bad JEV decision from breaking runtime limits.

---

# 13. User controls

Your visualizer controls should belong to XState/runtime.

For example:

```text
Pause
Resume
Stop
Step
Speed
```

These are not JEV decisions.

The user pressing:

```text
PAUSE
```

means:

```text
XState → PAUSED
```

It does not mean:

```text
JEV → STOP
```

Likewise:

```text
STOP
```

from the UI becomes a runtime command.

The event should still be sent to JEV/context if relevant.

---

# 14. Live XState modification

This is also an XState/runtime responsibility.

The user can say:

```text
Add SYMBOL_SEARCH state.
```

The modification system validates:

```text
Is the machine still structurally valid?
```

That is XState territory.

But:

```text
Should SYMBOL_SEARCH be used?
```

remains JEV territory.

So:

```text
Visualizer
    │
    │ add state
    ▼
XState Configuration
    │
    │ valid machine?
    ▼
YES
    │
    ▼
Capability available to JEV
```

JEV may then select it later.

---

# 15. The clean contract

I recommend defining the boundary with exactly these contracts.

## LLM → JEV

```text
InvestigationProposal
```

Means:

> "I think this is the next useful thing to investigate."

---

## JEV → XState

```text
InvestigationDecision
```

Means:

> "This action is justified. Execute it with these constraints."

---

## XState → Capability

```text
ExecutionRequest
```

Means:

> "Execute this approved capability now."

---

## Capability → XState

```text
ExecutionResult
```

Means:

> "This is what the capability found."

---

## XState → JEV

```text
InvestigationContext
```

Means:

> "This is the current state of the investigation."

---

## JEV → LLM

```text
DecisionContext
```

Means:

> "This is what you may consider for the next proposal."

---

# 16. Complete loop

The final architecture becomes:

```text
                         USER
                           │
                           ▼
                         LLM
                           │
                           │ Proposal
                           ▼
                    ┌─────────────┐
                    │     JEV     │
                    │             │
                    │ Should we?  │
                    │ Which one?  │
                    │ How deep?   │
                    │ When stop?  │
                    └──────┬──────┘
                           │
                     Decision
                           │
                           ▼
                    ┌─────────────┐
                    │   XSTATE    │
                    │             │
                    │ Can we?     │
                    │ What state? │
                    │ What next?  │
                    │ Is valid?   │
                    └──────┬──────┘
                           │
                    ExecutionRequest
                           │
                           ▼
                    ┌─────────────┐
                    │ CAPABILITY  │
                    │             │
                    │ AST         │
                    │ Search      │
                    │ Graph       │
                    │ Symbol      │
                    │ API         │
                    └──────┬──────┘
                           │
                       Evidence
                           │
                           ▼
                       XSTATE
                           │
                    Context Update
                           │
                           ▼
                         JEV
                           │
                           ▼
                          LLM
                           │
                           └──── LOOP
```

# 17. The one-line rule

I would put this directly into the specification:

> **JEV decides what the investigation should do; XState controls how the investigation executes it.**

And an even stricter implementation rule:

> **JEV SHALL NOT directly execute capabilities. XState SHALL NOT independently select investigation strategy.**

That gives you a very clean separation between **intelligence/policy** and **runtime/control**.

