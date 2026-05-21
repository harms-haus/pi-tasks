# pi-tasks Implementation Plan

> **Note:** This document is a historical design doc and does not fully reflect the current implementation. Key changes: task IDs use `t-{phase}.{index}` format, 6 tools (advance_tasks extracted from edit_tasks), emoji status icons, `nextTaskId` removed from snapshot, conditional board rendering, double-advance warning detection. See source code for current state.
>
> The original divergence notes remain below for reference.
>
> **Note: This plan reflects the original design. The implementation diverged in several areas.**
> Key divergences are noted inline with `[IMPLEMENTATION DIVERGENCE]` markers. See the source code for the current canonical behavior.
>
> **Summary of major divergences:**
>
> 1. **Task IDs**: Format is `t-{phase}.{index}` (phase-relative), not `task-N` monotonic. No `nextTaskId` field in `TaskBoardSnapshot`.
> 2. **6 tools** instead of 5: `advance_tasks` is a separate tool, not an `edit_tasks` type.
> 3. **`edit_tasks` has 3 types**: `data`, `blockers`, `abandon` — no `advance`.
> 4. **Emoji status icons** instead of plain-text characters.
> 5. **`src/schemas.ts`** extracted from `tools.ts` for TypeBox schema definitions.
> 6. **Additional state tracking** in `state.ts`: `lastToolWasAdvance`, `advanceWarningPending` for review-skip detection.
> 7. **`tool_result` event handler** in `events.ts` (6 handlers total, not 5).
> 8. **Conditional board rendering**: `formatBoardText` accepts `{ activePhaseOnly }` option.
> 9. **Truncated claimed-task output**: `formatClaimedTaskDetails` shows first 3 lines of prompt.
> 10. **`isValidTaskRecord`** not implemented in `validation.ts`.
> 11. **`getActivePhase` and `getReadyTasks`** not implemented in `engine.ts`.
> 12. **Engine tests split** across 4 files: `engine-write.test.ts`, `engine-compile.test.ts`, `engine-edits.test.ts`, `engine-queries.test.ts`.
> 13. **Additional test files**: `config.test.ts`, `index.test.ts`, `renderers.test.ts` not in original plan.

## Overview

Build `pi-tasks`, a standalone pi extension for session-scoped phased task management with strict status gating, dependency tracking, and auto-continuation. The package lives at `/home/blake/Documents/software/pi-extensions/pi-tasks/`.

All paths below are relative to that root.

---

## Step 1: Package Scaffold

### Files to Create

- `package.json`
- `tsconfig.json`
- `vitest.config.ts`
- `eslint.config.js`

### What to Implement

#### `package.json`

Mirror the structure from `pi-til-done/package.json` exactly, with these specific values:

```json
{
  "name": "pi-tasks",
  "version": "0.1.0",
  "description": "pi-coding-agent extension: phased task workflow with dependency tracking and strict status gating",
  "keywords": ["pi-package"],
  "type": "module",
  "main": "src/index.ts",
  "pi": {
    "extensions": ["./src/index.ts"]
  },
  "files": ["src/**/*.ts", "!src/__tests__/**", "docs/", "README.md", "CHANGELOG.md", "LICENSE"],
  "scripts": {
    "lint": "eslint src/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "format": "prettier --write src/",
    "format:check": "prettier --check src/",
    "typecheck": "tsc --noEmit",
    "lint:fix": "eslint --fix src/"
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^3.2.4",
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^10.1.8",
    "prettier": "^3.0.0",
    "typescript": "^5.0.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^3.0.0"
  },
  "author": "harms-haus",
  "engines": {
    "node": ">=20.0.0"
  },
  "license": "MIT"
}
```

#### `tsconfig.json`

Copy exactly from `pi-til-done`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

#### `vitest.config.ts`

Copy exactly from `pi-til-done`, with `setupFiles: ["src/__tests__/setup.ts"]`.

#### `eslint.config.js`

Copy exactly from `pi-til-done/eslint.config.js`.

### Acceptance Criteria

- `npm install` succeeds (installs dev deps; peer deps expected to be missing)
- `npx tsc --noEmit` succeeds on an empty `src/` directory
- `npx vitest run` reports no tests found (not an error)

### Dependencies

None — this is the first step.

---

## Step 2: Types and Constants

### Files to Create

- `src/types.ts`

### What to Implement

Define all types and constants in one file. No imports from pi packages.

```ts
// ── Status ──

export type TaskStatus =
  | "draft"
  | "configured"
  | "ready"
  | "implementing"
  | "reviewing"
  | "done"
  | "abandoned";

// ── Domain Records ──

export interface TaskRecord {
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

export interface PhaseRecord {
  phase: number;
  status: "pending" | "active" | "completed";
  completedAt?: string;
}

// ── Board Snapshot ──

// [IMPLEMENTATION DIVERGENCE] No `nextTaskId` field. IDs are computed as `t-{phase}.{index}` at write time.
export interface TaskBoardSnapshot {
  version: 1;
  tasks: TaskRecord[];
  phases: PhaseRecord[];
  pendingPhasePrompt?: {
    phase: number;
    message: string;
  };
}

// ── Event Types ──

export type TaskWorkflowEvent =
  | {
      type: "write_tasks";
      tasks: Array<{ id: string; title: string; prompt: string; profile: string; phase: number }>;
    }
  | {
      type: "edit_task_data";
      id: string;
      data: Partial<Pick<TaskRecord, "title" | "prompt" | "profile" | "phase">>;
    }
  | { type: "edit_task_blockers"; id: string; dependencies: string[] }
  | { type: "compile_tasks" }
  | { type: "claim_ready_tasks"; ids: string[] }
  | {
      type: "advance_task";
      id: string;
      from: "implementing" | "reviewing";
      to: "reviewing" | "done";
    }
  | { type: "abandon_task"; id: string }
  | { type: "clear_tasks" };

// ── Edit Input Types ──

export interface DataEdit {
  id: string;
  type: "data";
  data: { title?: string; prompt?: string; profile?: string; phase?: number };
}

export interface BlockersEdit {
  id: string;
  type: "blockers";
  data: { dependencies: string[] };
}

export interface AdvanceEdit {
  id: string;
  type: "advance";
  data?: {};
}

export interface AbandonEdit {
  id: string;
  type: "abandon";
  data?: {};
}

export type TaskEdit = DataEdit | BlockersEdit | AdvanceEdit | AbandonEdit;

// ── Constants ──

export const MAX_TASKS = 100;
export const MAX_AUTO_CONTINUE = 20;

export const CUSTOM_EVENT_TYPE = "phased-tasks:event";
export const CUSTOM_SNAPSHOT_TYPE = "phased-tasks:snapshot";

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["done", "abandoned"]);
export const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set(["implementing", "reviewing"]);
export const ALL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "draft",
  "configured",
  "ready",
  "implementing",
  "reviewing",
  "done",
  "abandoned",
]);

// [IMPLEMENTATION DIVERGENCE] Uses emoji icons instead of plain-text characters.
/** Status → icon character */
export const STATUS_ICONS: Record<TaskStatus, string> = {
  draft: "⚪",
  configured: "🔵",
  ready: "🟢",
  implementing: "▶️",
  reviewing: "🔍",
  done: "✅",
  abandoned: "❌",
};
```

### Acceptance Criteria

- File contains zero imports from external packages
- All types listed in the plan's "Core Domain Model" section are defined
- All constants are exported and typed
- `npx tsc --noEmit` passes

### Dependencies

Step 1 (scaffold must exist for TS resolution)

---

## Step 3: Validation Helpers

### Files to Create

- `src/validation.ts`

### What to Implement

Pure functions with no pi imports. Import types from `./types`.

