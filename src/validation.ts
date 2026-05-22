import type { TaskRecord, TaskStatus, TaskBoardSnapshot } from "./types";
import { TERMINAL_STATUSES, ACTIVE_STATUSES } from "./types";

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

// ── Status Counts ──

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

// ── Board State Checks ──

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

const VALID_TASK_STATUSES = new Set([
  "draft",
  "configured",
  "ready",
  "implementing",
  "reviewing",
  "done",
  "abandoned",
]);

const VALID_PHASE_STATUSES = new Set(["pending", "active", "completed"]);

function isValidTask(t: unknown): boolean {
  if (typeof t !== "object" || t === null) return false;
  const task = t as Record<string, unknown>;
  return (
    typeof task.id === "string" &&
    typeof task.title === "string" &&
    typeof task.status === "string" &&
    VALID_TASK_STATUSES.has(task.status) &&
    typeof task.phase === "number" &&
    Array.isArray(task.dependencies) &&
    (task.dependencies as unknown[]).every((d) => typeof d === "string")
  );
}

function isValidPhaseRecord(p: unknown): boolean {
  if (typeof p !== "object" || p === null) return false;
  const phase = p as Record<string, unknown>;
  return (
    typeof phase.phase === "number" &&
    typeof phase.status === "string" &&
    VALID_PHASE_STATUSES.has(phase.status)
  );
}

/** Type guard for a valid TaskBoardSnapshot. Checks version field, structure, and task/phase validity. */
export function isValidSnapshot(data: unknown): data is TaskBoardSnapshot {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (obj.version !== 1 || !Array.isArray(obj.tasks) || !Array.isArray(obj.phases)) return false;
  if (!(obj.tasks as unknown[]).every(isValidTask)) return false;
  if (!(obj.phases as unknown[]).every(isValidPhaseRecord)) return false;
  return true;
}

// ── Deep Clone ──

/**
 * Creates a deep copy of a TaskBoardSnapshot.
 * Uses JSON roundtrip (instead of structuredClone) because benchmarks show it's
 * faster for plain-object graphs without special types.
 */
export function cloneBoard(board: TaskBoardSnapshot): TaskBoardSnapshot {
  return JSON.parse(JSON.stringify(board)) as TaskBoardSnapshot;
}
