import type { TaskBoardSnapshot, TaskRecord, TaskStatus, TaskEdit } from "./types";
import { MAX_TASKS, ACTIVE_STATUSES, TERMINAL_STATUSES } from "./types";
import {
  isNonEmptyString,
  isValidPhase,
  hasSelfDependency,
  hasDuplicateDependencies,
  findMissingDependencies,
  detectCycle,
  cloneBoard,
} from "./validation";

// ── Board Creation ──

export function createEmptyBoard(): TaskBoardSnapshot {
  return { version: 1, nextTaskId: 1, tasks: [], phases: [], pendingPhasePrompt: undefined };
}

// ── Write Tasks ──

function validateTaskInput(
  input: { title: string; prompt: string; profile: string; phase: number },
  index: number,
): void {
  const trimmedTitle = input.title.trim();
  const trimmedPrompt = input.prompt.trim();
  const trimmedProfile = input.profile.trim();

  if (!isNonEmptyString(trimmedTitle)) {
    throw new Error(`Task ${index + 1}: title must be a non-empty string`);
  }
  if (!isNonEmptyString(trimmedPrompt)) {
    throw new Error(`Task ${index + 1}: prompt must be a non-empty string`);
  }
  if (!isNonEmptyString(trimmedProfile)) {
    throw new Error(`Task ${index + 1}: profile must be a non-empty string`);
  }
  if (!isValidPhase(input.phase)) {
    throw new Error(`Task ${index + 1}: phase must be an integer >= 1, got ${String(input.phase)}`);
  }
}

export function writeTasks(
  board: TaskBoardSnapshot,
  inputTasks: Array<{ title: string; prompt: string; profile: string; phase: number }>,
  now: string,
): TaskBoardSnapshot {
  const result = cloneBoard(board);

  if (result.tasks.length + inputTasks.length > MAX_TASKS) {
    throw new Error(
      `Cannot add ${inputTasks.length} tasks: would exceed maximum of ${MAX_TASKS} (currently ${result.tasks.length})`,
    );
  }

  for (let i = 0; i < inputTasks.length; i++) {
    validateTaskInput(inputTasks[i], i);

    const input = inputTasks[i];
    const id = `task-${result.nextTaskId}`;
    result.tasks.push({
      id,
      title: input.title.trim(),
      prompt: input.prompt.trim(),
      profile: input.profile.trim(),
      phase: input.phase,
      dependencies: [],
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    result.nextTaskId++;
  }

  return result;
}

// ── Recompute Phases and Readiness (internal) ──

function recomputePhasesAndReadiness(
  board: TaskBoardSnapshot,
  oldBoard: TaskBoardSnapshot,
  now: string,
): TaskBoardSnapshot {
  const allPhaseNumbers = new Set(board.tasks.map((t) => t.phase));
  const nonTerminalTasks = board.tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));

  if (nonTerminalTasks.length === 0) {
    const phases = [...allPhaseNumbers]
      .sort((a, b) => a - b)
      .map((phase) => {
        const oldPhase = oldBoard.phases.find((p) => p.phase === phase);
        return {
          phase,
          status: "completed" as const,
          completedAt: oldPhase?.completedAt ?? now,
        };
      });
    board.phases = phases;
    return board;
  }

  const nonTerminalPhases = new Set(nonTerminalTasks.map((t) => t.phase));
  const sortedNonTerminalPhases = [...nonTerminalPhases].sort((a, b) => a - b);
  const activePhase = sortedNonTerminalPhases[0];

  board.phases = buildPhasesArray(allPhaseNumbers, activePhase, oldBoard, now);

  markReadyTasksInActivePhase(board, activePhase);

  const allActivePhaseTerminal = board.tasks
    .filter((t) => t.phase === activePhase)
    .every((t) => TERMINAL_STATUSES.has(t.status));

  if (allActivePhaseTerminal && sortedNonTerminalPhases.length > 1) {
    const phaseRecord = board.phases.find((p) => p.phase === activePhase);
    if (phaseRecord) {
      phaseRecord.status = "completed";
      phaseRecord.completedAt = now;
    }
    return recomputePhasesAndReadiness(board, oldBoard, now);
  }

  return board;
}

function buildPhasesArray(
  allPhaseNumbers: Set<number>,
  activePhase: number,
  oldBoard: TaskBoardSnapshot,
  now: string,
): TaskBoardSnapshot["phases"] {
  return [...allPhaseNumbers]
    .sort((a, b) => a - b)
    .map((phase) => {
      const oldPhase = oldBoard.phases.find((p) => p.phase === phase);
      if (phase < activePhase) {
        return {
          phase,
          status: "completed" as const,
          completedAt: oldPhase?.completedAt ?? now,
        };
      }
      if (phase === activePhase) {
        return { phase, status: "active" as const };
      }
      return { phase, status: "pending" as const };
    });
}