```ts
import type { TaskRecord, TaskStatus, TaskBoardSnapshot } from "./types";
import { TERMINAL_STATUSES, ACTIVE_STATUSES } from "./types";

// [IMPLEMENTATION DIVERGENCE] `isValidTaskRecord` was never implemented.
// [IMPLEMENTATION DIVERGENCE] `getStatusCounts` was moved here from engine.ts.
// [IMPLEMENTATION DIVERGENCE] `hasActiveTasks` and `hasNonTerminalTasks` are private (not exported).

// ── String Validation ──

/** Returns true if the value is a non-empty trimmed string. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ── Phase Validation ──

/** Returns true if the value is an integer >= 1. */
export function isValidPhase(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

// ── Task Validation ──

// [IMPLEMENTATION DIVERGENCE] `isValidTaskRecord` was never implemented.
// It was planned but omitted during implementation.

// ── Dependency Validation ──

/** Returns true if a task's dependencies have no self-reference. */
export function hasSelfDependency(taskId: string, dependencies: string[]): boolean {
  return dependencies.includes(taskId);
}

/** Returns true if the dependencies array has duplicates. */
export function hasDuplicateDependencies(dependencies: string[]): boolean {
  return new Set(dependencies).size !== dependencies.length;
}

/** Returns the set of dependency ids that don't exist in the task id set. */
export function findMissingDependencies(
  dependencies: string[],
  existingIds: Set<string>,
): string[] {
  return dependencies.filter((d) => !existingIds.has(d));
}

// ── Cycle Detection ──

/**
 * Detect cycles in the task dependency graph using DFS.
 * Returns an array of task ids forming a cycle, or empty array if acyclic.
 */
export function detectCycle(tasks: TaskRecord[]): string[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const t of tasks) color.set(t.id, WHITE);

  const path: string[] = [];

  function dfs(id: string): string[] | null {
    color.set(id, GRAY);
    path.push(id);
    const task = taskMap.get(id);
    if (task) {
      for (const dep of task.dependencies) {
        const depColor = color.get(dep);
        if (depColor === GRAY) {
          // Found cycle — extract cycle path
          const cycleStart = path.indexOf(dep);
          return path.slice(cycleStart);
        }
        if (depColor === WHITE) {
          const cycle = dfs(dep);
          if (cycle) return cycle;
        }
      }
    }
    path.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const t of tasks) {
    if (color.get(t.id) === WHITE) {
      const cycle = dfs(t.id);
      if (cycle) return cycle;
    }
  }

  return [];
}

// ── Board State Checks ──

// [IMPLEMENTATION DIVERGENCE] These are private (not exported).
/** Returns true if any task is in implementing or reviewing. */
function hasActiveTasks(board: TaskBoardSnapshot): boolean {
  return board.tasks.some((t) => ACTIVE_STATUSES.has(t.status));
}

/** Returns true if any task is in a non-terminal state. */
function hasNonTerminalTasks(board: TaskBoardSnapshot): boolean {
  return board.tasks.some((t) => !TERMINAL_STATUSES.has(t.status));
}

/** Returns true if there are tasks in ready, implementing, or reviewing. */
export function hasActionableTasks(board: TaskBoardSnapshot): boolean {
  return board.tasks.some((t) => t.status === "ready") || hasActiveTasks(board);
}

/** Returns true if there are non-terminal tasks but none are actionable (deadlock). */
export function hasBlockedNonTerminalTasks(board: TaskBoardSnapshot): boolean {
  return hasNonTerminalTasks(board) && !hasActionableTasks(board);
}

// ── Snapshot Validation ──

// [IMPLEMENTATION DIVERGENCE] Does NOT check `nextTaskId` (field was removed).
/** Type guard for a valid TaskBoardSnapshot. Checks version field and basic structure. */
export function isValidSnapshot(data: unknown): data is TaskBoardSnapshot {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return obj.version === 1 && Array.isArray(obj.tasks) && Array.isArray(obj.phases);
}

// ── Status Counts ──

// [IMPLEMENTATION DIVERGENCE] Moved here from the planned engine.ts location.
/** Counts tasks by status. Returns a fully-populated Record with all statuses (zero if absent). */
export function getStatusCounts(board: TaskBoardSnapshot): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = {
    draft: 0,
    configured: 0,
    ready: 0,
    implementing: 0,
    reviewing: 0,
    done: 0,
    abandoned: 0,
  };
  for (const t of board.tasks) {
    counts[t.status]++;
  }
  return counts;
}

// ── Deep Clone ──

/** Creates a deep copy of a TaskBoardSnapshot. */
export function cloneBoard(board: TaskBoardSnapshot): TaskBoardSnapshot {
  return JSON.parse(JSON.stringify(board));
}
```

### Acceptance Criteria

- No imports from pi packages
- All functions are pure (no side effects, no mutation of inputs)
- `isNonEmptyString` rejects empty, whitespace-only, and non-string values (but accepts strings with leading/trailing whitespace)
- `isValidPhase` rejects non-integers, 0, and negative numbers
- `hasSelfDependency` detects self-refs
- `hasDuplicateDependencies` detects duplicate deps
- `detectCycle` returns non-empty array for cyclic graphs and empty array for acyclic
- `isValidSnapshot` validates version, tasks, and phases fields (does NOT check `nextTaskId`)
- [IMPLEMENTATION DIVERGENCE] `isValidTaskRecord` was never implemented
- `getStatusCounts` is defined here (moved from engine.ts)
- `cloneBoard` produces a structurally equal but referentially distinct copy
- `npx tsc --noEmit` passes

### Dependencies

Step 2 (types.ts)

---

## Step 4: Pure Workflow Engine

### Files to Create

- `src/engine.ts`

### What to Implement

Pure functions only. No pi imports. Import types and constants from `./types` and validation helpers from `./validation`.

> **[IMPLEMENTATION DIVERGENCE]** `getActivePhase` and `getReadyTasks` were never implemented. `getStatusCounts`, `hasActionableTasks`, `hasBlockedNonTerminalTasks` are re-exported from `./validation`.

Implement this API:

```ts
export function createEmptyBoard(): TaskBoardSnapshot;
export function writeTasks(
  board: TaskBoardSnapshot,
  inputTasks: Array<{ title: string; prompt: string; profile: string; phase: number }>,
  now: string,
): TaskBoardSnapshot;
export function applyEdits(
  board: TaskBoardSnapshot,
  edits: TaskEdit[],
  now: string,
): TaskBoardSnapshot;
export function compileBoard(board: TaskBoardSnapshot, now: string): TaskBoardSnapshot;
export function claimReadyTasks(
  board: TaskBoardSnapshot,
  count: number,
  now: string,
): { board: TaskBoardSnapshot; claimed: TaskRecord[] };
// [IMPLEMENTATION DIVERGENCE] These are re-exported from ./validation, not defined here:
export { hasActionableTasks, hasBlockedNonTerminalTasks, getStatusCounts } from "./validation";
// [IMPLEMENTATION DIVERGENCE] These were never implemented:
// export function getActivePhase(board: TaskBoardSnapshot): number | null;
// export function getReadyTasks(board: TaskBoardSnapshot): TaskRecord[];
```

#### `createEmptyBoard`

- Return `{ version: 1, tasks: [], phases: [], pendingPhasePrompt: undefined }`
  > **[IMPLEMENTATION DIVERGENCE]** No `nextTaskId` field.

#### `writeTasks`

- Validate each input: title, prompt, profile must pass `isNonEmptyString` (trim all string inputs before validation); phase must pass `isValidPhase`
- Validate total board tasks would not exceed `MAX_TASKS` (100)
- > **[IMPLEMENTATION DIVERGENCE]** IDs use phase-relative format: `t-{phase}.{index}` where `index` is the count of existing tasks in that phase + 1. Was planned as monotonic `"task-1"`, `"task-2"` using `board.nextTaskId`.
- Each new task gets `dependencies: []`, `status: "draft"`, `createdAt: now`, `updatedAt: now`
- > **[IMPLEMENTATION DIVERGENCE]** No `nextTaskId` to increment — IDs are deterministic from phase and existing task count.
- Do NOT recompute phases (tasks are still `draft` — phases are computed at compile time)
- Return new board (do not mutate input)

#### `applyEdits`

- Treat batch as atomic: if any edit fails validation, throw an Error with a descriptive message — do NOT apply any of them
- First pass: validate all edits without mutating
  - `type: "data"`: verify id exists, reject if any task on the board is implementing/reviewing
  - `type: "blockers"`: verify id exists, reject self-dependencies, reject references to nonexistent tasks, reject if any task on the board is implementing/reviewing
  - `type: "advance"`: verify id exists, verify current status is `"implementing"` (→ move to `"reviewing"`) or `"reviewing"` (→ move to `"done"`)
  - `type: "abandon"`: verify id exists, reject if current status is `"done"` or `"abandoned"`
- Second pass: apply all edits to a cloned board
- For `type: "data"` or `type: "blockers"` edits: after applying, set every non-terminal task that is NOT implementing/reviewing back to `draft`
- For `type: "advance"` to `"done"`: after advancing, call `recomputePhasesAndReadiness` (see below)
- For `type: "abandon"`: after abandoning, call `recomputePhasesAndReadiness`
- Return new board

#### `compileBoard`

- Fail (throw Error) if any task is `implementing` or `reviewing`
- Fail if board has no tasks
- Validate all tasks: reject duplicate ids, validate all dependency ids exist on the board, detect cycles via `detectCycle`
- Move every `draft` task to `configured`
- Call `recomputePhasesAndReadiness`
- Return new board

#### `recomputePhasesAndReadiness` (internal helper)

This function is called internally by `compileBoard`, `applyEdits` (after advance-to-done and abandon), and itself. Algorithm:

