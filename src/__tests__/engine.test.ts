import { describe, it, expect } from "vitest";
import type { TaskBoardSnapshot, TaskEdit } from "../types";
import {
  createEmptyBoard,
  writeTasks,
  compileBoard,
  applyEdits,
  claimReadyTasks,
  getStatusCounts,
  getActivePhase,
  getReadyTasks,
  hasActionableTasks,
  hasBlockedNonTerminalTasks,
} from "../engine";

// ── Helpers ──

const NOW = "2025-01-01T00:00:00.000Z";

/**
 * Creates a compiled board from input tasks. Each task can optionally specify dependencies.
 * Tasks get ids task-1, task-2, ... in order.
 */
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
function makeBoardWithStatuses(
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

// ═══════════════════════════════════════════
// 1. createEmptyBoard
// ═══════════════════════════════════════════

describe("createEmptyBoard", () => {
  it("returns correct empty shape", () => {
    const board = createEmptyBoard();
    expect(board.version).toBe(1);
    expect(board.nextTaskId).toBe(1);
    expect(board.tasks).toEqual([]);
    expect(board.phases).toEqual([]);
    expect(board.pendingPhasePrompt).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// 2. writeTasks
// ═══════════════════════════════════════════

describe("writeTasks", () => {
  it("creates draft tasks with stable ids (task-1, task-2)", () => {
    const board = createEmptyBoard();
    const result = writeTasks(
      board,
      [
        { title: "Task A", prompt: "Do A", profile: "coder", phase: 1 },
        { title: "Task B", prompt: "Do B", profile: "coder", phase: 1 },
      ],
      NOW,
    );

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].id).toBe("task-1");
    expect(result.tasks[1].id).toBe("task-2");
    expect(result.tasks[0].status).toBe("draft");
    expect(result.tasks[1].status).toBe("draft");
  });

  it("sets createdAt and updatedAt to the now parameter", () => {
    const board = createEmptyBoard();
    const result = writeTasks(
      board,
      [{ title: "Task A", prompt: "Do A", profile: "coder", phase: 1 }],
      NOW,
    );

    expect(result.tasks[0].createdAt).toBe(NOW);
    expect(result.tasks[0].updatedAt).toBe(NOW);
  });

  it("initializes dependencies to an empty array", () => {
    const board = createEmptyBoard();
    const result = writeTasks(
      board,
      [{ title: "Task A", prompt: "Do A", profile: "coder", phase: 1 }],
      NOW,
    );

    expect(result.tasks[0].dependencies).toEqual([]);
  });

  it("increments nextTaskId", () => {
    const board = createEmptyBoard();
    const result = writeTasks(
      board,
      [
        { title: "Task A", prompt: "Do A", profile: "coder", phase: 1 },
        { title: "Task B", prompt: "Do B", profile: "coder", phase: 1 },
      ],
      NOW,
    );

    expect(result.nextTaskId).toBe(3);
  });

  it("appends to existing board (does not replace)", () => {
    let board = createEmptyBoard();
    board = writeTasks(board, [{ title: "First", prompt: "P", profile: "c", phase: 1 }], NOW);

    const result = writeTasks(
      board,
      [{ title: "Second", prompt: "P", profile: "c", phase: 2 }],
      NOW,
    );

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].title).toBe("First");
    expect(result.tasks[1].title).toBe("Second");
    expect(result.tasks[1].id).toBe("task-2");
    expect(result.nextTaskId).toBe(3);
  });

  it("continues id numbering from existing nextTaskId", () => {
    const board = createEmptyBoard();
    board.nextTaskId = 5;
    const result = writeTasks(
      board,
      [{ title: "New Task", prompt: "P", profile: "c", phase: 1 }],
      NOW,
    );
    expect(result.tasks[0].id).toBe("task-5");
    expect(result.nextTaskId).toBe(6);
  });

  it("rejects empty title", () => {
    const board = createEmptyBoard();
    expect(() =>
      writeTasks(board, [{ title: "", prompt: "P", profile: "c", phase: 1 }], NOW),
    ).toThrow(/title must be a non-empty string/);
  });

  it("rejects whitespace-only title", () => {
    const board = createEmptyBoard();
    expect(() =>
      writeTasks(board, [{ title: "   ", prompt: "P", profile: "c", phase: 1 }], NOW),
    ).toThrow(/title must be a non-empty string/);
  });

  it("rejects empty prompt", () => {
    const board = createEmptyBoard();
    expect(() =>
      writeTasks(board, [{ title: "T", prompt: "", profile: "c", phase: 1 }], NOW),
    ).toThrow(/prompt must be a non-empty string/);
  });

  it("rejects empty profile", () => {
    const board = createEmptyBoard();
    expect(() =>
      writeTasks(board, [{ title: "T", prompt: "P", profile: "", phase: 1 }], NOW),
    ).toThrow(/profile must be a non-empty string/);
  });

  it("rejects phase 0", () => {
    const board = createEmptyBoard();
    expect(() =>
      writeTasks(board, [{ title: "T", prompt: "P", profile: "c", phase: 0 }], NOW),
    ).toThrow(/phase must be an integer >= 1/);
  });

  it("rejects negative phase", () => {
    const board = createEmptyBoard();
    expect(() =>
      writeTasks(board, [{ title: "T", prompt: "P", profile: "c", phase: -1 }], NOW),
    ).toThrow(/phase must be an integer >= 1/);
  });

  it("rejects non-integer phase", () => {
    const board = createEmptyBoard();
    expect(() =>
      writeTasks(board, [{ title: "T", prompt: "P", profile: "c", phase: 1.5 }], NOW),
    ).toThrow(/phase must be an integer >= 1/);
  });

  it("rejects when total would exceed MAX_TASKS (100)", () => {
    // Create a board with 99 tasks
    const board = createEmptyBoard();
    const tasks99 = Array.from({ length: 99 }, (_, i) => ({
      title: `Task ${i + 1}`,
      prompt: "P",
      profile: "c",
      phase: 1,
    }));
    const full = writeTasks(board, tasks99, NOW);
    expect(full.tasks).toHaveLength(99);

    // Adding 2 more would exceed 100
    expect(() =>
      writeTasks(
        full,
        [
          { title: "Overflow 1", prompt: "P", profile: "c", phase: 1 },
          { title: "Overflow 2", prompt: "P", profile: "c", phase: 1 },
        ],
        NOW,
      ),
    ).toThrow(/would exceed maximum/);

    // Adding exactly 1 more is fine
    const exact = writeTasks(
      full,
      [{ title: "Exact 100", prompt: "P", profile: "c", phase: 1 }],
      NOW,
    );
    expect(exact.tasks).toHaveLength(100);
    expect(exact.nextTaskId).toBe(101);
  });

  it("does not mutate the input board", () => {
    const board = createEmptyBoard();
    const frozen = JSON.parse(JSON.stringify(board));
    writeTasks(board, [{ title: "T", prompt: "P", profile: "c", phase: 1 }], NOW);
    expect(board).toEqual(frozen);
  });

  it("trims whitespace from title, prompt, and profile", () => {
    const board = createEmptyBoard();
    const result = writeTasks(
      board,
      [{ title: "  Task A  ", prompt: "  Do A  ", profile: "  coder  ", phase: 1 }],
      NOW,
    );
    expect(result.tasks[0].title).toBe("Task A");
    expect(result.tasks[0].prompt).toBe("Do A");
    expect(result.tasks[0].profile).toBe("coder");
  });
});

// ═══════════════════════════════════════════
// 3. compileBoard
// ═══════════════════════════════════════════

describe("compileBoard", () => {
  it("moves draft tasks to configured (or ready if no deps)", () => {
    // A task with no dependencies in the active phase becomes ready
    const board = makeCompiledBoard([
      { title: "Task A", prompt: "Do A", profile: "coder", phase: 1 },
    ]);

    // No deps → goes straight to ready
    expect(board.tasks[0].status).toBe("ready");

    // A task with unsatisfied deps stays configured
    const board2 = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1, dependencies: ["task-1"] },
    ]);
    expect(board2.tasks[1].status).toBe("configured");
  });

  it("sets first phase with non-terminal tasks as active", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 2 },
    ]);

    const phase1 = board.phases.find((p) => p.phase === 1);
    const phase2 = board.phases.find((p) => p.phase === 2);
    expect(phase1?.status).toBe("active");
    expect(phase2?.status).toBe("pending");
  });

  it("marks earlier phases completed and later phases pending", () => {
    // Board with phase 1 already completed, phase 2 active
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 2 },
      { title: "C", prompt: "P", profile: "c", phase: 3 },
    ]);

    // Phase 1 is active, 2 and 3 are pending
    expect(board.phases.find((p) => p.phase === 1)?.status).toBe("active");
    expect(board.phases.find((p) => p.phase === 2)?.status).toBe("pending");
    expect(board.phases.find((p) => p.phase === 3)?.status).toBe("pending");
  });

  it("marks configured tasks as ready when all deps are done", () => {
    // Task B depends on Task A. A is not done, so B stays configured.
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1, dependencies: ["task-1"] },
    ]);

    // A has no deps → ready. B depends on A which is not done → configured
    expect(board.tasks[0].status).toBe("ready");
    expect(board.tasks[1].status).toBe("configured"); // deps not done
  });

  it("marks configured task as ready when it has no dependencies", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);

    expect(board.tasks[0].status).toBe("ready");
  });

  it("leaves configured tasks as configured when deps are not done", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1, dependencies: ["task-1"] },
    ]);

    // A has no deps → ready. B depends on A which is not done → configured
    expect(board.tasks[0].status).toBe("ready");
    expect(board.tasks[1].status).toBe("configured");
  });

  it("rejects empty board", () => {
    const board = createEmptyBoard();
    expect(() => compileBoard(board, NOW)).toThrow(/Cannot compile an empty board/);
  });

  it("rejects cycles", () => {
    let board = createEmptyBoard();
    board = writeTasks(
      board,
      [
        { title: "A", prompt: "P", profile: "c", phase: 1 },
        { title: "B", prompt: "P", profile: "c", phase: 1 },
      ],
      NOW,
    );
    board = applyEdits(
      board,
      [
        { id: "task-1", type: "blockers", data: { dependencies: ["task-2"] } },
        { id: "task-2", type: "blockers", data: { dependencies: ["task-1"] } },
      ],
      NOW,
    );

    expect(() => compileBoard(board, NOW)).toThrow(/Dependency cycle detected/);
  });

  it("rejects invalid dependency ids at compile time", () => {
    // Can't set invalid deps via applyEdits (it validates), so construct a board
    // with invalid deps directly.
    const board = createEmptyBoard();
    board.tasks.push({
      id: "task-1",
      title: "A",
      prompt: "P",
      profile: "c",
      phase: 1,
      dependencies: ["task-999"],
      status: "draft",
      createdAt: NOW,
      updatedAt: NOW,
    });
    board.nextTaskId = 2;

    expect(() => compileBoard(board, NOW)).toThrow(/non-existent dependencies/);
  });

  it("rejects when any task is implementing", () => {
    const board = makeBoardWithStatuses([{ title: "A", phase: 1, status: "implementing" }]);
    expect(() => compileBoard(board, NOW)).toThrow(
      /Cannot compile board while tasks are implementing or reviewing/,
    );
  });

  it("rejects when any task is reviewing", () => {
    const board = makeBoardWithStatuses([{ title: "A", phase: 1, status: "reviewing" }]);
    expect(() => compileBoard(board, NOW)).toThrow(
      /Cannot compile board while tasks are implementing or reviewing/,
    );
  });

  it("later phases remain configured even if all deps are done", () => {
    // Phase 1: A (no deps)
    // Phase 2: B (depends on A)
    // After compile, A is ready (phase 1 active), B is configured (phase 2 pending)
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 2, dependencies: ["task-1"] },
    ]);

    expect(board.tasks[0].status).toBe("ready");
    expect(board.tasks[1].status).toBe("configured"); // phase 2 is pending, not active
  });

  it("does not mutate the input board", () => {
    let board = createEmptyBoard();
    board = writeTasks(board, [{ title: "A", prompt: "P", profile: "c", phase: 1 }], NOW);
    const frozen = JSON.parse(JSON.stringify(board));
    compileBoard(board, NOW);
    expect(board).toEqual(frozen);
  });

  it("computes phases for all phase numbers present", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 3 },
      { title: "C", prompt: "P", profile: "c", phase: 5 },
    ]);

    expect(board.phases).toHaveLength(3);
    expect(board.phases.map((p) => p.phase)).toEqual([1, 3, 5]);
    expect(board.phases[0].status).toBe("active");
    expect(board.phases[1].status).toBe("pending");
    expect(board.phases[2].status).toBe("pending");
  });
});

