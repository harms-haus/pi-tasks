import { Text } from "@earendil-works/pi-tui";
import type {
  ToolDefinition,
  ExtensionAPI,
  AgentToolResult,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  WriteTasksParams,
  EditTasksParams,
  CompileTasksParams,
  ClearTasksParams,
  GetReadyTasksParams,
} from "./schemas";
import { cloneBoard } from "./validation";
import { CUSTOM_EVENT_TYPE, CUSTOM_SNAPSHOT_TYPE, TERMINAL_STATUSES } from "./types";
import type { TaskBoardSnapshot, TaskEdit, TaskWorkflowEvent } from "./types";
import {
  writeTasks,
  applyEdits,
  compileBoard,
  createEmptyBoard,
  claimReadyTasks,
  getStatusCounts,
} from "./engine";
import { getBoard, setBoard, persistEntries, updateUI } from "./state";
import { loadConfig, resolvePhasePrompt } from "./config";
import { formatBoardText, formatSummaryLine, formatAllDoneMessage } from "./formatting";

// ── Details Type ──

interface TaskToolDetails {
  snapshot: TaskBoardSnapshot;
  error?: string;
}

// ── Result Helpers ──

function makeSuccessResult(
  text: string,
  snapshot: TaskBoardSnapshot,
): AgentToolResult<TaskToolDetails> {
  return {
    content: [{ type: "text", text }],
    details: { snapshot },
  };
}

function makeErrorResult(
  errorText: string,
  snapshot: TaskBoardSnapshot,
): AgentToolResult<TaskToolDetails> {
  return {
    content: [{ type: "text", text: errorText }],
    details: { snapshot, error: errorText },
  };
}

/** Check for phases that just completed (before vs after) and set pending phase prompt. */
async function checkAndSetPhaseCompletion(
  beforePhases: TaskBoardSnapshot["phases"],
  afterBoard: TaskBoardSnapshot,
): Promise<void> {
  // Find phases that were NOT completed before but ARE completed after
  for (const afterPhase of afterBoard.phases) {
    if (afterPhase.status !== "completed") continue;
    const beforePhase = beforePhases.find((p) => p.phase === afterPhase.phase);
    if (!beforePhase || beforePhase.status !== "completed") {
      // This phase just completed
      const config = await loadConfig();
      const template = config.phaseCompletionPromptTemplate
        ? resolvePhasePrompt(config.phaseCompletionPromptTemplate, afterPhase.phase)
        : undefined;
      if (template) {
        afterBoard.pendingPhasePrompt = {
          phase: afterPhase.phase,
          message: template,
        };
      }
      return; // Only handle the first newly completed phase
    }
  }
}

// ── Shared Result Renderer ──

function renderResult(
  result: AgentToolResult<TaskToolDetails>,
  _options: { expanded: boolean; isPartial: boolean },
  theme: Theme,
): Text {
  const details = result.details as TaskToolDetails | undefined;
  const text = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
  if (!details) {
    return new Text(text, 0, 0);
  }
  if (details.error) {
    return new Text(theme.fg("error", details.error), 0, 0);
  }
  return new Text(theme.fg("text", text), 0, 0);
}

// ── Tool 1: write_tasks ──

export function createWriteTasksTool(
  pi: ExtensionAPI,
): ToolDefinition<typeof WriteTasksParams, TaskToolDetails> {
  return {
    name: "write_tasks",
    label: "Write Tasks",
    description:
      "Add tasks to the phased task board. Each task requires a title, prompt, profile, and phase number (>= 1). Tasks are created in 'draft' status. After writing, use compile_tasks to validate dependencies and activate phases.",
    parameters: WriteTasksParams,
    promptSnippet:
      "Phased task board: write, edit (data/blockers/advance/abandon), compile, claim ready tasks",
    promptGuidelines: [
      "Use write_tasks to add tasks to the board. Each task needs title, prompt, profile, and phase.",
      "Use edit_tasks with type 'data' to modify task title/prompt/profile/phase.",
      "Use edit_tasks with type 'blockers' to set task dependencies.",
      "Use compile_tasks to validate and activate the board after writing/editing.",
      "Use get_ready_tasks to claim tasks that are ready to work on.",
      "Use edit_tasks with type 'advance' to move implementing → reviewing → done.",
      "Use edit_tasks with type 'abandon' to skip tasks no longer needed.",
      "Tasks in later phases only become ready after earlier phases are complete.",
    ],

    // eslint-disable-next-line @typescript-eslint/require-await
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const board = getBoard();
      const now = new Date().toISOString();

      try {
        const newBoard = writeTasks(board, params.tasks, now);
        setBoard(newBoard);

        const event: TaskWorkflowEvent = {
          type: "write_tasks",
          tasks: newBoard.tasks.slice(-params.tasks.length).map((t) => ({
            id: t.id,
            title: t.title,
            prompt: t.prompt,
            profile: t.profile,
            phase: t.phase,
          })),
        };
        persistEntries(pi, event, newBoard);
        updateUI(ctx, newBoard);

        return makeSuccessResult(
          `Added ${params.tasks.length} task(s) to the board.\n\n${formatBoardText(newBoard)}`,
          newBoard,
        );
      } catch (err) {
        return makeErrorResult(err instanceof Error ? err.message : String(err), board);
      }
    },

    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("write_tasks ")) +
          theme.fg("muted", `(${args.tasks.length} items)`),
        0,
        0,
      );
    },

    renderResult,
  };
}