1. Collect all unique phase numbers from non-terminal tasks
2. Sort phases ascending
3. If there are no non-terminal tasks: mark all phases as `completed`, return
4. Determine `activePhase` = the first phase number from the sorted list that still contains any non-terminal task
5. Build new `phases` array:
   - For each phase number present in any task (terminal or not):
     - phase < activePhase → `{ phase, status: "completed", completedAt: <existing completedAt from old board, or now if newly completed> }`
     - phase === activePhase → `{ phase, status: "active" }`
     - phase > activePhase → `{ phase, status: "pending" }`
6. Recompute ready states within the active phase:
   - For each task in the active phase with status `configured`:
     - If ALL dependencies are tasks with status `done` → set task to `ready`
     - Otherwise → task stays `configured`
   - Tasks in later phases remain `configured` even if dependencies are `done`
7. Check if the active phase just became terminal (all tasks `done` or `abandoned`):
   - If yes, mark phase as `completed` with `completedAt: now`
   - If a `pendingPhasePrompt` template exists in config, resolve it and store in `pendingPhasePrompt`
   - Recurse to recompute the next active phase (if any non-terminal tasks remain in later phases)

Note: config loading is in `config.ts`. The engine should accept a `phaseCompletionPromptTemplate: string | undefined` parameter or access it via a function argument. To keep the engine pure, pass the template string as an optional parameter to `compileBoard` and `applyEdits`. Alternatively, have the engine return whether a phase completed, and let the caller handle prompt generation. **Chosen approach**: The engine returns the board with the phase marked completed. Phase prompt generation is handled by the caller (tools.ts) using the config module. The engine does NOT need to know about config.

Revised: The engine's `recomputePhasesAndReadiness` sets `pendingPhasePrompt` to `{ phase, message: "" }` (empty message) when a phase completes. The caller (tools.ts) resolves the template and fills in the message. Actually, to keep it simplest: the engine just marks phases. Tools.ts checks if a phase just transitioned to completed and sets `pendingPhasePrompt`.

**Final decision on phase prompt in engine**: The engine does NOT handle phase completion prompts. It only updates `PhaseRecord.status` and `PhaseRecord.completedAt`. The `pendingPhasePrompt` field remains untouched by the engine. The caller (in tools.ts) compares before/after phases to detect a newly completed phase and sets `pendingPhasePrompt` accordingly.

NOTE: `recomputePhasesAndReadiness` must receive the old board to preserve `completedAt` timestamps for phases that were already completed. For phases newly transitioning to completed (from active → completed), use the `now` parameter as `completedAt`.

#### `claimReadyTasks`

- Fail if `count < 1`
- Fail if any task is `implementing` or `reviewing`
- Gather tasks with status `ready`, ordered by phase ascending then creation order (array index) ascending
- Take up to `count`
- Set their status to `implementing`, update `updatedAt`
- Return `{ board, claimed }` where `claimed` is the array of claimed TaskRecords

#### `getStatusCounts`

- Count tasks by status, return `Record<TaskStatus, number>` with all 7 statuses present (zero-filled)

#### `getActivePhase`

- Return the phase number of the phase with status `"active"`, or `null` if none

#### `getReadyTasks`

- Return tasks with status `"ready"`, ordered by phase ascending then array position ascending

#### `hasActionableTasks` / `hasBlockedNonTerminalTasks`

- Re-export from validation.ts or implement inline

### Implementation Details for `applyEdits`

The `applyEdits` function must handle these cases precisely:

**Structural edits (`data` and `blockers`)**:

- After applying all structural edits in the batch, reset ALL non-terminal tasks (that are NOT implementing/reviewing) back to `draft`. This is because structural changes invalidate the compiled graph.
- Tasks that are `implementing` or `reviewing` are never reset (they should not exist when structural edits are allowed, but guard anyway).

**Advance edits**:

- Only allowed transitions: `implementing → reviewing`, `reviewing → done`
- After advancing a task to `done`, recompute phases and readiness
- Track which tasks newly became `ready` for the return info

**Abandon edits**:

- Allowed from: `draft`, `configured`, `ready`, `implementing`, `reviewing`
- Not allowed from: `done`, `abandoned`
- After abandoning, recompute phases and readiness

**Mixed batches**: A batch may contain multiple edit types. Process in this order:

1. Validate all edits
2. Apply all `data` and `blockers` edits first, then reset non-active non-terminal tasks to `draft`
3. Apply all `advance` and `abandon` edits, recomputing after each one
4. Return the final board

**Error handling**: On any validation failure, throw an `Error` with a descriptive message. The caller (tools.ts) wraps this in a tool error result.

NOTE: Batches containing both structural edits (data/blockers) and advance/abandon edits are inherently invalid because structural edits require no implementing/reviewing tasks while advance edits require them. The validator will reject such mixed batches.

### Acceptance Criteria

- `createEmptyBoard()` returns `{ version: 1, tasks: [], phases: [] }` (no `nextTaskId`)
- > **[IMPLEMENTATION DIVERGENCE]** `writeTasks` assigns `t-{phase}.{n}` IDs, not `task-1`, `task-2`
- `compileBoard` moves `draft` → `configured` and computes `ready` states
- `compileBoard` throws on cycles, invalid deps, empty board, or active tasks
- `applyEdits` with `advance: implementing→reviewing` works
- `applyEdits` with `advance: reviewing→done` works and recomputes readiness
- `applyEdits` with `advance` from any other status throws
- `applyEdits` with `abandon` from `done` throws
- `applyEdits` with `data`/`blockers` resets non-terminal non-active tasks to `draft`
- Structural edits throw if any task is implementing/reviewing
- `claimReadyTasks` moves ready → implementing, up to `count`
- `claimReadyTasks` throws if tasks are implementing/reviewing or count < 1
- `claimReadyTasks` returns `{ board, claimed: [] }` when no ready tasks exist (does not throw). The caller must check `claimed.length` and return an appropriate error message.
- All functions return new boards without mutating inputs
- No pi package imports
- `npx tsc --noEmit` passes

### Dependencies

Steps 2, 3

---

## Step 5: Engine Tests

### Files to Create

- `src/__tests__/setup.ts`
- `src/__tests__/helpers/mocks.ts`
- `src/__tests__/helpers/engine-helpers.ts`
- `src/__tests__/engine-write.test.ts`
- `src/__tests__/engine-compile.test.ts`
- `src/__tests__/engine-edits.test.ts`
- `src/__tests__/engine-queries.test.ts`

> **[IMPLEMENTATION DIVERGENCE]** Engine tests were split into 4 files by domain (`write`, `compile`, `edits`, `queries`) instead of a single `engine.test.ts`. An `engine-helpers.ts` file provides shared test utilities (`makeCompiledBoard`, `makeBoardWithStatuses`).

### What to Implement

#### `src/__tests__/setup.ts`

Copy the pi-tui mock pattern from `pi-til-done`:

```ts
import { vi } from "vitest";

class MockText {
  constructor(
    private _text: string,
    _x: number,
    _y: number,
  ) {}
  toString(): string {
    return this._text;
  }
  render(_width: number): string[] {
    if (this._text === "") return [];
    return this._text.split("\n");
  }
}

vi.mock("@earendil-works/pi-tui", () => ({
  Text: MockText,
}));
```

#### `src/__tests__/helpers/mocks.ts`

Create mock helpers for the extension API and context. Adapted from `pi-til-done` but using `phased-tasks:snapshot` custom entries:

```ts
import type { Theme, ExtensionContext, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

export function createMockTheme(): Theme {
  return {
    fg: vi.fn((color: string, text: string) => `[${color}]${text}`),
    bold: vi.fn((text: string) => `**${text}**`),
    strikethrough: vi.fn((text: string) => `~~${text}~~`),
  } as unknown as Theme;
}

export function createMockContext(
  branch: Array<{
    type: string;
    customType?: string;
    data?: unknown;
  }> = [],
): ExtensionContext {
  return {
    hasUI: true,
    ui: {
      setStatus: vi.fn(),
      setWidget: vi.fn(),
    },
    sessionManager: {
      getBranch: vi.fn(() => branch),
    },
  } as unknown as ExtensionContext;
}

export function createMockAPI(): {
  api: ExtensionAPI;
  sendMessage: ReturnType<typeof vi.fn>;
  sendUserMessage: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  registerMessageRenderer: ReturnType<typeof vi.fn>;
  appendEntry: ReturnType<typeof vi.fn>;
} {
  const sendMessage = vi.fn();
  const sendUserMessage = vi.fn();
  const registerTool = vi.fn();
  const on = vi.fn();
  const registerMessageRenderer = vi.fn();
  const appendEntry = vi.fn();

  return {
    api: {
      sendMessage,
      sendUserMessage,
      registerTool,
      on,
      registerMessageRenderer,
      appendEntry,
    } as unknown as ExtensionAPI,
    sendMessage,
    sendUserMessage,
    registerTool,
    on,
    registerMessageRenderer,
    appendEntry,
  };
}
```