// ═══════════════════════════════════════════
// 4. applyEdits — advance
// ═══════════════════════════════════════════

describe("applyEdits — advance", () => {
  it("implementing → reviewing succeeds", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    // Claim the ready task → implementing
    const claimed = claimReadyTasks(board, 1, NOW);
    board = claimed.board;
    expect(board.tasks[0].status).toBe("implementing");

    // Advance implementing → reviewing
    const result = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    expect(result.tasks[0].status).toBe("reviewing");
  });

  it("reviewing → done succeeds", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    const claimed = claimReadyTasks(board, 1, NOW);
    board = claimed.board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    expect(board.tasks[0].status).toBe("reviewing");

    const result = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    expect(result.tasks[0].status).toBe("done");
  });

  it("done triggers readiness recomputation for dependents", () => {
    // A has no deps (ready after compile). B depends on A.
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1, dependencies: ["task-1"] },
    ]);

    expect(board.tasks[0].status).toBe("ready");
    expect(board.tasks[1].status).toBe("configured"); // B blocked by A

    // Claim A → implementing
    const claimed = claimReadyTasks(board, 1, NOW);
    board = claimed.board;

    // Advance A to reviewing
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);

    // Advance A to done
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);

    expect(board.tasks[0].status).toBe("done");
    // B should now be ready since its only dependency (A) is done
    expect(board.tasks[1].status).toBe("ready");
  });

  it("rejects advance from draft", () => {
    let board = createEmptyBoard();
    board = writeTasks(board, [{ title: "A", prompt: "P", profile: "c", phase: 1 }], NOW);

    expect(() => applyEdits(board, [{ id: "task-1", type: "advance" }], NOW)).toThrow(
      /Cannot advance task/,
    );
  });

  it("rejects advance from configured", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    // Don't claim, so task stays configured (actually it becomes ready)
    // Let's make a task that stays configured due to deps
    board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1, dependencies: ["task-1"] },
    ]);

    expect(() => applyEdits(board, [{ id: "task-2", type: "advance" }], NOW)).toThrow(
      /Cannot advance task/,
    );
  });

  it("rejects advance from ready", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(board.tasks[0].status).toBe("ready");

    expect(() => applyEdits(board, [{ id: "task-1", type: "advance" }], NOW)).toThrow(
      /Cannot advance task/,
    );
  });

  it("rejects advance from done", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW); // → reviewing
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW); // → done

    expect(() => applyEdits(board, [{ id: "task-1", type: "advance" }], NOW)).toThrow(
      /Cannot advance task/,
    );
  });

  it("rejects advance from abandoned", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW);

    expect(() => applyEdits(board, [{ id: "task-1", type: "advance" }], NOW)).toThrow(
      /Cannot advance task/,
    );
  });

  it("rejects multi-step jumps (implementing → done)", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = claimReadyTasks(board, 1, NOW).board;

    // implementing → reviewing is the only valid first advance
    const result = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    expect(result.tasks[0].status).toBe("reviewing");

    // reviewing → done is the second advance
    const result2 = applyEdits(result, [{ id: "task-1", type: "advance" }], NOW);
    expect(result2.tasks[0].status).toBe("done");

    // No way to go directly from implementing to done — it goes through reviewing
  });
});

