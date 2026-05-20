import type { TaskRecord, TaskStatus, TaskBoardSnapshot } from "./types";
import { ALL_STATUSES, TERMINAL_STATUSES, ACTIVE_STATUSES } from "./types";

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

/** Returns true if all fields of a TaskRecord are structurally valid (does NOT check id uniqueness or dependency existence). */
function hasValidStringField(obj: Record<string, unknown>, key: string): boolean {
  const value = obj[key];
  return typeof value === "string" && value.length > 0;
}

function hasValidDependenciesField(obj: Record<string, unknown>): boolean {
  return (
    Array.isArray(obj.dependencies) && obj.dependencies.every((d: unknown) => typeof d === "string")
  );
}

function isValidTaskRecordFields(obj: Record<string, unknown>): boolean {
  if (typeof obj.id !== "string") return false;
  if (!hasValidStringField(obj, "title")) return false;
  if (!hasValidStringField(obj, "prompt")) return false;
  if (!hasValidStringField(obj, "profile")) return false;
  if (typeof obj.phase !== "number" || !Number.isInteger(obj.phase) || obj.phase < 1) return false;
  if (!hasValidDependenciesField(obj)) return false;
  if (typeof obj.status !== "string" || !ALL_STATUSES.has(obj.status as TaskStatus)) return false;
  if (typeof obj.createdAt !== "string") return false;
  if (typeof obj.updatedAt !== "string") return false;
  return true;
}

/** Returns true if all fields of a TaskRecord are structurally valid (does NOT check id uniqueness or dependency existence). */
export function isValidTaskRecord(t: unknown): t is TaskRecord {
  if (typeof t !== "object" || t === null) return false;
  return isValidTaskRecordFields(t as Record<string, unknown>);
}

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

/** Returns true if any task is in implementing or reviewing. */
export function hasActiveTasks(board: TaskBoardSnapshot): boolean {
  return board.tasks.some((t) => ACTIVE_STATUSES.has(t.status));
}

/** Returns true if any task is in a non-terminal state. */
export function hasNonTerminalTasks(board: TaskBoardSnapshot): boolean {
  return board.tasks.some((t) => !TERMINAL_STATUSES.has(t.status));
}

/** Returns true if there are tasks in ready, implementing, or reviewing. */
export function hasActionableTasks(board: TaskBoardSnapshot): boolean {
  return board.tasks.some((t) => t.status === "ready" || ACTIVE_STATUSES.has(t.status));
}

/** Returns true if there are non-terminal tasks but none are actionable (deadlock). */
export function hasBlockedNonTerminalTasks(board: TaskBoardSnapshot): boolean {
  return hasNonTerminalTasks(board) && !hasActionableTasks(board);
}

// ── Snapshot Validation ──

/** Type guard for a valid TaskBoardSnapshot. Checks version field and basic structure. */
export function isValidSnapshot(data: unknown): data is TaskBoardSnapshot {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    obj.version === 1 &&
    typeof obj.nextTaskId === "number" &&
    Array.isArray(obj.tasks) &&
    Array.isArray(obj.phases)
  );
}

// ── Deep Clone ──

/** Creates a deep copy of a TaskBoardSnapshot. */
export function cloneBoard(board: TaskBoardSnapshot): TaskBoardSnapshot {
  return JSON.parse(JSON.stringify(board)) as TaskBoardSnapshot;
}