#### `src/__tests__/engine.test.ts`

Write comprehensive tests covering all engine invariants. Use `describe`/`it` blocks organized by function. Test cases:

1. **createEmptyBoard**
   - returns correct empty shape

2. **writeTasks**
   - creates draft tasks with stable ids (task-1, task-2)
   - sets createdAt/updatedAt to the `now` parameter
   - initializes dependencies to `[]`
   - increments nextTaskId
   - appends to existing board (does not replace)
   - rejects empty title/prompt/profile
   - rejects invalid phase (0, negative, non-integer)
   - rejects when total would exceed MAX_TASKS (100)

3. **compileBoard**
   - moves draft → configured
   - sets first phase with non-terminal tasks as active
   - marks earlier phases completed, later phases pending
   - marks configured tasks as ready when all deps are done
   - leaves configured tasks as configured when deps are not done
   - rejects empty board
   - rejects cycles
   - rejects invalid dependency ids
   - rejects when any task is implementing/reviewing
   - later phases remain configured even if all deps are done

4. **applyEdits - advance**
   - implementing → reviewing succeeds
   - reviewing → done succeeds
   - done triggers readiness recomputation for dependents
   - rejects advance from draft, configured, ready, done, abandoned
   - rejects multi-step jumps

5. **applyEdits - abandon**
   - succeeds from draft, configured, ready, implementing, reviewing
   - rejects from done, abandoned
   - does not satisfy dependencies (dependents stay blocked)

6. **applyEdits - data**
   - mutates title/prompt/profile/phase
   - resets non-terminal non-active tasks to draft
   - rejects when any task is implementing/reviewing
   - rejects unknown ids

7. **applyEdits - blockers**
   - replaces dependency list
   - rejects self-dependencies
   - rejects references to nonexistent tasks
   - resets non-terminal non-active tasks to draft

8. **applyEdits - atomicity**
   - if any edit in a batch fails, none are applied

9. **claimReadyTasks**
   - claims up to `count` ready tasks
   - orders by phase ascending, then creation order
   - moves claimed to implementing
   - rejects if count < 1
   - rejects if any task is implementing/reviewing
   - rejects if no ready tasks exist (deadlock vs all-terminal)

10. **getStatusCounts**
    - returns all 7 statuses with correct counts

11. **getActivePhase**
    - returns active phase number or null

12. **Phase gating**
    - later phase tasks never become ready until earlier phase is terminal
    - when active phase becomes terminal (all done/abandoned), next phase activates

Use a helper function in `src/__tests__/helpers/engine-helpers.ts` to create a compiled board from input tasks to reduce boilerplate:

```ts
// [IMPLEMENTATION DIVERGENCE] IDs are `t-{phase}.{n}`, not `task-{i+1}`
function makeCompiledBoard(
  tasks: Array<{
    title: string;
    prompt: string;
    profile: string;
    phase: number;
    dependencies?: string[];
  }>,
): TaskBoardSnapshot {
  let board = createEmptyBoard();
  const now = "2025-01-01T00:00:00.000Z";
  board = writeTasks(
    board,
    tasks.map(({ title, prompt, profile, phase }) => ({ title, prompt, profile, phase })),
    now,
  );
  // Add dependencies via blockers edits if provided
  const edits: TaskEdit[] = [];
  tasks.forEach((t, i) => {
    if (t.dependencies && t.dependencies.length > 0) {
      edits.push({
        id: board.tasks[i].id,
        type: "blockers",
        data: { dependencies: t.dependencies },
      });
    }
  });
  if (edits.length > 0) {
    board = applyEdits(board, edits, now);
  }
  return compileBoard(board, now);
}
```

### Acceptance Criteria

- All tests pass with `npx vitest run`
- Coverage of engine.ts >= 90% statements
- Every workflow invariant from the plan is tested

### Dependencies

Steps 2, 3, 4

---

## Step 6: Config Module

### Files to Create

- `src/config.ts`

### What to Implement

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PhasedTasksConfig {
  phaseCompletionPromptTemplate?: string;
}

const CONFIG_PATH = ".pi/phased-tasks.json";

/** Cached config, loaded once per session. */
let cachedConfig: PhasedTasksConfig | null = null;

/** Load config from the project-local JSON file. Returns empty config on missing/invalid file. */
export async function loadConfig(): Promise<PhasedTasksConfig> {
  if (cachedConfig !== null) return cachedConfig;
  try {
    const raw = await readFile(join(process.cwd(), CONFIG_PATH), "utf-8");
    const parsed = JSON.parse(raw);
    cachedConfig = {
      phaseCompletionPromptTemplate:
        typeof parsed.phaseCompletionPromptTemplate === "string"
          ? parsed.phaseCompletionPromptTemplate
          : undefined,
    };
  } catch {
    cachedConfig = {};
  }
  return cachedConfig;
}

/** Resolve the phase completion prompt template for a given phase number. Returns undefined if no template configured. */
export function resolvePhasePrompt(
  template: string | undefined,
  phase: number,
): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{phase\}/g, String(phase));
}

/** Reset cached config. For testing only. */
export function resetConfig(): void {
  cachedConfig = null;
}
```

### Acceptance Criteria

- `loadConfig` returns empty object when file is missing
- `loadConfig` returns parsed config when file exists and is valid
- `loadConfig` ignores unknown fields
- `resolvePhasePrompt` replaces `{phase}` with the phase number
- `resolvePhasePrompt` returns undefined when template is undefined
- `resetConfig` clears the cache
- `npx tsc --noEmit` passes

### Dependencies

Step 2

---

## Step 7: State Management Module

### Files to Create

- `src/state.ts`

### What to Implement

Module-level in-memory state with snapshot reconstruction and persistence helpers.

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskBoardSnapshot } from "./types";
import { CUSTOM_EVENT_TYPE, CUSTOM_SNAPSHOT_TYPE, MAX_AUTO_CONTINUE } from "./types";
import { createEmptyBoard } from "./engine";
import { isValidSnapshot } from "./validation";

// ── Mutable State ──

let board: TaskBoardSnapshot = createEmptyBoard();
let autoContinueCount = 0;

// ── State Accessors ──

/** Returns a deep copy of the current board. */
export function getBoard(): TaskBoardSnapshot {
  return JSON.parse(JSON.stringify(board));
}

/** Replaces the board state. Resets auto-continue counter. */
export function setBoard(newBoard: TaskBoardSnapshot): void {
  board = JSON.parse(JSON.stringify(newBoard));
  autoContinueCount = 0;
}

/** Returns a readonly reference to the current board (no clone — caller must not mutate). */
export function getBoardRef(): Readonly<TaskBoardSnapshot> {
  return board;
}

/** Increments and returns the auto-continue counter. */
export function incrementAutoContinue(): number {
  return ++autoContinueCount;
}

/** Resets the auto-continue counter. */
export function resetAutoContinue(): void {
  autoContinueCount = 0;
}

/** Resets all mutable state. For testing only. */
export function resetState(): void {
  board = createEmptyBoard();
  autoContinueCount = 0;
}

// ── State Reconstruction ──

/**
 * Reconstructs board state from session history.
 * Scans the branch in reverse to find the latest phased-tasks:snapshot custom entry.
 * Falls back to empty board if no valid snapshot found.
 */
export function reconstructState(ctx: ExtensionContext): TaskBoardSnapshot {
  const branch = ctx.sessionManager.getBranch();

  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "custom") continue;
    // [IMPLEMENTATION DIVERGENCE] Uses type assertion for customType/data access
    if ((entry as { customType?: string }).customType !== CUSTOM_SNAPSHOT_TYPE) continue;
    const data = (entry as { data?: unknown }).data;
    if (data && isValidSnapshot(data)) {
      return cloneBoard(data);
    }
  }

  return createEmptyBoard();
}

// ── Persistence Helpers ──

/** Append both an event and a snapshot entry. */
export function persistEntries(
  pi: ExtensionAPI,
  event: unknown,
  snapshot: TaskBoardSnapshot,
): void {
  pi.appendEntry(CUSTOM_EVENT_TYPE, event);
  pi.appendEntry(CUSTOM_SNAPSHOT_TYPE, JSON.parse(JSON.stringify(snapshot)));
}

// ── UI Sync ──

/** Updates the status bar to reflect current board state. */
export function updateUI(ctx: ExtensionContext, snapshot: Readonly<TaskBoardSnapshot>): void {
  if (!ctx.hasUI) return;

  if (snapshot.tasks.length === 0) {
    ctx.ui.setStatus("phased-tasks", undefined);
    ctx.ui.setStatus("phased-tasks-active", undefined);
    return;
  }

  // [IMPLEMENTATION DIVERGENCE] Uses getStatusCounts() from validation.ts for reliable zero-filled counts
  const counts = getStatusCounts(snapshot);

  const done = counts.done + counts.abandoned;
  const total = snapshot.tasks.length;

  const activePhase = snapshot.phases.find((p) => p.status === "active");
  const phaseLabel = activePhase ? `Phase ${activePhase.phase}` : "No active phase";

  if (done === total) {
    ctx.ui.setStatus("phased-tasks", `✓ All tasks resolved (${total})`);
    ctx.ui.setStatus("phased-tasks-active", undefined);
    return;
  }

  ctx.ui.setStatus("phased-tasks", `${phaseLabel} · ${done}/${total} done`);

  const activeLines: string[] = [];
  for (const t of snapshot.tasks) {
    if (t.status === "implementing" || t.status === "reviewing") {
      activeLines.push(`[${t.id}] ${t.title}`);
    }
  }
  ctx.ui.setStatus(
    "phased-tasks-active",
    activeLines.length > 0 ? activeLines.join("\n") : undefined,
  );
}
```

