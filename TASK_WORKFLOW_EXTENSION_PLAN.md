# Phased Task Workflow Extension Plan

> **Note:** This document is a historical design doc and does not fully reflect the current implementation. Key changes: task IDs use `t-{phase}.{index}` format, 6 tools (advance_tasks extracted from edit_tasks), emoji status icons, `nextTaskId` removed from snapshot, conditional board rendering, double-advance warning detection. See source code for current state.

## Goal

Build a new standalone pi extension package that manages session-scoped tasks with:

- strict task statuses: `draft`, `configured`, `ready`, `implementing`, `reviewing`, `done`, `abandoned`
- numbered phases with hard gating between phases
- explicit dependency tracking between tasks
- enforced workflow progression with no shortcut completion path
- `agent_end` continuation when actionable tasks remain
- future-friendly interoperability with `pi-subagents` via a raw profile string on each task

Do not modify `pi`, `pi-subagents`, or `pi-til-done` while implementing this plan. Build a new package in the workspace root as a separate extension.

## Research Anchors

Use these repos as the implementation scaffold and reference behavior:

- `pi/`
  - extension API, session hooks, and custom session entry support
  - closest upstream examples:
    - `packages/coding-agent/examples/extensions/todo.ts`
    - `packages/coding-agent/examples/extensions/plan-mode/index.ts`
    - `packages/coding-agent/examples/extensions/subagent/index.ts`
- `pi-til-done/`
  - best scaffold for tool registration, state reconstruction, hidden context injection, and `agent_end` auto-continue
- `pi-subagents/`
  - source of the raw `profile` concept and eventual integration target

## Package Shape

Create a new package directory in the workspace root:

- `pi-phased-tasks/`

Use the same packaging pattern as `pi-til-done`:

- `package.json` with `"type": "module"`
- `main` pointing at `src/index.ts`
- `pi.extensions` pointing at `./src/index.ts`
- peer dependency on `@earendil-works/pi-coding-agent`
- peer dependencies for any pi packages referenced by types or renderers
- scripts for `test`, `lint`, `typecheck`, `format`, `format:check`

## File Layout

Create these files and keep responsibilities narrow:

- `src/index.ts`
  - register tools
  - register message renderers
  - register session and agent event handlers
- `src/types.ts`
  - all public and internal type definitions
  - constants and status enums
- `src/engine.ts`
  - pure workflow engine
  - validation, transition rules, dependency/phase recomputation
  - no pi imports in this file except types if unavoidable
- `src/state.ts`
  - module-level in-memory state
  - session reconstruction from custom entries
  - helpers to persist event and snapshot entries
- `src/tools.ts`
  - `write_tasks`
  - `edit_tasks`
  - `compile_tasks`
  - `clear_tasks`
  - `get_ready_tasks`
- `src/events.ts`
  - `session_start`, `session_tree`, `agent_end`, `before_agent_start`, `input`
  - optional UI/widget updates
- `src/formatting.ts`
  - user-facing text summaries for tool output and hidden context
  - task board rendering helpers
- `src/renderers.ts`
  - custom message renderers for any custom messages emitted by hooks
- `src/validation.ts`
  - schema-independent runtime validation helpers
- `src/config.ts`
  - constants and optional config-file loading for phase completion prompt
- `src/__tests__/engine.test.ts`
- `src/__tests__/state.test.ts`
- `src/__tests__/tools.test.ts`
- `src/__tests__/events.test.ts`
- `src/__tests__/validation.test.ts`
- `src/__tests__/helpers/mocks.ts`

## Core Domain Model

Define these types in `src/types.ts`.

### Task Status

```ts
type TaskStatus =
  | "draft"
  | "configured"
  | "ready"
  | "implementing"
  | "reviewing"
  | "done"
  | "abandoned";
```

### Task

```ts
interface TaskRecord {
  id: string;
  title: string;
  prompt: string;
  profile: string;
  phase: number;
  dependencies: string[];
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}
```

### Phase State