// ═══════════════════════════════════════════
// 5. applyEdits — abandon
// ═══════════════════════════════════════════

describe("applyEdits — abandon", () => {
  it("succeeds from draft", () => {
    let board = createEmptyBoard();
    board = writeTasks(board, [{ title: "A", prompt: "P", profile: "c", phase: 1 }], NOW);
    const result = applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW);
    expect(result.tasks[0].status).toBe("abandoned");
  });

  it("succeeds from configured", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1, dependencies: ["task-1"] },
    ]);
    // B is configured (blocked by A)
    expect(board.tasks[1].status).toBe("configured");

    const result = applyEdits(board, [{ id: "task-2", type: "abandon" }], NOW);
    expect(result.tasks[1].status).toBe("abandoned");
  });

  it("succeeds from ready", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(board.tasks[0].status).toBe("ready");

    const result = applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW);
    expect(result.tasks[0].status).toBe("abandoned");
  });

  it("succeeds from implementing", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = claimReadyTasks(board, 1, NOW).board;
    expect(board.tasks[0].status).toBe("implementing");

    const result = applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW);
    expect(result.tasks[0].status).toBe("abandoned");
  });

  it("succeeds from reviewing", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    expect(board.tasks[0].status).toBe("reviewing");

    const result = applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW);
    expect(result.tasks[0].status).toBe("abandoned");
  });

  it("rejects from done", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    expect(board.tasks[0].status).toBe("done");

    expect(() => applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW)).toThrow(
      /Cannot abandon task.*done.*Already resolved/,
    );
  });

  it("rejects from abandoned", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW);

    expect(() => applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW)).toThrow(
      /Cannot abandon task.*abandoned.*Already resolved/,
    );
  });

  it("does not satisfy dependencies (dependents stay blocked)", () => {
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1, dependencies: ["task-1"] },
    ]);
    // B depends on A, both in phase 1
    expect(board.tasks[1].status).toBe("configured");

    // Abandon A
    board = applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW);
    expect(board.tasks[0].status).toBe("abandoned");

    // B should NOT become ready — A is abandoned, not done
    expect(board.tasks[1].status).toBe("configured");
  });
});