### Acceptance Criteria

- `getBoard()` returns a deep copy (mutations don't affect state)
- `setBoard()` replaces state and resets auto-continue counter
- `reconstructState` finds the latest snapshot via reverse-scan of custom entries
- `reconstructState` returns empty board when no snapshot exists
- `reconstructState` returns empty board when all snapshots are invalid
- `persistEntries` calls `pi.appendEntry` twice with correct custom types
- `updateUI` sets status bar with phase label and counts
- `updateUI` clears status when board is empty
- `updateUI` is a no-op when `ctx.hasUI` is false
- `resetState()` returns to empty board
- `npx tsc --noEmit` passes

### Dependencies

Steps 2, 3, 4, 6

---

## Step 8: State Tests

### Files to Create

- `src/__tests__/state.test.ts`

### What to Implement

Tests for state management:

1. **reconstructState**
   - returns empty board for empty branch
   - finds latest snapshot in reverse scan
   - skips entries with wrong customType
   - skips entries with invalid snapshot data
   - returns deep copy (mutations don't affect cached entry)

2. **setBoard / getBoard**
   - getBoard returns empty board initially
   - setBoard replaces and getBoard returns the new board
   - setBoard resets auto-continue counter
   - getBoard returns a deep copy

3. **persistEntries**
   - calls appendEntry twice: once with event type, once with snapshot type
   - passes correct data

4. **updateUI**
   - clears both status keys when board is empty
   - shows "Phase N · X/Y done" with active phase
   - shows active items for implementing/reviewing tasks
   - shows done state when all tasks terminal
   - is a no-op when hasUI is false

5. **auto-continue counter**
   - incrementAutoContinue accumulates
   - setBoard resets counter

### Acceptance Criteria

- All state tests pass
- Coverage of state.ts >= 90%

### Dependencies

Steps 5, 7

---

## Step 9: Formatting Module

### Files to Create

- `src/formatting.ts`

### What to Implement

User-facing text rendering. No pi imports (no theme — just plain text). Import types from `./types`.

```ts
import type { TaskBoardSnapshot, TaskRecord, TaskStatus } from "./types";
import { STATUS_ICONS } from "./types";

// ── Plain-Text Formatting (for LLM tool output) ──

/** Returns the plain-text icon for a task status. */
export function getStatusIcon(status: TaskStatus): string {
  return STATUS_ICONS[status];
}

/** Format a single task as a plain-text line. */
export function formatTaskLine(task: TaskRecord): string {
  return `${getStatusIcon(task.status)} [${task.id}] Phase ${task.phase} · ${task.title}`;
}

/** Format the full board as a plain-text summary for LLM consumption. */
export function formatBoardText(board: TaskBoardSnapshot): string {
  if (board.tasks.length === 0) return "No tasks on the board.";

  const lines: string[] = ["Task Board:", ""];

  // Group by phase
  const phases = [...new Set(board.tasks.map((t) => t.phase))].sort((a, b) => a - b);
  for (const phase of phases) {
    const phaseRecord = board.phases.find((p) => p.phase === phase);
    const phaseStatus = phaseRecord ? ` (${phaseRecord.status})` : "";
    lines.push(`── Phase ${phase}${phaseStatus} ──`);
    const phaseTasks = board.tasks.filter((t) => t.phase === phase);
    for (const task of phaseTasks) {
      let line = formatTaskLine(task);
      if (task.dependencies.length > 0) {
        line += ` → depends on [${task.dependencies.join(", ")}]`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  // Summary line
  const counts: Partial<Record<TaskStatus, number>> = {};
  for (const t of board.tasks) {
    counts[t.status] = (counts[t.status] || 0) + 1;
  }
  const parts: string[] = [];
  for (const [status, count] of Object.entries(counts)) {
    if (count && count > 0) parts.push(`${count} ${status}`);
  }
  lines.push(`Summary: ${parts.join(", ")}`);

  return lines.join("\n");
}

/** Format a short summary for tool output headers. */
export function formatSummaryLine(board: TaskBoardSnapshot): string {
  const total = board.tasks.length;
  const done = board.tasks.filter((t) => t.status === "done" || t.status === "abandoned").length;
  const activePhase = board.phases.find((p) => p.status === "active");
  return activePhase
    ? `Phase ${activePhase.phase} · ${done}/${total} done`
    : `${done}/${total} done`;
}

/** Format the hidden context message for before_agent_start injection. */
export function formatHiddenContext(board: TaskBoardSnapshot): string {
  const lines: string[] = ["[PHASED TASKS ACTIVE]", ""];

  const activePhase = board.phases.find((p) => p.status === "active");
  lines.push(`Active Phase: ${activePhase ? activePhase.phase : "none"}`);

  // Counts by status
  const counts: Partial<Record<TaskStatus, number>> = {};
  for (const t of board.tasks) {
    counts[t.status] = (counts[t.status] || 0) + 1;
  }
  lines.push(
    `Status: ${Object.entries(counts)
      .map(([s, c]) => `${c} ${s}`)
      .join(", ")}`,
  );

  // Currently claimed tasks
  const claimed = board.tasks.filter(
    (t) => t.status === "implementing" || t.status === "reviewing",
  );
  if (claimed.length > 0) {
    lines.push("");
    lines.push("Currently claimed:");
    for (const t of claimed) {
      lines.push(`  ${getStatusIcon(t.status)} [${t.id}] ${t.title}`);
    }
  }

  // Non-terminal tasks (cap at reasonable size)
  lines.push("");
  lines.push("Remaining tasks:");
  const nonTerminal = board.tasks.filter((t) => t.status !== "done" && t.status !== "abandoned");
  for (const t of nonTerminal) {
    lines.push(`  ${formatTaskLine(t)}`);
  }

  // Recently completed (up to 10)
  const terminal = board.tasks.filter((t) => t.status === "done" || t.status === "abandoned");
  if (terminal.length > 0) {
    const recent = terminal.slice(-10);
    if (terminal.length > 10) {
      lines.push(`... and ${terminal.length - 10} more terminal tasks`);
    }
    for (const t of recent) {
      lines.push(`  ${formatTaskLine(t)}`);
    }
  }

  lines.push("");
  lines.push(
    "Workflow: write_tasks → edit_tasks (blockers/data) → compile_tasks → get_ready_tasks → advance_tasks → done",
  );

  return lines.join("\n");
}

/** Format the auto-continue prompt. */
export function formatContinuePrompt(board: TaskBoardSnapshot): string {
  const ready = board.tasks.filter((t) => t.status === "ready");
  const active = board.tasks.filter((t) => t.status === "implementing" || t.status === "reviewing");

  if (ready.length > 0 || active.length > 0) {
    const lines: string[] = ["Tasks remain. Continue working on the phased task board."];
    if (active.length > 0) {
      lines.push("");
      lines.push("Currently claimed:");
      for (const t of active) {
        lines.push(`  [${t.id}] ${t.title} (${t.status})`);
      }
    }
    if (ready.length > 0) {
      lines.push("");
      lines.push(`Ready to claim: ${ready.length} task(s). Call get_ready_tasks to claim them.`);
    }
    return lines.join("\n");
  }

  // Deadlock
  const nonTerminal = board.tasks.filter((t) => t.status !== "done" && t.status !== "abandoned");
  if (nonTerminal.length > 0) {
    return [
      "The task board is blocked — no tasks are ready, implementing, or reviewing, but tasks remain.",
      "Inspect dependencies and phase gating. Use edit_tasks to resolve blockers, then compile_tasks.",
      "",
      "Blocked tasks:",
      ...nonTerminal.map((t) => `  [${t.id}] ${t.title} (${t.status}, Phase ${t.phase})`),
    ].join("\n");
  }

  return "";
}

/** Format the "all done" terminal message. */
export function formatAllDoneMessage(board: TaskBoardSnapshot): string {
  return `All tasks resolved. Phase ${board.phases.length > 0 ? board.phases[board.phases.length - 1].phase : 0} complete.`;
}
```

### Acceptance Criteria

- All formatting functions produce readable, consistent plain-text output
- `formatBoardText` includes phase groupings, status icons, dependencies, and summary
- `formatHiddenContext` includes active phase, counts, claimed tasks, remaining tasks, and workflow reminder
- `formatContinuePrompt` returns appropriate text for actionable, blocked, and terminal states
- No pi package imports
- `npx tsc --noEmit` passes

### Dependencies

Step 2

---

## Step 10: Tool Definitions

### Files to Create

- `src/schemas.ts` — [IMPLEMENTATION DIVERGENCE] Schema definitions were extracted from tools.ts into a separate module
- `src/tools.ts`

### What to Implement

> **[IMPLEMENTATION DIVERGENCE]** 6 tools instead of 5. `advance_tasks` is a separate tool (not an `edit_tasks` type). `edit_tasks` has 3 types: `data`, `blockers`, `abandon` (no `advance`).

Register six tools using the pi tool registration pattern. Each tool is a factory function that accepts `pi: ExtensionAPI` and returns a `ToolDefinition`.

Key imports:

```ts
import { StringEnum } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type {
  ExtensionAPI,
  ToolDefinition,
  ExtensionContext,
  AgentToolResult,
} from "@earendil-works/pi-coding-agent";
```

#### Tool 1: `write_tasks`

Parameters schema:

```ts
Type.Object({
  tasks: Type.Array(
    Type.Object({
      title: Type.String({ description: "Short task title" }),
      prompt: Type.String({ description: "Detailed implementation instructions" }),
      profile: Type.String({ description: "Agent profile name for task delegation" }),
      phase: Type.Integer({ description: "Phase number (>= 1)", minimum: 1 }),
    }),
    { description: "Tasks to add to the board" },
  ),
});
```

Behavior (5-step pattern):

1. Get current board: `getBoard()`
2. Call engine: `writeTasks(board, inputTasks, now)`
3. Set new board: `setBoard(newBoard)`
4. Persist: `persistEntries(pi, event, newBoard)`
5. Update UI: `updateUI(ctx, newBoard)`

On error (thrown by engine), return error content. On success, return `formatBoardText(newBoard)` as content. Include `details` with the full snapshot for state reconstruction.

#### Tool 2: `edit_tasks`

> **[IMPLEMENTATION DIVERGENCE]** `edit_tasks` has 3 types: `data`, `blockers`, `abandon`. The `advance` type was moved to a separate `advance_tasks` tool.

Parameters schema using a union type:

```ts
Type.Object({
  tasks: Type.Array(
    Type.Union([
      Type.Object({
        id: Type.String(),
        type: StringEnum(["data"]),
        data: Type.Object({
          title: Type.Optional(Type.String()),
          prompt: Type.Optional(Type.String()),
          profile: Type.Optional(Type.String()),
          phase: Type.Optional(Type.Integer()),
        }),
      }),
      Type.Object({
        id: Type.String(),
        type: StringEnum(["blockers"]),
        data: Type.Object({
          dependencies: Type.Array(Type.String()),
        }),
      }),
      Type.Object({
        id: Type.String(),
        type: StringEnum(["abandon"]),
      }),
    ]),
  ),
});
```

Behavior (5-step pattern + phase detection):

1. Get current board: `getBoard()`
2. Snapshot before-phases for comparison
3. Call engine: `applyEdits(board, edits, now)`
4. Set new board: `setBoard(newBoard)`
5. Detect phase completion (compare before/after phases), resolve phase prompt via `config.ts`, set `pendingPhasePrompt` on snapshot
6. Persist: `persistEntries(pi, event, newBoard)`
7. Update UI: `updateUI(ctx, newBoard)`
8. Reset auto-continue counter via `resetAutoContinue()`

On error, return error content. On success, return summary of edits applied plus updated board text.

#### Tool 3: `compile_tasks`

Parameters: `Type.Object({})` (no parameters)

Behavior (5-step pattern + phase detection):

1. Get current board: `getBoard()`
2. Snapshot before-phases for comparison
3. Call engine: `compileBoard(board, now)`
4. Set new board: `setBoard(newBoard)`
5. Detect phase completion, resolve phase prompt, set `pendingPhasePrompt` on snapshot
6. Persist: `persistEntries(pi, event, newBoard)`
7. Update UI: `updateUI(ctx, newBoard)`

On error, return error content. On success, return the compiled board summary.

#### Tool 4: `clear_tasks`

Parameters: `Type.Object({})` (no parameters)

Behavior:

1. Create empty board via `createEmptyBoard()`
2. Set new board: `setBoard(emptyBoard)`
3. Persist: `persistEntries(pi, { type: "clear_tasks" }, emptyBoard)`
4. Update UI: `updateUI(ctx, emptyBoard)`
5. Return "Board cleared."

#### Tool 5: `get_ready_tasks`

Parameters:

```ts
Type.Object({
  count: Type.Integer({ description: "Number of tasks to claim (>= 1)", minimum: 1 }),
});
```

Behavior (5-step pattern):

1. Get current board: `getBoard()`
2. Call engine: `claimReadyTasks(board, count, now)`
3. If `claimed.length === 0`, return appropriate error message:
   - If all tasks are terminal: "All tasks resolved" message
   - If tasks are implementing/reviewing: error that work is in progress
   - If no ready tasks but non-terminal tasks remain: deadlock message with instruction to edit dependencies
4. Set new board: `setBoard(result.board)`
5. Persist: `persistEntries(pi, event, result.board)`
6. Update UI: `updateUI(ctx, result.board)`
7. Return summary with claimed task details (id, title, prompt, profile, phase)
8. Include explicit instruction: "Review each claimed task and advance through implementing \u2192 reviewing \u2192 done using advance_tasks."

Note: `claimReadyTasks` returns `{ board, claimed: [] }` when no ready tasks exist (does not throw). The caller must check `claimed.length` and return an appropriate error message.

#### Tool 6: `advance_tasks`

> **[IMPLEMENTATION DIVERGENCE]** This is a new tool not in the original plan. `advance` was originally an `edit_tasks` type.

Parameters schema:

```ts
Type.Object({
  ids: Type.Array(Type.String(), { description: "Task IDs to advance" }),
});
```

Behavior:

1. Get current board: `getBoard()`
2. Map ids to `TaskEdit[]` with `type: "advance"`
3. Call engine: `applyEdits(board, edits, now)`
4. Detect phase completion, set pending phase prompt
5. Check if advance warning should be shown (consecutive advance calls without other tool usage)
6. Set new board: `setBoard(newBoard)`
7. Persist event + snapshot entries
8. Update UI
9. Return summary including warning if applicable

Each tool must implement `renderCall` and `renderResult` following the `pi-til-done` pattern.

`renderCall` examples:

- `write_tasks`: `theme.fg("toolTitle", theme.bold("write_tasks ")) + theme.fg("muted", "(N items)")`
- `edit_tasks`: `theme.fg("toolTitle", theme.bold("edit_tasks ")) + theme.fg("warning", "(N edits)")`
- `compile_tasks`: `theme.fg("toolTitle", theme.bold("compile_tasks"))`
- `clear_tasks`: `theme.fg("toolTitle", theme.bold("clear_tasks"))`
- `get_ready_tasks`: `theme.fg("toolTitle", theme.bold("get_ready_tasks ")) + theme.fg("muted", "(count: N)")`
- `advance_tasks`: `theme.fg("toolTitle", theme.bold("advance_tasks ")) + theme.fg("muted", "(N tasks)")`

`renderResult` for all tools: Render the board text in themed format, or error text in error color.

### Acceptance Criteria

- All 6 tools are defined as factory functions accepting `pi: ExtensionAPI` and returning `ToolDefinition`
- Each tool has proper typebox schemas for parameters
- Each tool calls the engine and handles errors gracefully
- Each tool persists event + snapshot on success
- Each tool updates UI on success
- Each tool has `renderCall` and `renderResult`
- `get_ready_tasks` auto-claims and includes instruction text
- `edit_tasks` is atomic (all succeed or none)
- `compile_tasks` validates the full board
- `npx tsc --noEmit` passes

### Dependencies

Steps 4, 6, 7, 9

---

## Step 11: Event Handlers

### Files to Create

- `src/events.ts`

### What to Implement

Register event handlers following the `pi-til-done` pattern. Use module-level handles for countdown management.

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskBoardSnapshot } from "./types";
import { MAX_AUTO_CONTINUE } from "./types";
import { hasActionableTasks, hasBlockedNonTerminalTasks } from "./validation";
import {
  getBoardRef,
  setBoard,
  reconstructState,
  updateUI,
  incrementAutoContinue,
  resetAutoContinue,
  persistEntries,
} from "./state";
import { resetConfig } from "./config";
import { formatHiddenContext, formatContinuePrompt } from "./formatting";

// ── Countdown Handles ──
let activeCountdown: ReturnType<typeof setInterval> | null = null;
let activeTimeout: ReturnType<typeof setTimeout> | null = null;

function clearCountdown(ctx: ExtensionContext): void {
  if (activeCountdown !== null) {
    clearInterval(activeCountdown);
    activeCountdown = null;
  }
  if (activeTimeout !== null) {
    clearTimeout(activeTimeout);
    activeTimeout = null;
  }
  if (ctx.hasUI) {
    ctx.ui.setWidget("phased-tasks-countdown", undefined);
  }
}

// ── Abort Detection ──
function wasAborted(messages: { role: string; stopReason?: string }[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].stopReason === "aborted";
  }
  return false;
}