```ts
interface PhaseRecord {
  phase: number;
  status: "pending" | "active" | "completed";
  completedAt?: string;
}
```

### Board Snapshot

```ts
interface TaskBoardSnapshot {
  version: 1;
  nextTaskId: number;
  tasks: TaskRecord[];
  phases: PhaseRecord[];
  pendingPhasePrompt?: {
    phase: number;
    message: string;
  };
}
```

### Event Entries

Persist append-only custom entries with these custom types:

- `phased-tasks:event`
- `phased-tasks:snapshot`

Define event union types:

```ts
type TaskWorkflowEvent =
  | { type: "write_tasks"; tasks: Array<{ id: string; title: string; prompt: string; profile: string; phase: number }> }
  | { type: "edit_task_data"; id: string; data: Partial<Pick<TaskRecord, "title" | "prompt" | "profile" | "phase">> }
  | { type: "edit_task_blockers"; id: string; dependencies: string[] }
  | { type: "compile_tasks" }
  | { type: "claim_ready_tasks"; ids: string[] }
  | { type: "advance_task"; id: string; from: "implementing" | "reviewing"; to: "reviewing" | "done" }
  | { type: "abandon_task"; id: string }
  | { type: "clear_tasks" };
```

## Persistence Strategy

Implement the hybrid model the user selected.

### Rule

Every successful mutating operation must append both:

1. one `phased-tasks:event` custom entry with the operation payload
2. one `phased-tasks:snapshot` custom entry with the full normalized board state after the operation

### Why

- custom entries live in session data and follow session branching
- snapshots make resume and tree navigation cheap and deterministic
- events preserve an audit trail for debugging

### Reconstruction Rule

On `session_start` and `session_tree`:

- scan the current branch from newest to oldest
- find the latest valid `phased-tasks:snapshot`
- hydrate in-memory state from that snapshot
- if no snapshot exists, initialize an empty board

Do not reconstruct by replaying all events unless the latest snapshot is absent or invalid.

## ID Assignment

`write_tasks` does not accept ids from the model.

Assign ids internally using monotonic stable strings:

- first task: `task-1`
- second task: `task-2`
- and so on

Persist `nextTaskId` in every snapshot.

## Tool Contracts

Implement exactly these tools.

### `write_tasks({ tasks })`

Input:

```ts
{
  tasks: Array<{
    title: string;
    prompt: string;
    profile: string;
    phase: number;
  }>;
}
```

Behavior:

- validate every item
- assign ids
- initialize `dependencies` to `[]`
- initialize status to `draft`
- append to the existing board; do not replace existing tasks
- return a human-readable summary plus the full board summary

Validation:

- `title`, `prompt`, `profile` must be non-empty trimmed strings
- `phase` must be an integer `>= 1`
- reject more than 100 total tasks on the board in v1

### `edit_tasks({ tasks })`

Input:

```ts
{
  tasks: Array<
    | { id: string; type: "data"; data: { title?: string; prompt?: string; profile?: string; phase?: number } }
    | { id: string; type: "blockers"; data: { dependencies: string[] } }
    | { id: string; type: "advance"; data?: {} }
    | { id: string; type: "abandon"; data?: {} }
  >;
}
```

Batch rule:

- treat the batch as atomic
- if any edit fails validation, apply none of them

#### `type: "data"`

Allowed only when there are no tasks in `implementing` or `reviewing`.

Behavior:

- mutate only `title`, `prompt`, `profile`, `phase`
- after any successful structural edit, set every non-terminal task that is not `implementing` or `reviewing` back to `draft`
- clear all derived `ready` states
- require a subsequent `compile_tasks()` before work can continue

Reason:

- structural edits invalidate the compiled graph and derived readiness

#### `type: "blockers"`

Allowed only when there are no tasks in `implementing` or `reviewing`.

Behavior:

- replace the task’s dependency list with the provided `dependencies`
- reject self-dependencies
- reject references to nonexistent tasks
- after success, set every non-terminal task that is not `implementing` or `reviewing` back to `draft`
- require a subsequent `compile_tasks()` before work can continue