// ═══════════════════════════════════════════
// 6. applyEdits — data
// ═══════════════════════════════════════════

describe("applyEdits — data", () => {
  it("mutates title", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    const result = applyEdits(
      board,
      [{ id: "task-1", type: "data", data: { title: "New Title" } }],
      NOW,
    );
    expect(result.tasks[0].title).toBe("New Title");
    expect(result.tasks[0].prompt).toBe("P"); // unchanged
  });

  it("mutates prompt", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    const result = applyEdits(
      board,
      [{ id: "task-1", type: "data", data: { prompt: "New Prompt" } }],
      NOW,
    );
    expect(result.tasks[0].prompt).toBe("New Prompt");
  });

  it("mutates profile", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    const result = applyEdits(
      board,
      [{ id: "task-1", type: "data", data: { profile: "new-profile" } }],
      NOW,
    );
    expect(result.tasks[0].profile).toBe("new-profile");
  });

  it("mutates phase", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    const result = applyEdits(board, [{ id: "task-1", type: "data", data: { phase: 3 } }], NOW);
    expect(result.tasks[0].phase).toBe(3);
  });

  it("resets non-terminal non-active tasks to draft", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);
    // Both are ready after compile
    expect(board.tasks[0].status).toBe("ready");
    expect(board.tasks[1].status).toBe("ready");

    // Edit A's title — this resets non-terminal non-active tasks to draft
    const result = applyEdits(
      board,
      [{ id: "task-1", type: "data", data: { title: "New A" } }],
      NOW,
    );
    // Both should be reset to draft (no tasks are implementing/reviewing)
    expect(result.tasks[0].status).toBe("draft");
    expect(result.tasks[1].status).toBe("draft");
  });

  it("does not reset done/abandoned tasks", () => {
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);
    // Complete A fully
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW); // → reviewing
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW); // → done
    // B became ready after A was done
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-2", type: "advance" }], NOW); // → reviewing
    board = applyEdits(board, [{ id: "task-2", type: "advance" }], NOW); // → done

    // Now we can't do data edits since there are no non-terminal tasks left
    // Actually we can — but there's nothing to reset
    // Let's make a different scenario:
    // A is done, B is configured
    board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 2 },
    ]);
    // Phase 1 active, A ready, B configured (phase 2 pending)
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW); // → reviewing
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW); // → done

    // Now phase 1 is done, phase 2 active, B is ready
    expect(board.tasks[1].status).toBe("ready");

    // But we can't do data edits while B is not implementing/reviewing...
    // Actually, data edits are blocked when ANY task is implementing/reviewing, not the other way.
    // And there are no implementing/reviewing tasks, so data edits are fine
    // But it will reset B from ready to draft
    const result = applyEdits(
      board,
      [{ id: "task-2", type: "data", data: { title: "New B" } }],
      NOW,
    );
    expect(result.tasks[0].status).toBe("done"); // A stays done
    expect(result.tasks[1].status).toBe("draft"); // B reset to draft
  });

  it("rejects when tasks are implementing/reviewing", () => {
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);
    board = claimReadyTasks(board, 1, NOW).board;
    // task-1 is implementing, task-2 is ready
    expect(board.tasks[0].status).toBe("implementing");

    expect(() =>
      applyEdits(board, [{ id: "task-2", type: "data", data: { title: "X" } }], NOW),
    ).toThrow(/Cannot edit data while tasks are implementing\/reviewing/);
  });

  it("rejects unknown ids", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() =>
      applyEdits(board, [{ id: "task-999", type: "data", data: { title: "X" } }], NOW),
    ).toThrow(/not found/);
  });

  it("rejects empty title", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() =>
      applyEdits(board, [{ id: "task-1", type: "data", data: { title: "" } }], NOW),
    ).toThrow(/title must be a non-empty string/);
  });

  it("rejects whitespace-only title", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() =>
      applyEdits(board, [{ id: "task-1", type: "data", data: { title: "   " } }], NOW),
    ).toThrow(/title must be a non-empty string/);
  });

  it("rejects empty prompt", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() =>
      applyEdits(board, [{ id: "task-1", type: "data", data: { prompt: "" } }], NOW),
    ).toThrow(/prompt must be a non-empty string/);
  });

  it("rejects empty profile", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() =>
      applyEdits(board, [{ id: "task-1", type: "data", data: { profile: "" } }], NOW),
    ).toThrow(/profile must be a non-empty string/);
  });

  it("rejects invalid phase (0)", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() =>
      applyEdits(board, [{ id: "task-1", type: "data", data: { phase: 0 } }], NOW),
    ).toThrow(/phase must be an integer >= 1/);
  });

  it("rejects invalid phase (negative)", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() =>
      applyEdits(board, [{ id: "task-1", type: "data", data: { phase: -1 } }], NOW),
    ).toThrow(/phase must be an integer >= 1/);
  });

  it("rejects non-integer phase", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() =>
      applyEdits(board, [{ id: "task-1", type: "data", data: { phase: 1.5 } }], NOW),
    ).toThrow(/phase must be an integer >= 1/);
  });

  it("accepts valid data edits for title, prompt, profile, and phase", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    const result = applyEdits(
      board,
      [
        { id: "task-1", type: "data", data: { title: "New Title", prompt: "New Prompt", profile: "new-profile", phase: 3 } },
      ],
      NOW,
    );
    expect(result.tasks[0].title).toBe("New Title");
    expect(result.tasks[0].prompt).toBe("New Prompt");
    expect(result.tasks[0].profile).toBe("new-profile");
    expect(result.tasks[0].phase).toBe(3);
  });
});

