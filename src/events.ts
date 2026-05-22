import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CUSTOM_SNAPSHOT_TYPE, MAX_AUTO_CONTINUE, TERMINAL_STATUSES } from "./types";
import { cloneBoard, hasActionableTasks, hasBlockedNonTerminalTasks } from "./validation";
import {
  getBoardRef,
  setBoard,
  setBoardQuiet,
  reconstructState,
  updateUI,
  incrementAutoContinue,
  setLastToolWasAdvance,
  resetState,
} from "./state";
import { resetConfig } from "./config";
import { formatHiddenContext, formatContinuePrompt } from "./formatting";

// ── Countdown Handles ──

let activeCountdown: ReturnType<typeof setInterval> | null = null;
let activeTimeout: ReturnType<typeof setTimeout> | null = null;

/** Clear any active countdown interval, timeout, and remove the countdown widget. */
function clearCountdown(ctx: ExtensionContext): void {
  if (activeCountdown !== null) {
    clearInterval(activeCountdown);
    activeCountdown = null;
  }
  if (activeTimeout !== null) {
    clearTimeout(activeTimeout);
    activeTimeout = null;
  }
  if (ctx.hasUI) {
    ctx.ui.setWidget("phased-tasks-countdown", undefined);
  }
}

// ── Abort Detection ──

/** Check if the last assistant message was aborted (user interrupted). */
function wasAborted(messages: { role: string; stopReason?: string }[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      return messages[i].stopReason === "aborted";
    }
  }
  return false;
}

// ── Auto-Continue Delivery ──

/** Send auto-continue prompt, falling back to followUp delivery if agent is busy. */
function trySendAutoContinue(pi: ExtensionAPI, prompt: string): void {
  try {
    pi.sendUserMessage(prompt);
  } catch {
    try {
      pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    } catch {
      // Agent truly unavailable (user typing, etc.) — skip auto-continue
    }
  }
}

// ── Schedule ──

/** Schedule auto-continue with countdown UI or timeout fallback. */
function scheduleAutoContinue(pi: ExtensionAPI, ctx: ExtensionContext, prompt: string): void {
  // Always clear both timer handles regardless of UI mode
  if (activeCountdown !== null) {
    clearInterval(activeCountdown);
    activeCountdown = null;
  }
  if (activeTimeout !== null) {
    clearTimeout(activeTimeout);
    activeTimeout = null;
  }

  if (ctx.hasUI) {
    let remaining = 3;
    const interval = setInterval(() => {
      try {
        remaining--;
        if (remaining > 0) {
          ctx.ui.setWidget(
            "phased-tasks-countdown",
            [`⏳ Auto-continuing in ${remaining}s... (type anything to interrupt)`],
            { placement: "aboveEditor" },
          );
        } else {
          clearCountdown(ctx);
          trySendAutoContinue(pi, prompt);
        }
      } catch {
        clearCountdown(ctx);
      }
    }, 1000);
    activeCountdown = interval;

    ctx.ui.setWidget(
      "phased-tasks-countdown",
      ["⏳ Auto-continuing in 3s... (type anything to interrupt)"],
      { placement: "aboveEditor" },
    );
  } else {
    activeTimeout = setTimeout(() => {
      activeTimeout = null;
      trySendAutoContinue(pi, prompt);
    }, 3000);
  }
}

// ── Handler Registration ──

export function registerEventHandlers(pi: ExtensionAPI): void {
  pi.on("session_start", (_, ctx) => {
    resetConfig();
    clearCountdown(ctx);
    setLastToolWasAdvance(false);
    const board = reconstructState(ctx);
    setBoard(board);
    updateUI(ctx, board);
  });

  pi.on("session_tree", (_, ctx) => {
    clearCountdown(ctx);
    resetConfig();
    setLastToolWasAdvance(false);
    const board = reconstructState(ctx);
    setBoard(board);
    updateUI(ctx, board);
  });

  pi.on("session_shutdown", (_, ctx) => {
    clearCountdown(ctx);
    resetConfig();
    resetState();
  });

  pi.on("before_agent_start", () => {
    const board = getBoardRef();
    if (board.tasks.length === 0) return;

    let content = formatHiddenContext(board);
    if (board.pendingPhasePrompt) {
      content = `${board.pendingPhasePrompt.message}\n\n${content}`;
    }

    return {
      message: {
        customType: "phased-tasks-context",
        content,
        display: false,
      },
    };
  });

  pi.on("agent_end", (event, ctx) => {
    let board = getBoardRef();
    if (board.tasks.length === 0) return;
    if (wasAborted(event.messages)) return;

    const count: number = incrementAutoContinue();
    if (count > MAX_AUTO_CONTINUE) {
      const nonTerminal = board.tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
      pi.sendMessage(
        {
          customType: "phased-tasks-notice",
          content: `Auto-continue limit reached (${MAX_AUTO_CONTINUE} iterations). ${nonTerminal.length} task(s) remain unresolved. Take over manually.`,
          display: true,
        },
        { triggerTurn: false },
      );
      return;
    }

    if (hasActionableTasks(board)) {
      // Consume pending phase prompt
      let phasePrompt = "";
      if (board.pendingPhasePrompt) {
        phasePrompt = board.pendingPhasePrompt.message + "\n\n";
        pi.sendMessage(
          {
            customType: "phased-tasks-notice",
            content: `Phase ${board.pendingPhasePrompt.phase} complete.`,
            display: true,
          },
          { triggerTurn: false },
        );
        // Clear the prompt — will be persisted on next mutation
        const updated = cloneBoard(board);
        delete updated.pendingPhasePrompt;
        setBoardQuiet(updated);
        pi.appendEntry(CUSTOM_SNAPSHOT_TYPE, updated);
        board = getBoardRef(); // Refresh after pendingPhasePrompt clear
      }
      const prompt = phasePrompt + formatContinuePrompt(board);
      scheduleAutoContinue(pi, ctx, prompt);
      return;
    }

    if (hasBlockedNonTerminalTasks(board)) {
      const prompt = formatContinuePrompt(board); // deadlock message
      scheduleAutoContinue(pi, ctx, prompt);
      return;
    }

    // All terminal — do nothing
  });

  pi.on("input", (_, ctx) => {
    clearCountdown(ctx);
    setLastToolWasAdvance(false);
  });

  pi.on("tool_result", (event) => {
    const toolName = (event as { toolName?: string }).toolName;
    if (toolName !== "advance_tasks") {
      setLastToolWasAdvance(false);
    }
  });
}