#### `type: "advance"`

Advance exactly one workflow step.

Allowed transitions:

- `implementing -> reviewing`
- `reviewing -> done`

Rejected transitions:

- `draft`, `configured`, `ready`, `done`, `abandoned` cannot be advanced
- no multi-step jumps

When a task advances to `done`:

- recompute dependencies and phase readiness immediately
- if this makes dependent tasks actionable in the active phase, move them to `ready`
- if this completes the phase, mark the phase completed and enqueue one pending phase completion prompt if a template exists

Return value:

- a string summary of tasks advanced and any dependents newly marked `ready`

#### `type: "abandon"`

Allowed from:

- `draft`
- `configured`
- `ready`
- `implementing`
- `reviewing`

Rejected from:

- `done`
- `abandoned`

Behavior:

- set the task to `abandoned`
- recompute phase readiness immediately
- do not treat `abandoned` as satisfying dependencies
- dependents blocked by an abandoned dependency remain blocked until blockers are edited
- if this completes the phase, mark the phase completed and enqueue one pending phase completion prompt if a template exists

### `compile_tasks()`

Behavior:

- fail if any task is currently `implementing` or `reviewing`
- validate all task records and all dependencies
- reject duplicate ids
- reject empty board with a clear message
- reject dependency cycles across the currently defined task graph
- move every `draft` task to `configured`
- recompute all phases and all derived ready states

Ready-state recomputation rules:

1. determine the first phase that still contains any non-terminal tasks
2. mark that phase as `active`
3. mark all earlier phases `completed`
4. mark all later phases `pending`
5. within the active phase:
   - a task becomes `ready` only if its current status is `configured` and all dependencies are `done`
   - tasks blocked by `abandoned` dependencies remain `configured`
6. tasks in later phases must remain `configured` even if all dependencies are `done`

### `clear_tasks()`

Behavior:

- clear the entire board
- reset `nextTaskId` to `1`
- clear any pending phase prompt
- append event and snapshot entries

This is the only reset tool. Do not overload `write_tasks` with a replace mode.

### `get_ready_tasks({ count })`

Input:

```ts
{ count: number }
```

Behavior:

- fail if `count < 1`
- fail if any task is `implementing` or `reviewing`
- gather tasks in `ready`, ordered by:
  1. phase ascending
  2. creation order ascending
- return up to `count`
- auto-claim the returned tasks by moving them to `implementing`
- append event and snapshot entries for the claim

Failure modes:

- if there are no `ready` tasks but non-terminal tasks remain, fail with a deadlock message instructing the agent to inspect dependencies or phase gating using `edit_tasks`
- if all tasks are terminal, fail with a done message instead of returning an empty array

Output requirements:

- return a concise summary plus a machine-readable details object that includes each selected task’s `id`, `title`, `prompt`, `profile`, and `phase`
- include explicit instruction text that the agent must review and then `advance` each claimed task instead of skipping directly to done

Do not make `get_ready_tasks` insert any hidden context or auto-spawn subagents. The tool should remain decoupled from `pi-subagents`.

## Workflow Enforcement Rules

The workflow engine in `src/engine.ts` must be the single source of truth for all status transitions.

### Allowed Status Sources

- `draft`
  - only from `write_tasks`
  - also from structural edits that invalidate the compiled graph
- `configured`
  - only from `compile_tasks`
  - or from recomputation that demotes stale `ready` tasks
- `ready`
  - only from recomputation
- `implementing`
  - only from `get_ready_tasks`
- `reviewing`
  - only from `edit_tasks advance`
- `done`
  - only from `edit_tasks advance`
- `abandoned`
  - only from `edit_tasks abandon`

### Explicitly Forbidden

- no tool may move a task directly to `done`
- no tool may move a task from `ready` to `reviewing`
- no tool may move a task from `reviewing` back to `implementing`
- no tool may auto-finish a task on behalf of the agent

## Dependency Semantics

Dependencies are always internal task ids.

Rules:

- dependencies may point to tasks in the same phase or earlier phases
- dependencies may not point to nonexistent tasks
- dependencies may not include the task itself
- cycles are rejected by `compile_tasks`
- a dependency is satisfied only when the dependency task is `done`
- `abandoned` does not satisfy dependencies

Do not add non-task manual blockers in v1.

## Phase Semantics

Phase behavior must be impermeable.

Rules:

- only one phase may be active at a time
- a later phase cannot produce `ready` tasks until the current active phase is fully terminal
- a phase is terminal when all tasks in that phase are `done` or `abandoned`
- when a phase becomes terminal, mark it `completed`
- once a phase is completed, activate the next phase containing any non-terminal tasks

## Phase Completion Prompt

Implement a single global optional prompt template in `src/config.ts`.

Configuration source for v1:

- project-local JSON file at `.pi/phased-tasks.json`

Config shape:

```json
{
  "phaseCompletionPromptTemplate": "Phase {phase} is complete. Commit the changes from this phase before moving on."
}
```

Behavior:

- when a phase completes, resolve the template by replacing `{phase}` with the completed phase number
- store the resulting message in `pendingPhasePrompt` inside the snapshot
- do not immediately trigger a turn from the tool execution itself
- on the next `agent_end`, prepend this phase completion prompt to the continuation message, then clear it in memory and persist the cleared snapshot on the next state mutation

If the config file is missing or invalid, proceed with no phase completion prompt.

## Event Hooks

Implement these handlers in `src/events.ts`.

### `session_start`

- reconstruct state from the latest snapshot on the current branch
- update any UI status/widget

### `session_tree`

- reconstruct state from the latest snapshot on the newly selected branch
- update any UI status/widget

### `before_agent_start`

Inject one hidden custom message when the board is non-empty.

The hidden message must include:

- active phase
- counts by status
- currently claimed tasks in `implementing` or `reviewing`
- reminder of the enforced workflow

If a `pendingPhasePrompt` exists, include it at the top of this hidden message.

Do not dump the entire task board when it is large. Cap the hidden summary to:

- all non-terminal tasks
- plus at most 10 recently completed or abandoned tasks

### `agent_end`

Implement the continuation policy from the user requirements.

If any tasks are in `ready`, `implementing`, or `reviewing`:

- auto-send a follow-up user message instructing the agent to continue until the tasks are resolved
- if `pendingPhasePrompt` exists, include it before the continuation instructions

If no tasks are in `ready`, `implementing`, or `reviewing`, but there are non-terminal tasks left:

- auto-send a follow-up user message stating that the board is blocked and the agent must edit task dependencies or phases to resolve the deadlock

If all tasks are terminal:

- do nothing

Guardrails:

- copy the circuit-breaker pattern from `pi-til-done`
- add a max auto-continue count constant
- do not auto-continue if the last assistant message was aborted

### `input`

If the user types while an auto-continue countdown is pending:

- cancel the countdown

Mirror the countdown cancellation pattern from `pi-til-done`.

## UI and Rendering

Keep the UI thin in v1.

### Status Bar

Publish two status keys:

- `phased-tasks`
  - example: `Phase 2 · 5/12 done`
- `phased-tasks-active`
  - newline-separated currently claimed tasks

### Countdown Widget

Reuse the `pi-til-done` countdown behavior for auto-continue.

### Custom Message Renderers

Register renderers for:

- hidden task context messages
- completion/deadlock notices if you emit them as visible custom messages

Do not build a custom complex widget in v1.

## Engine API

`src/engine.ts` must expose pure functions only. Minimum API:

```ts
createEmptyBoard(): TaskBoardSnapshot;
writeTasks(board, inputTasks, now): TaskBoardSnapshot;
applyEdits(board, edits, now): TaskBoardSnapshot;
compileBoard(board, now): TaskBoardSnapshot;
claimReadyTasks(board, count, now): { board: TaskBoardSnapshot; claimed: TaskRecord[] };
getStatusCounts(board): Record<TaskStatus, number>;
getActivePhase(board): number | null;
getReadyTasks(board): TaskRecord[];
hasActionableTasks(board): boolean;
hasBlockedNonTerminalTasks(board): boolean;
```

