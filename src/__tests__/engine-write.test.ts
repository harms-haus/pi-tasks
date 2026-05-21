import { describe, it, expect } from "vitest";
import { createEmptyBoard, writeTasks } from "../engine";
import { NOW } from "./helpers/engine-helpers";

// ═══════════════════════════════════════════
// 1. createEmptyBoard
// ═══════════════════════════════════════════

describe("createEmptyBoard", () => {
  it("returns correct empty shape", () => {
    const board = createEmptyBoard();
    expect(board.version).toBe(1);
    expect(board.tasks).toEqual([]);
    expect(board.phases).toEqual([]);
    expect(board.pendingPhasePrompt).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// 2. writeTasks
// ═══════════════════════════════════════════

describe("writeTasks", () => {
  it("creates draft tasks with phase-relative ids (t-phase.index)", () => {
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
    expect(result.tasks[0].id).toBe("t-1.1");
    expect(result.tasks[1].id).toBe("t-1.2");
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

  it("assigns independent indices per phase", () => {
    const board = createEmptyBoard();
    const result = writeTasks(
      board,
      [
        { title: "Task A", prompt: "Do A", profile: "coder", phase: 1 },
        { title: "Task B", prompt: "Do B", profile: "coder", phase: 2 },
        { title: "Task C", prompt: "Do C", profile: "coder", phase: 1 },
      ],
      NOW,
    );

    expect(result.tasks[0].id).toBe("t-1.1");
    expect(result.tasks[1].id).toBe("t-2.1");
    expect(result.tasks[2].id).toBe("t-1.2");
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
    expect(result.tasks[1].id).toBe("t-2.1");
  });

  it("continues phase-relative numbering from existing tasks", () => {
    let board = createEmptyBoard();
    board = writeTasks(
      board,
      [
        { title: "A", prompt: "P", profile: "c", phase: 1 },
        { title: "B", prompt: "P", profile: "c", phase: 1 },
      ],
      NOW,
    );
    const result = writeTasks(
      board,
      [{ title: "C", prompt: "P", profile: "c", phase: 1 }],
      NOW,
    );
    expect(result.tasks[2].id).toBe("t-1.3");
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
    expect(exact.tasks).toHaveLength(100);
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