// ── Auto-Continue Delivery ──
function trySendAutoContinue(pi: ExtensionAPI, prompt: string): void {
  try {
    pi.sendUserMessage(prompt);
  } catch {
    try {
      pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    } catch {
      /* skip */
    }
  }
}

// ── Schedule ──
function scheduleAutoContinue(pi: ExtensionAPI, ctx: ExtensionContext, prompt: string): void {
  if (ctx.hasUI) {
    if (activeCountdown !== null) clearInterval(activeCountdown);
    let remaining = 3;
    const interval = setInterval(() => {
      try {
        remaining--;
        if (remaining > 0) {
          ctx.ui.setWidget(
            "phased-tasks-countdown",
            [`⏳ Auto-continuing in ${remaining}s... (type anything to interrupt)`],
            { placement: "aboveEditor" },
          );
        } else {
          clearCountdown(ctx);
          trySendAutoContinue(pi, prompt);
        }
      } catch {
        clearCountdown(ctx);
      }
    }, 1000);
    activeCountdown = interval;
    ctx.ui.setWidget(
      "phased-tasks-countdown",
      ["⏳ Auto-continuing in 3s... (type anything to interrupt)"],
      { placement: "aboveEditor" },
    );
  } else {
    activeTimeout = setTimeout(() => {
      activeTimeout = null;
      trySendAutoContinue(pi, prompt);
    }, 3000);
  }
}