Every mutating function must:

- return a fully normalized board
- recompute phases and derived statuses as needed
- never mutate the input board in place

## Validation Rules

Centralize runtime validation in `src/validation.ts`.

Validate:

- task strings are trimmed and non-empty
- phase is integer `>= 1`
- dependency ids are unique per task
- task ids are unique board-wide
- no self-dependency
- no cycles at compile time
- no edits to unknown ids
- no structural edits while tasks are `implementing` or `reviewing`
- `advance` only from valid predecessor statuses

## Testing Requirements

Match the structure used in `pi-til-done`.

### `engine.test.ts`

Cover at minimum:

- write creates draft tasks with stable ids
- compile turns draft into configured then ready where appropriate
- compile rejects cycles
- compile rejects invalid dependency ids
- later phases remain configured until prior phase is terminal
- `done` on a dependency makes dependents ready
- `abandoned` leaves dependents blocked
- structural edit resets non-terminal tasks back to draft
- advance only allows `implementing -> reviewing -> done`
- abandon allowed from non-terminal statuses only

### `state.test.ts`

Cover at minimum:

- reconstruction from latest snapshot
- reconstruction respects branch-local latest snapshot
- missing snapshot yields empty board
- event and snapshot append helpers produce correct entry types

### `tools.test.ts`

Cover at minimum:

- tool argument validation
- `get_ready_tasks` auto-claims
- `get_ready_tasks` fails when implementing/reviewing tasks exist
- `get_ready_tasks` fails with deadlock message when no ready tasks exist
- `clear_tasks` resets board

### `events.test.ts`

Cover at minimum:

- `agent_end` auto-continues when ready tasks exist
- `agent_end` auto-continues when reviewing or implementing tasks exist
- `agent_end` sends deadlock repair prompt when blocked tasks remain
- `agent_end` does nothing when all tasks are terminal
- aborted assistant messages suppress auto-continue
- countdown is cancelled on user input

### `validation.test.ts`

Cover at minimum:

- empty strings rejected
- invalid phase rejected
- self-dependency rejected
- duplicate dependency rejected
- duplicate task id rejected

## Implementation Order

Follow this order exactly to minimize rework.

1. Create package scaffold and `package.json`.
2. Implement `src/types.ts` and `src/validation.ts`.
3. Implement `src/engine.ts` as a pure module.
4. Write engine tests and make them pass before touching hooks.
5. Implement `src/state.ts` with snapshot reconstruction and append helpers.
6. Implement `src/tools.ts` against the engine.
7. Implement `src/events.ts` with `session_start`, `session_tree`, `before_agent_start`, `agent_end`, and `input`.
8. Add `src/formatting.ts` and `src/renderers.ts` only after tool behavior is stable.
9. Wire everything in `src/index.ts`.
10. Add event and tool tests.
11. Run `test`, `typecheck`, and `lint`.

## Non-Goals for V1

Do not add these in the first implementation:

- direct integration with `delegate_to_subagents`
- per-phase custom prompt overrides
- external non-task blockers
- reopen or rollback transitions
- UI for editing tasks outside tool calls
- auto-commits or git integration

## Acceptance Criteria

The extension is complete when all of the following are true:

- tasks persist in session data and survive resume/tree navigation
- phases are strictly gated
- dependencies are enforced
- no task can skip statuses
- `get_ready_tasks` auto-claims and refuses to run while work is already in progress
- `agent_end` keeps the agent moving until the board is terminal or blocked
- blocked boards trigger dependency-repair instructions instead of silent failure
- the package can be loaded by pi as a standalone extension
- the test suite covers the workflow invariants listed above

## Recommended Starting Point

When implementation begins, copy the package structure and test wiring style from `pi-til-done`, but do not copy its flat todo semantics. Replace the todo-specific state machine with the pure engine described above, and keep `profile` as an opaque string so later versions can hand claimed tasks to `pi-subagents` without redesigning the task schema.