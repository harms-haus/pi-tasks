# pi-tasks

Phased task workflow extension for [pi coding agent](https://github.com/harms-haus/pi-coding-agent). Provides a structured task board with strict status gating, phase-based execution, dependency tracking, auto-continue, and session persistence.

## Features

- **Strict status lifecycle** — tasks progress through an enforced pipeline: `draft` → `configured` → `ready` → `implementing` → `reviewing` → `done`
- **Phase gating** — tasks are grouped into numbered phases; later phases don't become ready until earlier ones complete
- **Dependency tracking** — tasks can depend on other tasks within the same phase; cycles and missing references are detected at compile time
- **Auto-continue** — after each agent turn, the board checks for actionable tasks and automatically prompts the agent to continue (with a configurable circuit breaker)
- **Session persistence** — board state is persisted as snapshot entries in the session tree, so the board survives restarts and session switches
- **Atomic batch edits** — all edits in a single `edit_tasks` call are validated before any are applied; a failure rolls back the entire batch

## Installation

```bash
# npm
npm install pi-tasks

# pi package manager
pi install pi-tasks
```

Or add as a local extension in your project's `.pi/extensions` directory.

### Peer Dependencies

```json
{
  "@earendil-works/pi-ai": "*",
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
  "typebox": "*"
}
```

## Quick Start

The agent uses these tools in sequence. Here's a typical workflow:

```
1. write_tasks     → define tasks with titles, prompts, profiles, and phase numbers
2. edit_tasks      → set dependencies between tasks (type: "blockers")
3. compile_tasks   → validate the board and activate phase 1
4. get_ready_tasks → claim tasks that are ready to work on
5. edit_tasks      → advance tasks: implementing → reviewing → done (type: "advance")
                     (repeat 4–5 until all tasks are done)
```

### Example Session

```
Agent: I'll break this feature into phased tasks.

→ write_tasks: 6 tasks across 3 phases

Task Board:

── Phase 1 (active) ──
○ [task-1] Phase 1 · Set up database schema
○ [task-2] Phase 1 · Create API endpoints
○ [task-3] Phase 1 · Write unit tests for API

── Phase 2 (pending) ──
○ [task-4] Phase 2 · Build frontend components
○ [task-5] Phase 2 · Integration tests

── Phase 3 (pending) ──
○ [task-6] Phase 3 · End-to-end QA

Summary: 6 draft

→ edit_tasks: task-5 blockers → [task-2, task-4]

→ compile_tasks

Task Board:

── Phase 1 (active) ──
● [task-1] Phase 1 · Set up database schema
● [task-2] Phase 1 · Create API endpoints
● [task-3] Phase 1 · Write unit tests for API

── Phase 2 (pending) ──
◔ [task-4] Phase 2 · Build frontend components
◔ [task-5] Phase 2 · Integration tests → depends on [task-2, task-4]

── Phase 3 (pending) ──
◔ [task-6] Phase 3 · End-to-end QA

Summary: 3 ready, 3 configured

→ get_ready_tasks: count 2

Claimed 2 task(s).

─── task-1: Set up database schema ───
Phase: 1
Profile: coder
Prompt:
  Create the database tables for ...

─── task-2: Create API endpoints ───
...

→ edit_tasks: advance task-1 (implementing → reviewing)
→ edit_tasks: advance task-1 (reviewing → done)

... Phase 2 unlocks when all Phase 1 tasks are done ...
```

## Tool Reference

### `write_tasks`

Add tasks to the board. Each task is created in `draft` status.

| Parameter  | Type     | Required | Description                                       |
|------------|----------|----------|---------------------------------------------------|
| `tasks`    | `array`  | Yes      | Array of task objects to add                      |

Each task object:

| Field     | Type     | Required | Description                          |
|-----------|----------|----------|--------------------------------------|
| `title`   | `string` | Yes      | Short task title                     |
| `prompt`  | `string` | Yes      | Detailed implementation instructions |
| `profile` | `string` | Yes      | Agent profile name for delegation    |
| `phase`   | `integer`| Yes      | Phase number (≥ 1)                  |

**Constraints:**
- Maximum 100 tasks per board (`MAX_TASKS`)
- Title, prompt, and profile must be non-empty strings
- Phase must be an integer ≥ 1

### `edit_tasks`

Batch-edit tasks on the board. Supports four edit types. Edits are atomic — if any validation fails, none are applied.

| Parameter | Type    | Required | Description                          |
|-----------|---------|----------|--------------------------------------|
| `tasks`   | `array` | Yes      | Array of edit objects (mixed types)  |

**Type: `data`** — modify task fields

| Field             | Type     | Description                        |
|-------------------|----------|------------------------------------|
| `id`              | `string` | Task ID                            |
| `type`            | `"data"` | Edit type                          |
| `data.title`      | `string` | Optional. New title                |
| `data.prompt`     | `string` | Optional. New prompt               |
| `data.profile`    | `string` | Optional. New profile              |
| `data.phase`      | `integer`| Optional. New phase number (≥ 1)   |

Structural edits (data/blockers) cannot be applied while any task is `implementing` or `reviewing`. Applying a structural edit resets all non-terminal, non-active tasks back to `draft`, requiring a recompile.

**Type: `blockers`** — set task dependencies

| Field                | Type       | Description                     |
|----------------------|------------|---------------------------------|
| `id`                 | `string`   | Task ID                         |
| `type`               | `"blockers"`| Edit type                      |
| `data.dependencies`  | `string[]` | Array of task IDs this task depends on |

Validates against self-dependencies, duplicate entries, and references to non-existent tasks.

**Type: `advance`** — progress task status

| Field  | Type       | Description                                  |
|--------|------------|----------------------------------------------|
| `id`   | `string`   | Task ID                                      |
| `type` | `"advance"`| Edit type                                    |

Advances the task one step: `implementing` → `reviewing` → `done`. Can only be called on tasks in `implementing` or `reviewing` status.

**Type: `abandon`** — mark task as abandoned

| Field  | Type        | Description                          |
|--------|-------------|--------------------------------------|
| `id`   | `string`    | Task ID                              |
| `type` | `"abandon"` | Edit type                            |

Cannot abandon tasks already in `done` or `abandoned` status.

### `compile_tasks`

Validate the board and activate the first phase. Checks for:

- Duplicate task IDs
- Missing dependency references
- Dependency cycles (detected via DFS)

On success, all `draft` tasks move to `configured`. Tasks in the active phase with satisfied dependencies move to `ready`.

Cannot compile while any task is `implementing` or `reviewing`.

### `get_ready_tasks`

Claim ready tasks for implementation. Moves claimed tasks to `implementing` status.

| Parameter | Type      | Required | Description                        |
|-----------|-----------|----------|------------------------------------|
| `count`   | `integer` | Yes      | Number of tasks to claim (≥ 1)    |

Tasks are ordered by phase ascending, then by creation order. Cannot claim while any task is `implementing` or `reviewing`.

Error messages distinguish between:
- **All tasks resolved** — board is complete
- **Active tasks exist** — advance or complete them first
- **Deadlock** — tasks remain but none are actionable; suggests resolving blockers

### `clear_tasks`

Clear the entire board. Removes all tasks, phases, and resets state. Takes no parameters.

## Task Lifecycle

```
draft ──→ configured ──→ ready ──→ implementing ──→ reviewing ──→ done
                              │                                  ↑
                              └─── (any non-terminal) ──→ abandoned
```

| Status         | Icon | Description                                                          |
|----------------|------|----------------------------------------------------------------------|
| `draft`        | `○`  | Initial state after `write_tasks`                                    |
| `configured`   | `◔`  | Validated by `compile_tasks`; awaiting readiness                     |
| `ready`        | `●`  | Phase is active and all dependencies are done; available to claim   |
| `implementing` | `▶`  | Claimed via `get_ready_tasks`; actively being worked on             |
| `reviewing`    | `◇`  | Advanced from `implementing`; awaiting final review                 |
| `done`         | `✓`  | Advanced from `reviewing`; terminal state                           |
| `abandoned`    | `✗`  | Explicitly skipped via `edit_tasks` (type: abandon); terminal state |

Terminal statuses (`done`, `abandoned`) are permanent — tasks in these states cannot be edited or advanced.

## Phases

Tasks are grouped into numbered phases (≥ 1). Phases execute sequentially:

1. **`compile_tasks`** determines the active phase (the lowest-numbered phase with non-terminal tasks).
2. Only tasks in the active phase can transition to `ready` (after their dependencies are satisfied).
3. When all tasks in a phase reach a terminal status, the phase is marked `completed` and the next phase becomes `active`.
4. Pending phases remain locked until all preceding phases complete.

Phase status tracking:

| Phase Status | Meaning                                         |
|--------------|-------------------------------------------------|
| `pending`    | Not yet reached; tasks are locked               |
| `active`     | Current phase; tasks can become ready            |
| `completed`  | All tasks are terminal (`done` or `abandoned`)  |

Phase completion triggers an optional [prompt template](#configuration) and can trigger auto-continue.

## Dependencies

Each task can declare dependencies on other tasks. Dependencies are validated during `compile_tasks` and `edit_tasks` (type: `blockers`):

- **No self-references** — a task cannot depend on itself
- **No duplicates** — each dependency ID must be unique within a task
- **No missing references** — all dependency IDs must exist on the board
- **No cycles** — the dependency graph must be a DAG (validated via DFS cycle detection)

A task becomes `ready` only when:
1. Its phase is active
2. All of its dependencies have status `done`

Tasks with unsatisfied dependencies remain in `configured` even when their phase is active.

## Configuration

Create `.pi/phased-tasks.json` in your project root:

```json
{
  "phaseCompletionPromptTemplate": "Phase {phase} is complete. Review the results and proceed to the next phase."
}
```

| Field                              | Type     | Description                                                        |
|------------------------------------|----------|--------------------------------------------------------------------|
| `phaseCompletionPromptTemplate`    | `string` | Optional. Template for the prompt injected when a phase completes. Use `{phase}` as a placeholder for the phase number. |

The template is resolved by replacing `{phase}` with the completed phase number. If no template is configured, phase completion is detected but no additional prompt is injected.

Configuration is loaded once per session and cached. It resets on `session_tree` events (i.e., when the session branch changes).

## Auto-Continue

After each agent turn (`agent_end` event), the extension checks the board state:

1. **No tasks on the board** → do nothing.
2. **Agent turn was aborted** → do nothing (user interrupted).
3. **Actionable tasks exist** (ready, implementing, or reviewing) → schedule an auto-continue prompt after a 3-second countdown.
4. **Deadlock** (non-terminal tasks but none actionable) → schedule an auto-continue with a deadlock diagnostic.
5. **All tasks terminal** → do nothing.

The auto-continue uses a 3-second countdown timer. In UI mode, a countdown widget is displayed ("⏳ Auto-continuing in Xs..."). Typing anything cancels the countdown. In headless mode, a simple 3-second timeout is used.

### Circuit Breaker

Auto-continue stops after **20 iterations** (`MAX_AUTO_CONTINUE`). When the limit is reached, a visible notice is sent to the user:

> Auto-continue limit reached (20 iterations). Remaining tasks were not resolved. Take over manually.

The counter resets whenever the board is mutated via `setBoard()`.

### Hidden Context

Before each agent turn (`before_agent_start`), the extension injects a hidden context message summarizing the board state: active phase, status counts, claimed tasks, remaining tasks, and recently completed tasks. This keeps the agent informed without consuming visible context.

## Event Persistence

The extension persists two types of custom entries to the session tree:

| Custom Type                  | Purpose                                              |
|------------------------------|------------------------------------------------------|
| `phased-tasks:event`         | Individual workflow events (write, edit, compile, claim, clear) |
| `phased-tasks:snapshot`      | Full board snapshot after each mutation              |

On `session_start` and `session_tree` events, the board is reconstructed by scanning the session branch in reverse for the latest valid snapshot.

## Architecture

```
src/
├── index.ts          # Extension entry point; registers tools, event handlers, and renderers
├── types.ts          # Type definitions, status constants, event types, edit types
├── engine.ts         # Pure functions: board creation, write/compile/edit/claim logic, phase computation
├── state.ts          # Mutable board state, session reconstruction, persistence helpers, UI sync
├── schemas.ts        # TypeBox schemas for tool parameters (extracted from tools.ts)
├── tools.ts          # Tool definitions: execute, renderCall, renderResult
├── events.ts         # Event handlers: session_start, agent_end, before_agent_start, input
├── config.ts         # Configuration loading from .pi/phased-tasks.json
├── formatting.ts     # Plain-text formatting for board display, summaries, and prompts
├── validation.ts     # Input validation, dependency cycle detection, snapshot type guards
└── renderers.ts      # Message renderers for phased-tasks-context and phased-tasks-notice
```

Key design decisions:

- **Engine is pure** — all board transformation functions are side-effect-free and return new snapshots. Mutability is confined to `state.ts`.
- **Validation before mutation** — `applyEdits` and `compileBoard` validate all changes before modifying any state, ensuring atomic batch operations.
- **Phase recomputation is recursive** — advancing the last task in a phase to `done` triggers recursive recomputation, automatically unlocking the next phase and cascading readiness.

## License

MIT
