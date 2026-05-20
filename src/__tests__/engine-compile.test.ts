import { describe, it, expect } from "vitest";
import { createEmptyBoard, writeTasks, compileBoard, applyEdits } from "../engine";
import { NOW, makeCompiledBoard, makeBoardWithStatuses } from "./helpers/engine-helpers";

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