function markReadyTasksInActivePhase(board: TaskBoardSnapshot, activePhase: number): void {
  const taskMap = new Map(board.tasks.map((t) => [t.id, t]));
  for (const task of board.tasks) {
    if (task.phase === activePhase && task.status === "configured") {
      const allDepsDone = task.dependencies.every((depId) => {
        const dep = taskMap.get(depId);
        return dep !== undefined && dep.status === "done";
      });
      if (allDepsDone) {
        task.status = "ready";
      }
    }
  }
}

// ── Apply Edits ──

function validateDataEdit(edit: TaskEdit & { type: "data" }, hasActiveTasksOnBoard: boolean): void {
  if (hasActiveTasksOnBoard) {
    throw new Error(
      "Cannot edit data while tasks are implementing/reviewing. Complete or advance active tasks first.",
    );
  }
  if (edit.data.title !== undefined && !isNonEmptyString(edit.data.title)) {
    throw new Error(`Task "${edit.id}": title must be a non-empty string`);
  }
  if (edit.data.prompt !== undefined && !isNonEmptyString(edit.data.prompt)) {
    throw new Error(`Task "${edit.id}": prompt must be a non-empty string`);
  }
  if (edit.data.profile !== undefined && !isNonEmptyString(edit.data.profile)) {
    throw new Error(`Task "${edit.id}": profile must be a non-empty string`);
  }
  if (edit.data.phase !== undefined && !isValidPhase(edit.data.phase)) {
    throw new Error(
      `Task "${edit.id}": phase must be an integer >= 1, got ${String(edit.data.phase)}`,
    );
  }
}

function validateEdit(
  edit: TaskEdit,
  taskMap: Map<string, TaskRecord>,
  existingIds: Set<string>,
  hasActiveTasksOnBoard: boolean,
): void {
  const task = taskMap.get(edit.id);
  if (!task) {
    throw new Error(`Task "${edit.id}" not found`);
  }

  switch (edit.type) {
    case "data": {
      validateDataEdit(edit, hasActiveTasksOnBoard);
      break;
    }
    case "blockers": {
      if (hasActiveTasksOnBoard) {
        throw new Error(
          "Cannot edit blockers while tasks are implementing/reviewing. Complete or advance active tasks first.",
        );
      }
      if (hasSelfDependency(edit.id, edit.data.dependencies)) {
        throw new Error(`Task "${edit.id}" cannot depend on itself`);
      }
      if (hasDuplicateDependencies(edit.data.dependencies)) {
        throw new Error(`Task "${edit.id}" has duplicate dependencies`);
      }
      const missing = findMissingDependencies(edit.data.dependencies, existingIds);
      if (missing.length > 0) {
        throw new Error(
          `Task "${edit.id}" references non-existent dependencies: ${missing.join(", ")}`,
        );
      }
      break;
    }
    case "advance": {
      if (task.status !== "implementing" && task.status !== "reviewing") {
        throw new Error(
          `Cannot advance task "${edit.id}" from "${task.status}". Can only advance from "implementing" or "reviewing".`,
        );
      }
      break;
    }
    case "abandon": {
      if (task.status === "done" || task.status === "abandoned") {
        throw new Error(
          `Cannot abandon task "${edit.id}" in "${task.status}" status. Already resolved.`,
        );
      }
      break;
    }
  }
}

function applyStructuralEdits(
  edits: TaskEdit[],
  taskMap: Map<string, TaskRecord>,
  now: string,
): void {
  for (const edit of edits) {
    const task = taskMap.get(edit.id);
    if (!task) continue;

    if (edit.type === "data") {
      if (edit.data.title !== undefined) task.title = edit.data.title;
      if (edit.data.prompt !== undefined) task.prompt = edit.data.prompt;
      if (edit.data.profile !== undefined) task.profile = edit.data.profile;
      if (edit.data.phase !== undefined) task.phase = edit.data.phase;
      task.updatedAt = now;
    }
    // edit.type === "blockers" is the only other structural type
    // TypeScript doesn't narrow after the if above, so we check explicitly
    if (edit.type === "blockers") {
      task.dependencies = [...edit.data.dependencies];
      task.updatedAt = now;
    }
  }
}

function resetNonTerminalToDraft(tasks: TaskRecord[], now: string): void {
  for (const task of tasks) {
    if (!TERMINAL_STATUSES.has(task.status) && !ACTIVE_STATUSES.has(task.status)) {
      task.status = "draft";
      task.updatedAt = now;
    }
  }
}

