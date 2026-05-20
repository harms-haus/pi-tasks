import type { TaskBoardSnapshot, TaskRecord, TaskStatus } from "./types";
import { STATUS_ICONS } from "./types";
import { getStatusCounts } from "./validation";

// ── Plain-Text Formatting (for LLM tool output) ──

/** Returns the plain-text icon for a task status. */
function getStatusIcon(status: TaskStatus): string {
  return STATUS_ICONS[status];
}

/** Format a single task as a plain-text line. */
function formatTaskLine(task: TaskRecord): string {
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
  const counts = getStatusCounts(board);
  const parts: string[] = [];
  for (const [status, count] of Object.entries(counts)) {
    if (count > 0) parts.push(`${count} ${status}`);
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
  const counts = getStatusCounts(board);
  lines.push(
    `Status: ${Object.entries(counts)
      .filter(([, c]) => c > 0)
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

  // Non-terminal tasks
  lines.push("");
  lines.push("Remaining tasks:");
  const nonTerminal = board.tasks.filter((t) => t.status !== "done" && t.status !== "abandoned");
  for (const t of nonTerminal) {
    lines.push(`  ${formatTaskLine(t)}`);
  }

  // Recently completed (up to 10)
  const terminal = board.tasks.filter((t) => t.status === "done" || t.status === "abandoned");
  if (terminal.length > 0) {
    lines.push("");
    lines.push("Recently completed:");
    const sorted = [...terminal].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const recent = sorted.slice(0, 10);
    if (terminal.length > 10) {
      lines.push(`  ... and ${terminal.length - 10} more terminal tasks`);
    }
    for (const t of recent) {
      lines.push(`  ${formatTaskLine(t)}`);
    }
  }

  lines.push("");
  lines.push(
    "Workflow: write_tasks → edit_tasks (blockers/data) → compile_tasks → get_ready_tasks → edit_tasks (advance) → done",
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