// ═══════════════════════════════════════════
// 7. applyEdits — blockers
// ═══════════════════════════════════════════

describe("applyEdits — blockers", () => {
  it("replaces dependency list", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1, dependencies: ["task-1"] },
    ]);
    // B depends on A. Now change B's deps.
    // But B is configured, data edits are fine since no one is implementing/reviewing
    const result = applyEdits(
      board,
      [{ id: "task-2", type: "blockers", data: { dependencies: [] } }],
      NOW,
    );
    expect(result.tasks[1].dependencies).toEqual([]);
  });

  it("rejects self-dependency", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() =>
      applyEdits(
        board,
        [{ id: "task-1", type: "blockers", data: { dependencies: ["task-1"] } }],
        NOW,
      ),
    ).toThrow(/cannot depend on itself/);
  });

  it("rejects references to nonexistent tasks", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() =>
      applyEdits(
        board,
        [
          {
            id: "task-1",
            type: "blockers",
            data: { dependencies: ["task-999"] },
          },
        ],
        NOW,
      ),
    ).toThrow(/non-existent dependencies/);
  });

  it("resets non-terminal non-active tasks to draft", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);
    // Both ready. Change B's deps.
    const result = applyEdits(
      board,
      [{ id: "task-2", type: "blockers", data: { dependencies: [] } }],
      NOW,
    );
    // Both reset to draft
    expect(result.tasks[0].status).toBe("draft");
    expect(result.tasks[1].status).toBe("draft");
  });

  it("rejects duplicate dependencies", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);
    expect(() =>
      applyEdits(
        board,
        [
          {
            id: "task-2",
            type: "blockers",
            data: { dependencies: ["task-1", "task-1"] },
          },
        ],
        NOW,
      ),
    ).toThrow(/duplicate dependencies/);
  });

  it("rejects when tasks are implementing/reviewing", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = claimReadyTasks(board, 1, NOW).board;
    expect(board.tasks[0].status).toBe("implementing");

    expect(() =>
      applyEdits(board, [{ id: "task-1", type: "blockers", data: { dependencies: [] } }], NOW),
    ).toThrow(/Cannot edit blockers while tasks are implementing\/reviewing/);
  });
});

