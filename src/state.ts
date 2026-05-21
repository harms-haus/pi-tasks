import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TaskBoardSnapshot } from "./types";
import { CUSTOM_EVENT_TYPE, CUSTOM_SNAPSHOT_TYPE } from "./types";
import { createEmptyBoard } from "./engine";
import { isValidSnapshot, cloneBoard, getStatusCounts } from "./validation";

// ── Mutable State ──

let board: TaskBoardSnapshot = createEmptyBoard();
let autoContinueCount = 0;
let lastToolWasAdvance = false;
let advanceWarningPending = false;

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

/** Returns whether the last tool result was from advance_tasks. */
export function getLastToolWasAdvance(): boolean {
  return lastToolWasAdvance;
}

/** Set the last-tool-was-advance flag. */
export function setLastToolWasAdvance(value: boolean): void {
  lastToolWasAdvance = value;
}

/** Check and consume the advance warning flag. Returns true if warning should be shown, then resets. */
export function consumeAdvanceWarning(): boolean {
  if (advanceWarningPending) {
    advanceWarningPending = false;
    return true;
  }
  return false;
}

/** Set the advance warning pending flag. */
export function setAdvanceWarningPending(value: boolean): void {
  advanceWarningPending = value;
}

/** Resets all mutable state. For testing only. */
export function resetState(): void {
  board = createEmptyBoard();
  autoContinueCount = 0;
  lastToolWasAdvance = false;
  advanceWarningPending = false;
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
    ctx.ui.setStatus("til-done", undefined);
    ctx.ui.setStatus("til-done-active", undefined);
    return;
  }

  const counts = getStatusCounts(snapshot);

  const done = counts.done + counts.abandoned;
  const total = snapshot.tasks.length;

  const activePhase = snapshot.phases.find((p) => p.status === "active");
  const phaseLabel = activePhase ? `Phase ${activePhase.phase}` : "No active phase";

  ctx.ui.setStatus("til-done", `${done}/${total} - ${phaseLabel}`);

  const activeLines: string[] = [];
  for (const t of snapshot.tasks) {
    if (t.status === "implementing" || t.status === "reviewing") {
      activeLines.push(`[${t.id}] ${t.title}`);
    }
  }
  ctx.ui.setStatus(
    "til-done-active",
    activeLines.length > 0 ? activeLines.join("\n") : undefined,
  );
}