// ── Phase Prompt Helper ──
function consumePendingPhasePrompt(board: TaskBoardSnapshot): string {
  if (!board.pendingPhasePrompt) return "";
  return board.pendingPhasePrompt.message;
}

// ── Handler Registration ──

export function registerEventHandlers(pi: ExtensionAPI): void {
  pi.on("session_start", (_, ctx) => {
    clearCountdown(ctx);
    const board = reconstructState(ctx);
    setBoard(board);
    updateUI(ctx, board);
  });

  pi.on("session_tree", (_, ctx) => {
    clearCountdown(ctx);
    resetConfig();
    const board = reconstructState(ctx);
    setBoard(board);
    updateUI(ctx, board);
  });

  pi.on("before_agent_start", () => {
    const board = getBoardRef();
    if (board.tasks.length === 0) return;

    let content = formatHiddenContext(board);
    if (board.pendingPhasePrompt) {
      content = `${board.pendingPhasePrompt.message}\n\n${content}`;
    }

    return {
      message: {
        customType: "phased-tasks-context",
        content,
        display: false,
      },
    };
  });

  pi.on("agent_end", (event, ctx) => {
    const board = getBoardRef();
    if (board.tasks.length === 0) return;
    if (wasAborted(event.messages)) return;

    const count = incrementAutoContinue();
    if (count > MAX_AUTO_CONTINUE) {
      pi.sendMessage(
        {
          customType: "phased-tasks-notice",
          content: `Auto-continue limit reached (${MAX_AUTO_CONTINUE} iterations). Remaining tasks were not resolved. Take over manually.`,
          display: true,
        },
        { triggerTurn: false },
      );
      return;
    }

    if (hasActionableTasks(board)) {
      // Consume pending phase prompt
      let phasePrompt = "";
      if (board.pendingPhasePrompt) {
        phasePrompt = board.pendingPhasePrompt.message + "\n\n";
        // Clear the prompt — will be persisted on next mutation
        const updated = JSON.parse(JSON.stringify(board));
        delete updated.pendingPhasePrompt;
        setBoard(updated);
      }
      const prompt = phasePrompt + formatContinuePrompt(board);
      scheduleAutoContinue(pi, ctx, prompt);
      return;
    }

    if (hasBlockedNonTerminalTasks(board)) {
      const prompt = formatContinuePrompt(board); // deadlock message
      scheduleAutoContinue(pi, ctx, prompt);
      return;
    }

    // All terminal — do nothing
  });

  pi.on("input", (_, ctx) => {
    clearCountdown(ctx);
  });
}
```

### Acceptance Criteria

- `registerEventHandlers` registers handlers for `session_start`, `session_tree`, `before_agent_start`, `agent_end`, `input`, and `tool_result` (6 handlers)
  > **[IMPLEMENTATION DIVERGENCE]** `tool_result` handler was added to track consecutive `advance_tasks` calls for review-skip detection.
- `session_start` reconstructs state from snapshot and updates UI
- `session_tree` reconstructs state and updates UI
- `before_agent_start` returns hidden context message when board is non-empty
- `before_agent_start` returns undefined when board is empty
- `before_agent_start` prepends pending phase prompt if present
- `agent_end` auto-continues when actionable tasks exist
- `agent_end` sends deadlock message when blocked tasks exist
- `agent_end` does nothing when all tasks are terminal
- `agent_end` does nothing when board is empty
- `agent_end` does nothing when last assistant message was aborted
- `agent_end` stops after MAX_AUTO_CONTINUE (20) iterations
- `agent_end` consumes pending phase prompt (includes in continue, then clears)
- `input` clears any pending countdown
- Countdown shows widget with 3-2-1 timer in UI mode
- Countdown falls back to setTimeout in headless mode
- Delivery uses try/catch with followUp fallback
- `npx tsc --noEmit` passes

### Dependencies

Steps 7, 9

---

## Step 12: Message Renderers

### Files to Create

- `src/renderers.ts`

### What to Implement

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export function registerMessageRenderers(pi: ExtensionAPI): void {
  pi.registerMessageRenderer("phased-tasks-context", (message, _opts, theme) => {
    return new Text(theme.fg("accent", "📋 ") + theme.fg("dim", message.content as string), 0, 0);
  });

  pi.registerMessageRenderer("phased-tasks-notice", (message, _opts, theme) => {
    return new Text(theme.fg("warning", "⚠ ") + theme.fg("text", message.content as string), 0, 0);
  });
}
```

### Acceptance Criteria

- Registers renderers for `phased-tasks-context` and `phased-tasks-notice`
- Each renderer returns a `Text` instance
- `npx tsc --noEmit` passes

### Dependencies

Step 5 (setup.ts for MockText)

---

## Step 13: Entry Point

### Files to Create

- `src/index.ts`

### What to Implement

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMessageRenderers } from "./renderers";
import { registerEventHandlers } from "./events";
import {
  createWriteTasksTool,
  createEditTasksTool,
  createCompileTasksTool,
  createClearTasksTool,
  createGetReadyTasksTool,
  createAdvanceTasksTool, // [IMPLEMENTATION DIVERGENCE] Added
} from "./tools";