// ── Tool 2: edit_tasks ──

export function createEditTasksTool(
  pi: ExtensionAPI,
): ToolDefinition<typeof EditTasksParams, TaskToolDetails> {
  return {
    name: "edit_tasks",
    label: "Edit Tasks",
    description:
      "Batch-edit tasks on the board. Supports four edit types: 'data' (modify title/prompt/profile/phase), 'blockers' (set dependencies), 'advance' (implementing→reviewing or reviewing→done), and 'abandon' (mark as abandoned). Edits are atomic — if any fails, none are applied.",
    parameters: EditTasksParams,
    promptSnippet: undefined,
    promptGuidelines: undefined,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const board = getBoard();
      const now = new Date().toISOString();

      // Snapshot before-phases for phase completion detection
      const beforePhases = board.phases.map((p) => ({ ...p }));

      const edits: TaskEdit[] = params.tasks.map((t: (typeof params.tasks)[number]): TaskEdit => {
        if (t.type === "data") {
          return {
            id: t.id,
            type: "data",
            data: (
              t as { data: { title?: string; prompt?: string; profile?: string; phase?: number } }
            ).data,
          };
        }
        if (t.type === "blockers") {
          return {
            id: t.id,
            type: "blockers",
            data: (t as { data: { dependencies: string[] } }).data,
          };
        }
        if (t.type === "advance") {
          return { id: t.id, type: "advance" };
        }
        return { id: t.id, type: "abandon" };
      });

      try {
        const newBoard = applyEdits(board, edits, now);

        // Detect phase completion and set pending prompt
        await checkAndSetPhaseCompletion(beforePhases, newBoard);

        setBoard(newBoard);

        // Emit one event per edit with the correct type
        for (const edit of edits) {
          let event: TaskWorkflowEvent;
          if (edit.type === "data") {
            event = { type: "edit_task_data", id: edit.id, data: edit.data };
          } else if (edit.type === "blockers") {
            event = {
              type: "edit_task_blockers",
              id: edit.id,
              dependencies: edit.data.dependencies,
            };
          } else if (edit.type === "advance") {
            // Resolve from/to from the board for accurate event payload
            const original = board.tasks.find((t) => t.id === edit.id);
            const updated = newBoard.tasks.find((t) => t.id === edit.id);
            if (original && updated) {
              event = {
                type: "advance_task",
                id: edit.id,
                from: original.status as "implementing" | "reviewing",
                to: updated.status as "reviewing" | "done",
              };
            } else {
              event = { type: "advance_task", id: edit.id, from: "implementing", to: "reviewing" };
            }
          } else {
            event = { type: "abandon_task", id: edit.id };
          }
          pi.appendEntry(CUSTOM_EVENT_TYPE, event);
        }
        pi.appendEntry(CUSTOM_SNAPSHOT_TYPE, cloneBoard(newBoard));
        updateUI(ctx, newBoard);

        const summary = formatSummaryLine(newBoard);
        return makeSuccessResult(
          `Applied ${edits.length} edit(s). ${summary}\n\n${formatBoardText(newBoard)}`,
          newBoard,
        );
      } catch (err) {
        return makeErrorResult(err instanceof Error ? err.message : String(err), board);
      }
    },

    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("edit_tasks ")) +
          theme.fg("warning", `(${args.tasks.length} edits)`),
        0,
        0,
      );
    },

    renderResult,
  };
}

// ── Tool 3: compile_tasks ──