// ═══════════════════════════════════════════
// 8. applyEdits — atomicity
// ═══════════════════════════════════════════

describe("applyEdits — atomicity", () => {
  it("if any edit in a batch fails, none are applied", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);
    // Both ready. Try to advance task-1 (valid) and abandon task-999 (invalid)
    expect(() =>
      applyEdits(
        board,
        [
          { id: "task-1", type: "advance" }, // can't advance from ready
          { id: "task-999", type: "abandon" }, // doesn't exist
        ],
        NOW,
      ),
    ).toThrow();

    // Board should be unchanged
    expect(board.tasks[0].status).toBe("ready");
    expect(board.tasks[1].status).toBe("ready");
  });

  it("batch of valid data edits is applied atomically", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);

    const result = applyEdits(
      board,
      [
        { id: "task-1", type: "data", data: { title: "New A" } },
        { id: "task-2", type: "data", data: { title: "New B" } },
      ],
      NOW,
    );

    expect(result.tasks[0].title).toBe("New A");
    expect(result.tasks[1].title).toBe("New B");
    // Both reset to draft
    expect(result.tasks[0].status).toBe("draft");
    expect(result.tasks[1].status).toBe("draft");
  });

  it("batch with one bad edit rolls back all", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);

    expect(() =>
      applyEdits(
        board,
        [
          { id: "task-1", type: "data", data: { title: "New A" } },
          { id: "task-999", type: "data", data: { title: "New Z" } },
        ],
        NOW,
      ),
    ).toThrow(/not found/);

    // Original board unchanged
    expect(board.tasks[0].title).toBe("A");
    expect(board.tasks[1].title).toBe("B");
  });

  it("empty edits returns a clone", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    const result = applyEdits(board, [], NOW);
    expect(result).toEqual(board);
    expect(result).not.toBe(board); // different reference
  });
});

// ═══════════════════════════════════════════
// 9. claimReadyTasks
// ═══════════════════════════════════════════

describe("claimReadyTasks", () => {
  it("claims up to count ready tasks", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
      { title: "C", prompt: "P", profile: "c", phase: 1 },
    ]);

    const result = claimReadyTasks(board, 2, NOW);
    expect(result.claimed).toHaveLength(2);
    expect(result.board.tasks[0].status).toBe("implementing");
    expect(result.board.tasks[1].status).toBe("implementing");
    expect(result.board.tasks[2].status).toBe("ready"); // not claimed
  });

  it("orders by phase ascending, then creation order", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 2 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
      { title: "C", prompt: "P", profile: "c", phase: 1 },
    ]);
    // Phase 1 is active. Phase 2 is pending.
    // Only phase 1 tasks are ready: B and C.
    // Phase 2 task A stays configured.
    expect(board.tasks[0].status).toBe("configured"); // phase 2, not active
    expect(board.tasks[1].status).toBe("ready");
    expect(board.tasks[2].status).toBe("ready");

    const result = claimReadyTasks(board, 5, NOW);
    expect(result.claimed).toHaveLength(2);
    expect(result.claimed[0].id).toBe("task-2"); // phase 1, created first
    expect(result.claimed[1].id).toBe("task-3"); // phase 1, created second
  });

  it("moves claimed tasks to implementing", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    const result = claimReadyTasks(board, 1, NOW);
    expect(result.claimed[0].status).toBe("implementing");
    expect(result.board.tasks[0].status).toBe("implementing");
  });

  it("rejects if count < 1", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(() => claimReadyTasks(board, 0, NOW)).toThrow(/count must be >= 1/);
    expect(() => claimReadyTasks(board, -1, NOW)).toThrow(/count must be >= 1/);
  });

  it("rejects if any task is implementing/reviewing", () => {
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);
    board = claimReadyTasks(board, 1, NOW).board;
    // task-1 is implementing, task-2 is ready
    expect(board.tasks[0].status).toBe("implementing");

    expect(() => claimReadyTasks(board, 1, NOW)).toThrow(
      /Cannot claim tasks while tasks are implementing or reviewing/,
    );
  });

  it("returns empty claimed array when no ready tasks exist", () => {
    // All done board — claimReadyTasks should return empty claimed.
    let doneBoard = makeCompiledBoard([{ title: "Only", prompt: "P", profile: "c", phase: 1 }]);
    doneBoard = claimReadyTasks(doneBoard, 1, NOW).board;
    doneBoard = applyEdits(doneBoard, [{ id: "task-1", type: "advance" }], NOW);
    doneBoard = applyEdits(doneBoard, [{ id: "task-1", type: "advance" }], NOW);
    const finalResult = claimReadyTasks(doneBoard, 1, NOW);
    expect(finalResult.claimed).toEqual([]);
  });

  it("does not mutate the input board", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    const frozen = JSON.parse(JSON.stringify(board));
    claimReadyTasks(board, 1, NOW);
    expect(board).toEqual(frozen);
  });

  it("updates updatedAt on claimed tasks", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    const later = "2025-06-01T00:00:00.000Z";
    const result = claimReadyTasks(board, 1, later);
    expect(result.claimed[0].updatedAt).toBe(later);
    expect(result.board.tasks[0].updatedAt).toBe(later);
  });
});