export default function (pi: ExtensionAPI): void {
  registerMessageRenderers(pi);
  registerEventHandlers(pi);

  pi.registerTool(createWriteTasksTool(pi));
  pi.registerTool(createEditTasksTool(pi));
  pi.registerTool(createCompileTasksTool(pi));
  pi.registerTool(createClearTasksTool(pi));
  pi.registerTool(createGetReadyTasksTool(pi));
  pi.registerTool(createAdvanceTasksTool(pi)); // [IMPLEMENTATION DIVERGENCE] Added
}
```

### Acceptance Criteria

- Default export is a function that accepts `ExtensionAPI`
- Registers all 5 tools
- Registers all message renderers
- Registers all event handlers
- `npx tsc --noEmit` passes

### Dependencies

Steps 10, 11, 12

---

## Step 14: Tool Tests

### Files to Create

- `src/__tests__/tools.test.ts`

### What to Implement

Test each tool's execute function through the full tool interface.

Key setup: Before each test, call `resetState()` to ensure isolation. Create mock `ExtensionAPI` and `ExtensionContext`.

Test cases:

1. **write_tasks**
   - succeeds with valid input, returns board text
   - appends to existing board (does not replace)
   - rejects empty title/prompt/profile
   - rejects invalid phase
   - rejects when total > 100

2. **edit_tasks - data**
   - succeeds when no active tasks
   - resets non-terminal non-active tasks to draft
   - rejects when tasks are implementing/reviewing
   - rejects unknown ids

3. **edit_tasks - blockers**
   - succeeds, replaces dependency list
   - rejects self-dependency
   - rejects nonexistent dep ids
   - resets non-terminal non-active tasks to draft

4. **edit_tasks - advance**
   - implementing → reviewing succeeds
   - reviewing → done succeeds and recomputes readiness
   - rejects from wrong statuses

5. **edit_tasks - abandon**
   - succeeds from allowed statuses
   - rejects from done/abandoned

6. **edit_tasks - atomicity**
   - mixed batch with one failure rolls back all

7. **compile_tasks**
   - succeeds on valid board
   - rejects empty board
   - rejects when active tasks exist
   - rejects cycles

8. **clear_tasks**
   - clears the board
   - resets nextTaskId to 1

9. **get_ready_tasks**
   - auto-claims ready tasks
   - returns task details with instruction text
   - rejects when implementing/reviewing tasks exist
   - rejects with deadlock message when no ready tasks but non-terminal remain
   - returns done message when all tasks are terminal
   - rejects count < 1

### Acceptance Criteria

- All tool tests pass
- Each tool's error paths are tested
- Auto-claim behavior of `get_ready_tasks` is verified
- `clear_tasks` fully resets state

### Dependencies

Steps 10, 13

---

## Step 15: Event Tests

### Files to Create

- `src/__tests__/events.test.ts`

### What to Implement

Test event handlers following the `pi-til-done` pattern.

Test cases:

1. **registerEventHandlers**
   - registers handlers for all 5 events (session_start, session_tree, before_agent_start, agent_end, input)

2. **session_start**
   - reconstructs state and updates UI

3. **session_tree**
   - reconstructs state and updates UI

4. **before_agent_start**
   - returns context message when board is non-empty
   - returns undefined when board is empty
   - message has `display: false`
   - message contains formatted board info
   - message includes pending phase prompt at top when present

5. **agent_end**
   - sends sendUserMessage when actionable tasks exist
   - sends deadlock message when blocked but non-terminal tasks remain
   - does nothing when all tasks are terminal
   - does nothing when board is empty
   - does nothing when last assistant message was aborted
   - increments counter on each call
   - stops after MAX_AUTO_CONTINUE with limit message
   - consumes pending phase prompt (includes it, then clears)
   - shows countdown widget before auto-continue
   - falls back to setTimeout in headless mode
   - falls back to followUp delivery on error
   - skips silently when both delivery methods fail

6. **input**
   - clears any pending countdown

### Acceptance Criteria

- All event tests pass
- Timer-based tests use `vi.useFakeTimers()` and `vi.advanceTimersByTime()`
- Countdown widget lifecycle is tested
- Abort detection is tested
- Circuit breaker is tested

### Dependencies

Steps 11, 13

---

## Step 16: Validation Tests

### Files to Create

- `src/__tests__/validation.test.ts`

### What to Implement

Test all validation functions:

1. **isNonEmptyString**
   - accepts normal strings
   - rejects empty string
   - rejects whitespace-only string
   - rejects non-string values
   - accepts strings with leading/trailing whitespace

2. **isValidPhase**
   - accepts positive integers
   - rejects 0
   - rejects negative numbers
   - rejects non-integers (1.5)
   - rejects non-numbers

3. **hasSelfDependency**
   - returns true when task id is in dependencies
   - returns false when task id is not in dependencies

4. **hasDuplicateDependencies**
   - returns true for duplicate deps
   - returns false for unique deps

5. **findMissingDependencies**
   - returns missing dep ids
   - returns empty array when all deps exist

6. **detectCycle**
   - returns empty array for acyclic graph
   - returns cycle path for simple cycle (A → B → A)
   - returns cycle path for longer cycle
   - returns empty array for linear chain
   - returns empty array for empty graph

7. **isValidSnapshot**
   - accepts valid snapshot
   - rejects non-objects
   - rejects wrong version
   - rejects missing fields

8. **hasActiveTasks / hasNonTerminalTasks / hasActionableTasks / hasBlockedNonTerminalTasks**
   - correct boolean returns for various board states

### Acceptance Criteria

- All validation tests pass
- Edge cases covered (empty inputs, null, wrong types)

### Dependencies

Steps 3, 5

---

## Step 17: Integration Verification and Final Polish

### Files to Modify

- All files (review and fix)
- No new files

### What to Implement

1. Run `npx vitest run` — all tests must pass
2. Run `npx tsc --noEmit` — must pass with zero errors
3. Run `npx eslint src/` — must pass (may need targeted suppressions for test files only)
4. Run `npx prettier --check src/` — must pass
5. Review all exports — ensure nothing is exported that shouldn't be, and all public API is exported
6. Verify `src/index.ts` is the single entry point
7. Ensure `src/engine.ts` has zero pi imports
8. Ensure `src/validation.ts` has zero pi imports
9. Ensure `src/types.ts` has zero external imports
10. Ensure `src/formatting.ts` has zero pi imports

### Acceptance Criteria

- `npm test` passes
- `npm run typecheck` passes
- `npm run lint` passes
- `npm run format:check` passes
- No pi imports in engine, validation, types, or formatting modules
- Package is loadable as a pi extension (correct `pi.extensions` field in package.json)

### Dependencies

All previous steps

---

## File Dependency Graph

```
package.json, tsconfig.json, vitest.config.ts, eslint.config.js
  └── src/types.ts
       ├── src/validation.ts
       │    └── src/engine.ts
       │         ├── src/config.ts
       │         ├── src/state.ts
       │         ├── src/formatting.ts
       │         ├── src/tools.ts ──────── src/renderers.ts
       │         └── src/events.ts
       │              └── src/index.ts
       └── src/__tests__/setup.ts
            └── src/__tests__/helpers/mocks.ts
                 ├── src/__tests__/engine.test.ts
                 ├── src/__tests__/validation.test.ts
                 ├── src/__tests__/state.test.ts
                 ├── src/__tests__/tools.test.ts
                 └── src/__tests__/events.test.ts
```

## Files OUT OF SCOPE

- Any file in `pi/`, `pi-til-done/`, or `pi-subagents/` directories
- `src/__tests__/index.test.ts` (index.ts is a thin wiring file; covered by integration)
- `docs/`, `README.md`, `CHANGELOG.md`, `LICENSE` (documentation, not code)
- Any UI widget beyond status bar and countdown

## Summary Table

| Step | Title                    | Files Created/Modified                                          | Depends On |
| ---- | ------------------------ | --------------------------------------------------------------- | ---------- |
| 1    | Package Scaffold         | package.json, tsconfig.json, vitest.config.ts, eslint.config.js | —          |
| 2    | Types and Constants      | src/types.ts                                                    | 1          |
| 3    | Validation Helpers       | src/validation.ts                                               | 2          |
| 4    | Pure Workflow Engine     | src/engine.ts                                                   | 2, 3       |
| 5    | Engine Tests             | src/**tests**/setup.ts, helpers/mocks.ts, engine.test.ts        | 2, 3, 4    |
| 6    | Config Module            | src/config.ts                                                   | 2          |
| 7    | State Management         | src/state.ts                                                    | 2, 3, 4, 6 |
| 8    | State Tests              | src/**tests**/state.test.ts                                     | 5, 7       |
| 9    | Formatting Module        | src/formatting.ts                                               | 2          |
| 10   | Tool Definitions         | src/tools.ts                                                    | 4, 6, 7, 9 |
| 11   | Event Handlers           | src/events.ts                                                   | 7, 9       |
| 12   | Message Renderers        | src/renderers.ts                                                | 5          |
| 13   | Entry Point              | src/index.ts                                                    | 10, 11, 12 |
| 14   | Tool Tests               | src/**tests**/tools.test.ts                                     | 10, 13     |
| 15   | Event Tests              | src/**tests**/events.test.ts                                    | 11, 13     |
| 16   | Validation Tests         | src/**tests**/validation.test.ts                                | 3, 5       |
| 17   | Integration Verification | All files (review)                                              | All        |