export function createCompileTasksTool(
  pi: ExtensionAPI,
): ToolDefinition<typeof CompileTasksParams, TaskToolDetails> {
  return {
    name: "compile_tasks",
    label: "Compile Tasks",
    description:
      "Validate and compile the task board. Checks for cycles, invalid dependencies, and duplicate ids. Moves draft tasks to 'configured' and computes which tasks are 'ready' based on phase gating and dependency resolution.",
    parameters: CompileTasksParams,
    promptSnippet: undefined,
    promptGuidelines: undefined,

    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const board = getBoard();
      const now = new Date().toISOString();

      // Snapshot before-phases for phase completion detection
      const beforePhases = board.phases.map((p) => ({ ...p }));

      try {
        const newBoard = compileBoard(board, now);

        // Detect phase completion and set pending prompt
        await checkAndSetPhaseCompletion(beforePhases, newBoard);

        setBoard(newBoard);

        const event: TaskWorkflowEvent = { type: "compile_tasks" };
        persistEntries(pi, event, newBoard);
        updateUI(ctx, newBoard);

        const counts = getStatusCounts(newBoard);
        const readyCount = counts.ready;
        const summary = formatSummaryLine(newBoard);
        return makeSuccessResult(
          `Board compiled. ${summary}. ${readyCount} task(s) ready to claim.\n\n${formatBoardText(newBoard)}`,
          newBoard,
        );
      } catch (err) {
        return makeErrorResult(err instanceof Error ? err.message : String(err), board);
      }
    },

    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("compile_tasks")), 0, 0);
    },

    renderResult,
  };
}

// ── Tool 4: clear_tasks ──

export function createClearTasksTool(
  pi: ExtensionAPI,
): ToolDefinition<typeof ClearTasksParams, TaskToolDetails> {
  return {
    name: "clear_tasks",
    label: "Clear Tasks",
    description: "Clear the entire task board, removing all tasks and resetting state.",
    parameters: ClearTasksParams,
    promptSnippet: undefined,
    promptGuidelines: undefined,

    // eslint-disable-next-line @typescript-eslint/require-await
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const emptyBoard = createEmptyBoard();
      setBoard(emptyBoard);

      const event: TaskWorkflowEvent = { type: "clear_tasks" };
      persistEntries(pi, event, emptyBoard);
      updateUI(ctx, emptyBoard);

      return makeSuccessResult("Board cleared.", emptyBoard);
    },

    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("clear_tasks")), 0, 0);
    },

    renderResult,
  };
}

// ── Tool 5: get_ready_tasks ──

export function createGetReadyTasksTool(
  pi: ExtensionAPI,
): ToolDefinition<typeof GetReadyTasksParams, TaskToolDetails> {
  return {
    name: "get_ready_tasks",
    label: "Get Ready Tasks",
    description:
      "Claim ready tasks from the board. Moves claimed tasks to 'implementing' status. Ordered by phase ascending, then creation order. After claiming, work through implementing → reviewing → done using edit_tasks with type 'advance'.",
    parameters: GetReadyTasksParams,
    promptSnippet: undefined,
    promptGuidelines: undefined,

    // eslint-disable-next-line @typescript-eslint/require-await
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const board = getBoard();
      const now = new Date().toISOString();

      try {
        const result = claimReadyTasks(board, params.count, now);

        if (result.claimed.length === 0) {
          // Determine why no tasks were claimed
          const allTerminal = board.tasks.every((t) => TERMINAL_STATUSES.has(t.status));
          if (allTerminal && board.tasks.length > 0) {
            return makeErrorResult(formatAllDoneMessage(board), board);
          }

          // Deadlock: non-terminal tasks but none actionable
          const nonTerminal = board.tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
          if (nonTerminal.length > 0) {
            const blockedList = nonTerminal
              .map((t) => `[${t.id}] ${t.title} (${t.status}, Phase ${t.phase})`)
              .join("\n");
            return makeErrorResult(
              `No ready tasks available. Tasks remain but none are actionable. Check dependencies and phase gating.\n\nBlocked tasks:\n${blockedList}\n\nUse edit_tasks to resolve blockers, then compile_tasks.`,
              board,
            );
          }

          return makeErrorResult("No tasks on the board.", board);
        }

        // Success: claimed tasks
        setBoard(result.board);

        const event: TaskWorkflowEvent = {
          type: "claim_ready_tasks",
          ids: result.claimed.map((t) => t.id),
        };
        persistEntries(pi, event, result.board);
        updateUI(ctx, result.board);

        const claimedDetails = result.claimed
          .map(
            (t) =>
              `─── ${t.id}: ${t.title} ───\nPhase: ${t.phase}\nProfile: ${t.profile}\nPrompt:\n${t.prompt}`,
          )
          .join("\n\n");

        return makeSuccessResult(
          `Claimed ${result.claimed.length} task(s).\n\n${claimedDetails}\n\nReview each claimed task and advance through implementing → reviewing → done using edit_tasks.\n\n${formatBoardText(result.board)}`,
          result.board,
        );
      } catch (err) {
        return makeErrorResult(err instanceof Error ? err.message : String(err), board);
      }
    },

    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("get_ready_tasks ")) +
          theme.fg("muted", `(count: ${args.count})`),
        0,
        0,
      );
    },

    renderResult,
  };
}
