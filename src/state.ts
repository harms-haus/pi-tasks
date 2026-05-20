import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskBoardSnapshot } from "./types";
import { CUSTOM_EVENT_TYPE, CUSTOM_SNAPSHOT_TYPE } from "./types";
import { createEmptyBoard } from "./engine";
import { isValidSnapshot, cloneBoard, getStatusCounts } from "./validation";

// ── Mutable State ──

let board: TaskBoardSnapshot = createEmptyBoard();
let autoContinueCount = 0;

// ── State Accessors ──

/** Returns a deep copy of the current board. */
export function getBoard(): TaskBoardSnapshot {
  return cloneBoard(board);
}

/** Replaces the board state. Resets auto-continue counter. */
export function setBoard(newBoard: TaskBoardSnapshot): void {
  board = cloneBoard(newBoard);
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
  pi.appendEntry(CUSTOM_SNAPSHOT_TYPE, cloneBoard(snapshot));
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