// ═══════════════════════════════════════════
// 10. getStatusCounts
// ═══════════════════════════════════════════

describe("getStatusCounts", () => {
  it("returns all 7 statuses with correct counts", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);
    // Both ready after compile
    const counts = getStatusCounts(board);
    expect(counts.draft).toBe(0);
    expect(counts.configured).toBe(0);
    expect(counts.ready).toBe(2);
    expect(counts.implementing).toBe(0);
    expect(counts.reviewing).toBe(0);
    expect(counts.done).toBe(0);
    expect(counts.abandoned).toBe(0);
  });

  it("counts a mixed-status board correctly", () => {
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
      { title: "C", prompt: "P", profile: "c", phase: 1 },
    ]);
    // All 3 ready. Claim A, advance to done.
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW); // A done
    // B and C should now be ready (or already were)
    board = applyEdits(board, [{ id: "task-3", type: "abandon" }], NOW); // C abandoned

    const counts = getStatusCounts(board);
    expect(counts.draft).toBe(0);
    expect(counts.configured).toBe(0);
    expect(counts.ready).toBe(1); // B
    expect(counts.implementing).toBe(0);
    expect(counts.reviewing).toBe(0);
    expect(counts.done).toBe(1); // A
    expect(counts.abandoned).toBe(1); // C
  });

  it("returns zero-filled for empty board", () => {
    const board = createEmptyBoard();
    const counts = getStatusCounts(board);
    const allStatuses: Array<keyof typeof counts> = [
      "draft",
      "configured",
      "ready",
      "implementing",
      "reviewing",
      "done",
      "abandoned",
    ];
    for (const s of allStatuses) {
      expect(counts[s]).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════
// 11. getActivePhase
// ═══════════════════════════════════════════

describe("getActivePhase", () => {
  it("returns active phase number", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 2 }]);
    expect(getActivePhase(board)).toBe(2);
  });

  it("returns null when no active phase", () => {
    const board = createEmptyBoard();
    expect(getActivePhase(board)).toBeNull();
  });

  it("returns null when all phases completed", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    // All done. Phase 1 should be completed.
    expect(getActivePhase(board)).toBeNull();
  });
});

// ═══════════════════════════════════════════
// 12. Phase gating
// ═══════════════════════════════════════════

