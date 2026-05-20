import type { TaskBoardSnapshot, TaskEdit } from "../../types";
import { createEmptyBoard, writeTasks, compileBoard, applyEdits } from "../../engine";

// ── Shared constants ──

export const NOW = "2025-01-01T00:00:00.000Z";

// ── Shared helpers ──

/**
 * Creates a compiled board from input tasks. Each task can optionally specify dependencies.
 * Tasks get ids task-1, task-2, ... in order.
 */
export function makeCompiledBoard(
  tasks: Array<{
    title: string;
    prompt: string;
    profile: string;
    phase: number;
    dependencies?: string[];
  }>,
): TaskBoardSnapshot {
  let board = createEmptyBoard();
  board = writeTasks(
    board,
    tasks.map(({ title, prompt, profile, phase }) => ({ title, prompt, profile, phase })),
    NOW,
  );

  // Add dependencies via blockers edits if provided
  const edits: TaskEdit[] = [];
  tasks.forEach((t, i) => {
    if (t.dependencies && t.dependencies.length > 0) {
      edits.push({
        id: `task-${i + 1}`,
        type: "blockers",
        data: { dependencies: t.dependencies },
      });
    }
  });
  if (edits.length > 0) {
    board = applyEdits(board, edits, NOW);
  }

  return compileBoard(board, NOW);
}

/**
 * Creates a board with tasks in specific statuses. Each task gets id task-1, task-2, etc.
 * Does NOT compile the board — phases are not computed.
 */
export function makeBoardWithStatuses(
  tasks: Array<{
    title: string;
    phase: number;
    status: TaskBoardSnapshot["tasks"][0]["status"];
    dependencies?: string[];
  }>,
): TaskBoardSnapshot {
  const board = createEmptyBoard();
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    board.tasks.push({
      id: `task-${i + 1}`,
      title: t.title,
      prompt: `Prompt for ${t.title}`,
      profile: "default",
      phase: t.phase,
      dependencies: t.dependencies ?? [],
      status: t.status,
      createdAt: NOW,
      updatedAt: NOW,
    });
    board.nextTaskId = i + 2;
  }
  return board;
}