function applyStateEdits(
  edits: TaskEdit[],
  taskMap: Map<string, TaskRecord>,
  board: TaskBoardSnapshot,
  oldBoard: TaskBoardSnapshot,
  now: string,
): void {
  for (const edit of edits) {
    const task = taskMap.get(edit.id);
    if (!task) continue;

    if (edit.type === "advance") {
      if (task.status === "implementing") {
        task.status = "reviewing";
        task.updatedAt = now;
      } else {
        // Must be "reviewing" (validated above)
        task.status = "done";
        task.updatedAt = now;
        recomputePhasesAndReadiness(board, oldBoard, now);
      }
    }
    // edit.type === "abandon" is the only other state type
    if (edit.type === "abandon") {
      task.status = "abandoned";
      task.updatedAt = now;
      recomputePhasesAndReadiness(board, oldBoard, now);
    }
  }
}

export function applyEdits(
  board: TaskBoardSnapshot,
  edits: TaskEdit[],
  now: string,
): TaskBoardSnapshot {
  if (edits.length === 0) return cloneBoard(board);

  const result = cloneBoard(board);
  const taskMap = new Map(result.tasks.map((t) => [t.id, t]));
  const existingIds = new Set(result.tasks.map((t) => t.id));
  const boardHasActiveTasks = result.tasks.some((t) => ACTIVE_STATUSES.has(t.status));

  // First pass: validate all edits
  for (const edit of edits) {
    validateEdit(edit, taskMap, existingIds, boardHasActiveTasks);
  }

  // Second pass: apply all edits
  const structuralEdits = edits.filter((e) => e.type === "data" || e.type === "blockers");
  const stateEdits = edits.filter((e) => e.type === "advance" || e.type === "abandon");

  // Apply structural edits, then reset non-terminal tasks
  if (structuralEdits.length > 0) {
    applyStructuralEdits(structuralEdits, taskMap, now);
    resetNonTerminalToDraft(result.tasks, now);
  }

  // Apply state edits (advance / abandon) with recompute
  if (stateEdits.length > 0) {
    applyStateEdits(stateEdits, taskMap, result, board, now);
  }

  return result;
}

// ── Compile Board ──

export function compileBoard(board: TaskBoardSnapshot, now: string): TaskBoardSnapshot {
  if (board.tasks.length === 0) {
    throw new Error("Cannot compile an empty board");
  }

  if (board.tasks.some((t) => ACTIVE_STATUSES.has(t.status))) {
    throw new Error(
      "Cannot compile board while tasks are implementing or reviewing. Complete or advance active tasks first.",
    );
  }

  const idSet = new Set(board.tasks.map((t) => t.id));
  if (idSet.size !== board.tasks.length) {
    throw new Error("Duplicate task ids found on the board");
  }

  for (const task of board.tasks) {
    const missing = findMissingDependencies(task.dependencies, idSet);
    if (missing.length > 0) {
      throw new Error(
        `Task "${task.id}" references non-existent dependencies: ${missing.join(", ")}`,
      );
    }
  }

  const cycle = detectCycle(board.tasks);
  if (cycle.length > 0) {
    throw new Error(`Dependency cycle detected: ${cycle.join(" → ")}`);
  }

  const result = cloneBoard(board);

  for (const task of result.tasks) {
    if (task.status === "draft") {
      task.status = "configured";
      task.updatedAt = now;
    }
  }

  recomputePhasesAndReadiness(result, board, now);

  return result;
}

// ── Claim Ready Tasks ──

export function claimReadyTasks(
  board: TaskBoardSnapshot,
  count: number,
  now: string,
): { board: TaskBoardSnapshot; claimed: TaskRecord[] } {
  if (count < 1) {
    throw new Error("count must be >= 1");
  }

  if (board.tasks.some((t) => ACTIVE_STATUSES.has(t.status))) {
    throw new Error(
      "Cannot claim tasks while tasks are implementing or reviewing. Complete or advance active tasks first.",
    );
  }

  const result = cloneBoard(board);

  const readyTasks = result.tasks
    .map((t, index) => ({ task: t, index }))
    .filter(({ task }) => task.status === "ready")
    .sort((a, b) => {
      if (a.task.phase !== b.task.phase) return a.task.phase - b.task.phase;
      return a.index - b.index;
    });

  const toClaim = readyTasks.slice(0, count);
  const claimed: TaskRecord[] = [];

  for (const { task } of toClaim) {
    task.status = "implementing";
    task.updatedAt = now;
    claimed.push({ ...task });
  }

  return { board: result, claimed };
}

// ── Query Functions ──

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

export function getActivePhase(board: TaskBoardSnapshot): number | null {
  const phase = board.phases.find((p) => p.status === "active");
  return phase ? phase.phase : null;
}

export function getReadyTasks(board: TaskBoardSnapshot): TaskRecord[] {
  return board.tasks
    .filter((t) => t.status === "ready")
    .sort((a, b) => {
      if (a.phase !== b.phase) return a.phase - b.phase;
      return board.tasks.indexOf(a) - board.tasks.indexOf(b);
    });
}

export { hasActionableTasks, hasBlockedNonTerminalTasks } from "./validation";