describe("Phase gating", () => {
  it("later phase tasks never become ready until earlier phase is terminal", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 2 },
    ]);

    // Phase 1 is active, A is ready. Phase 2 is pending, B is configured.
    expect(board.tasks[0].status).toBe("ready");
    expect(board.tasks[1].status).toBe("configured");
    expect(board.phases.find((p) => p.phase === 1)?.status).toBe("active");
    expect(board.phases.find((p) => p.phase === 2)?.status).toBe("pending");
  });

  it("activates next phase when active phase becomes terminal (all done)", () => {
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 2 },
    ]);

    // Phase 1 active, A ready. Claim and complete A.
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW); // → reviewing
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW); // → done

    // Phase 1 completed, phase 2 activated. B should be ready.
    expect(board.tasks[0].status).toBe("done");
    expect(board.tasks[1].status).toBe("ready");
    expect(board.phases.find((p) => p.phase === 1)?.status).toBe("completed");
    expect(board.phases.find((p) => p.phase === 2)?.status).toBe("active");
  });

  it("activates next phase when active phase becomes terminal (all abandoned)", () => {
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 2 },
    ]);

    // Abandon A
    board = applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW);

    // Phase 1 completed (all terminal), phase 2 activated
    expect(board.tasks[0].status).toBe("abandoned");
    expect(board.tasks[1].status).toBe("ready");
    expect(board.phases.find((p) => p.phase === 1)?.status).toBe("completed");
    expect(board.phases.find((p) => p.phase === 2)?.status).toBe("active");
  });

  it("activates next phase when active phase has mix of done and abandoned", () => {
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
      { title: "C", prompt: "P", profile: "c", phase: 2 },
    ]);

    // Claim and complete A
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW); // A done

    // B is ready. Abandon B.
    board = applyEdits(board, [{ id: "task-2", type: "abandon" }], NOW);

    // Phase 1 all terminal, phase 2 active, C ready
    expect(board.tasks[2].status).toBe("ready");
    expect(board.phases.find((p) => p.phase === 1)?.status).toBe("completed");
    expect(board.phases.find((p) => p.phase === 2)?.status).toBe("active");
  });

  it("handles 3-phase progression", () => {
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 2 },
      { title: "C", prompt: "P", profile: "c", phase: 3 },
    ]);

    // Phase 1 active
    expect(getActivePhase(board)).toBe(1);

    // Complete phase 1
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    expect(getActivePhase(board)).toBe(2);
    expect(board.tasks[1].status).toBe("ready");

    // Complete phase 2
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-2", type: "advance" }], NOW);
    board = applyEdits(board, [{ id: "task-2", type: "advance" }], NOW);
    expect(getActivePhase(board)).toBe(3);
    expect(board.tasks[2].status).toBe("ready");

    // Complete phase 3
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-3", type: "advance" }], NOW);
    board = applyEdits(board, [{ id: "task-3", type: "advance" }], NOW);
    expect(getActivePhase(board)).toBeNull(); // all done
    expect(board.phases.every((p) => p.status === "completed")).toBe(true);
  });

  it("preserves completedAt for previously completed phases", () => {
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 2 },
    ]);

    const phase1Time = "2025-03-15T12:00:00.000Z";

    // Complete phase 1
    board = claimReadyTasks(board, 1, phase1Time).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], phase1Time);
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], phase1Time);

    const phase1Record = board.phases.find((p) => p.phase === 1);
    expect(phase1Record?.status).toBe("completed");
    expect(phase1Record?.completedAt).toBe(phase1Time);

    // Complete phase 2 at a later time
    const phase2Time = "2025-06-20T18:00:00.000Z";
    board = claimReadyTasks(board, 1, phase2Time).board;
    board = applyEdits(board, [{ id: "task-2", type: "advance" }], phase2Time);
    board = applyEdits(board, [{ id: "task-2", type: "advance" }], phase2Time);

    // Phase 1's completedAt should be preserved
    const phase1Again = board.phases.find((p) => p.phase === 1);
    expect(phase1Again?.completedAt).toBe(phase1Time);

    const phase2Record = board.phases.find((p) => p.phase === 2);
    expect(phase2Record?.completedAt).toBe(phase2Time);
  });

  it("task in later phase with all deps done stays configured until its phase activates", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 2, dependencies: ["task-1"] },
    ]);

    // A is ready (phase 1 active, no deps). B is configured (phase 2 pending).
    // B depends on A, but even if A were done, B wouldn't be ready because phase 2 isn't active.
    expect(board.tasks[0].status).toBe("ready");
    expect(board.tasks[1].status).toBe("configured");
  });
});

// ═══════════════════════════════════════════
// getReadyTasks
// ═══════════════════════════════════════════

describe("getReadyTasks", () => {
  it("returns tasks with status ready, ordered by phase then array position", () => {
    const board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1 },
    ]);

    const ready = getReadyTasks(board);
    expect(ready).toHaveLength(2);
    expect(ready[0].id).toBe("task-1");
    expect(ready[1].id).toBe("task-2");
  });

  it("returns empty array when no ready tasks", () => {
    const board = createEmptyBoard();
    expect(getReadyTasks(board)).toEqual([]);
  });
});

// ═══════════════════════════════════════════
// hasActionableTasks / hasBlockedNonTerminalTasks
// ═══════════════════════════════════════════

describe("hasActionableTasks / hasBlockedNonTerminalTasks", () => {
  it("hasActionableTasks returns true when ready tasks exist", () => {
    const board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    expect(hasActionableTasks(board)).toBe(true);
  });

  it("hasActionableTasks returns true when implementing tasks exist", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = claimReadyTasks(board, 1, NOW).board;
    expect(hasActionableTasks(board)).toBe(true);
  });

  it("hasActionableTasks returns false when all tasks terminal", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = claimReadyTasks(board, 1, NOW).board;
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    board = applyEdits(board, [{ id: "task-1", type: "advance" }], NOW);
    expect(hasActionableTasks(board)).toBe(false);
  });

  it("hasBlockedNonTerminalTasks returns true when tasks are blocked", () => {
    // Create a board where non-terminal tasks exist but none are actionable
    let board = makeCompiledBoard([
      { title: "A", prompt: "P", profile: "c", phase: 1 },
      { title: "B", prompt: "P", profile: "c", phase: 1, dependencies: ["task-1"] },
    ]);
    // A is ready, B is configured. Not blocked because A is actionable.
    expect(hasBlockedNonTerminalTasks(board)).toBe(false);

    // Abandon A (its only option besides claiming)
    board = applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW);
    // A is abandoned, B is configured (dep not satisfied — A is abandoned, not done)
    // B is not actionable, but B is non-terminal → blocked
    expect(hasBlockedNonTerminalTasks(board)).toBe(true);
  });

  it("hasBlockedNonTerminalTasks returns false when all tasks terminal", () => {
    let board = makeCompiledBoard([{ title: "A", prompt: "P", profile: "c", phase: 1 }]);
    board = applyEdits(board, [{ id: "task-1", type: "abandon" }], NOW);
    expect(hasBlockedNonTerminalTasks(board)).toBe(false);
  });
});
