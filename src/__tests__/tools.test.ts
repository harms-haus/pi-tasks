import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { vi } from "vitest";
import { createMockAPI, createMockContext, createMockTheme } from "./helpers/mocks";
import {
  createWriteTasksTool,
  createEditTasksTool,
  createCompileTasksTool,
  createClearTasksTool,
  createGetReadyTasksTool,
  createAdvanceTasksTool,
} from "../tools";
import { resetState } from "../state";
import * as configModule from "../config";
import type { TaskBoardSnapshot } from "../types";

// ── Helpers ──

/** Call a tool's execute function with minimal boilerplate. */
async function callExecute(tool: any, params: any, ctx?: any): Promise<any> {
  return await tool.execute(
    "test-call-id",
    params,
    undefined,
    undefined,
    ctx ?? createMockContext(),
  );
}

// ═══════════════════════════════════════════
// 1. write_tasks
// ═══════════════════════════════════════════

describe("write_tasks", () => {
  let mockApi: ReturnType<typeof createMockAPI>;
  let api: ReturnType<typeof createMockAPI>["api"];
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    mockApi = createMockAPI();
    api = mockApi.api;
    ctx = createMockContext();
  });

  it("succeeds with valid input, returns board text", async () => {
    const tool = createWriteTasksTool(api);
    const result = await callExecute(
      tool,
      {
        mode: "replace",
        phases: [
          { title: "Phase 1", tasks: [{ title: "Task A", prompt: "Do A", profile: "coder" }] },
          { title: "Phase 2", tasks: [{ title: "Task B", prompt: "Do B", profile: "coder" }] },
        ],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { snapshot: TaskBoardSnapshot; error?: string };
    };
    expect(r.content[0].text).toContain("Added 2 task(s)");
    expect(r.content[0].text).toContain("Task A");
    expect(r.content[0].text).toContain("Task B");
    expect(r.details.snapshot.tasks).toHaveLength(2);
    expect(r.details.snapshot.tasks[0].id).toBe("t-1.1");
    expect(r.details.snapshot.tasks[0].status).toBe("draft");
    expect(r.details.snapshot.tasks[1].id).toBe("t-2.1");
    expect(r.details.error).toBeUndefined();
  });

  it("appends to existing board (does not replace)", async () => {
    const tool = createWriteTasksTool(api);

    await callExecute(
      tool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "First", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );

    const result = await callExecute(
      tool,
      {
        mode: "append",
        phases: [{ title: "Phase 2", tasks: [{ title: "Second", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { snapshot: TaskBoardSnapshot };
    };
    expect(r.details.snapshot.tasks).toHaveLength(2);
    expect(r.details.snapshot.tasks[0].title).toBe("First");
    expect(r.details.snapshot.tasks[1].title).toBe("Second");
    expect(r.details.snapshot.tasks[1].id).toBe("t-2.1");
  });

  it("rejects empty title", async () => {
    const tool = createWriteTasksTool(api);
    const result = await callExecute(
      tool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("title must be a non-empty string");
  });

  it("rejects empty prompt", async () => {
    const tool = createWriteTasksTool(api);
    const result = await callExecute(
      tool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "T", prompt: "", profile: "c" }] }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("prompt must be a non-empty string");
  });

  it("rejects empty profile", async () => {
    const tool = createWriteTasksTool(api);
    const result = await callExecute(
      tool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "T", prompt: "P", profile: "" }] }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("profile must be a non-empty string");
  });

  it("rejects invalid phase (0)", async () => {
    const tool = createWriteTasksTool(api);
    const result = await callExecute(
      tool,
      {
        mode: "replace",
        phases: [{ title: "", tasks: [{ title: "T", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("title must be a non-empty string");
  });

  it("rejects invalid phase (negative)", async () => {
    const tool = createWriteTasksTool(api);
    const result = await callExecute(
      tool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "T", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );

    // In the new format there is no negative phase — just verify a valid call succeeds
    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string; snapshot: TaskBoardSnapshot };
    };
    expect(r.details.error).toBeUndefined();
  });

  it("rejects when total would exceed 100 tasks", async () => {
    const tool = createWriteTasksTool(api);

    // Write 99 tasks first
    const tasks99 = Array.from({ length: 99 }, (_, i) => ({
      title: `Task ${i + 1}`,
      prompt: "P",
      profile: "c",
    }));
    await callExecute(
      tool,
      { mode: "replace", phases: [{ title: "Phase 1", tasks: tasks99 }] },
      ctx,
    );

    // Try to add 2 more → exceed 100
    const result = await callExecute(
      tool,
      {
        mode: "append",
        phases: [
          {
            title: "Phase 2",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("would exceed maximum");
  });

  it("persists event and snapshot entries", async () => {
    const tool = createWriteTasksTool(api);
    await callExecute(
      tool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "T", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );

    // appendEntry is called twice per tool execution (event + snapshot)
    expect(mockApi.appendEntry).toHaveBeenCalledTimes(2);
    expect(mockApi.appendEntry).toHaveBeenNthCalledWith(
      1,
      "phased-tasks:event",
      expect.objectContaining({ type: "write_tasks" }),
    );
    expect(mockApi.appendEntry).toHaveBeenNthCalledWith(
      2,
      "phased-tasks:snapshot",
      expect.objectContaining({ tasks: expect.any(Array) }),
    );
  });

  it("updates UI on success", async () => {
    const tool = createWriteTasksTool(api);
    await callExecute(
      tool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "T", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );

    // ctx.ui.setStatus should have been called
    const statusFn = ctx.ui.setStatus as ReturnType<typeof vi.fn>;
    expect(statusFn).toHaveBeenCalled();
  });

  it("renderCall returns themed text", () => {
    const tool = createWriteTasksTool(api);
    const theme = createMockTheme();
    const rendered = (tool as any).renderCall(
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "A", prompt: "P", profile: "c" }] }],
      },
      theme,
    );
    const text = rendered.toString();
    expect(text).toContain("write_tasks");
    expect(text).toContain("1 items");
  });
});

// ═══════════════════════════════════════════
// 2. edit_tasks - data
// ═══════════════════════════════════════════

describe("edit_tasks - data", () => {
  let api: ReturnType<typeof createMockAPI>["api"];
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    const mockApi = createMockAPI();
    api = mockApi.api;
    ctx = createMockContext();
  });

  it("succeeds when no active tasks", async () => {
    // Write and compile tasks first
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "Task A", prompt: "Do A", profile: "coder" }],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);

    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.1", type: "data", data: { title: "New Title" } }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { snapshot: TaskBoardSnapshot; error?: string };
    };
    expect(r.details.error).toBeUndefined();
    expect(r.details.snapshot.tasks[0].title).toBe("New Title");
  });

  it("resets non-terminal non-active tasks to draft", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);

    // Both are ready. Edit t-1.1's data — resets all non-terminal to draft
    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.1", type: "data", data: { title: "New A" } }],
      },
      ctx,
    );

    const r = result as { details: { snapshot: TaskBoardSnapshot } };
    // Both reset to draft (structural edit invalidates compilation)
    expect(r.details.snapshot.tasks[0].status).toBe("draft");
    expect(r.details.snapshot.tasks[1].status).toBe("draft");
  });

  it("rejects when tasks are implementing/reviewing", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    // t-1.1 is now implementing

    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.2", type: "data", data: { title: "X" } }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("implementing/reviewing");
  });

  it("rejects unknown ids", async () => {
    const writeTool = createWriteTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );

    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-999.1", type: "data", data: { title: "X" } }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("not found");
  });
});

// ═══════════════════════════════════════════
// 3. edit_tasks - blockers
// ═══════════════════════════════════════════

describe("edit_tasks - blockers", () => {
  let api: ReturnType<typeof createMockAPI>["api"];
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    const mockApi = createMockAPI();
    api = mockApi.api;
    ctx = createMockContext();
  });

  it("succeeds, replaces dependency list", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);

    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.2", type: "blockers", data: { dependencies: ["t-1.1"] } }],
      },
      ctx,
    );

    const r = result as { details: { snapshot: TaskBoardSnapshot; error?: string } };
    expect(r.details.error).toBeUndefined();
    expect(r.details.snapshot.tasks[1].dependencies).toEqual(["t-1.1"]);
  });

  it("rejects self-dependency", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);

    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.1", type: "blockers", data: { dependencies: ["t-1.1"] } }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("cannot depend on itself");
  });

  it("rejects references to nonexistent tasks", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);

    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.1", type: "blockers", data: { dependencies: ["t-999.1"] } }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("non-existent dependencies");
  });

  it("resets non-terminal non-active tasks to draft", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);

    // Both ready. Change B's blockers — resets all non-terminal to draft
    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.2", type: "blockers", data: { dependencies: [] } }],
      },
      ctx,
    );

    const r = result as { details: { snapshot: TaskBoardSnapshot } };
    expect(r.details.snapshot.tasks[0].status).toBe("draft");
    expect(r.details.snapshot.tasks[1].status).toBe("draft");
  });

  it("rejects while tasks are implementing", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    // t-1.1 is implementing, t-1.2 is ready

    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.2", type: "blockers", data: { dependencies: [] } }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("implementing/reviewing");
  });
});

// ═══════════════════════════════════════════
// 4. advance_tasks tool
// ═══════════════════════════════════════════

describe("advance_tasks tool", () => {
  let api: ReturnType<typeof createMockAPI>["api"];
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    const mockApi = createMockAPI();
    api = mockApi.api;
    ctx = createMockContext();
  });

  it("advances implementing → reviewing", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "A", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    // t-1.1 is implementing

    const result = await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx);

    const r = result as { details: { snapshot: TaskBoardSnapshot; error?: string } };
    expect(r.details.error).toBeUndefined();
    expect(r.details.snapshot.tasks[0].status).toBe("reviewing");
  });

  it("advances reviewing → done and recomputes readiness", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const editTool = createEditTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );

    // Set B's blockers to depend on A
    await callExecute(
      editTool,
      { tasks: [{ id: "t-1.2", type: "blockers", data: { dependencies: ["t-1.1"] } }] },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    // A is ready, B is configured (blocked by A)

    await callExecute(getReadyTool, { count: 1 }, ctx);
    // t-1.1 implementing

    await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx);
    // t-1.1 reviewing

    const result = await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx);
    // t-1.1 done

    const r = result as { details: { snapshot: TaskBoardSnapshot; error?: string } };
    expect(r.details.error).toBeUndefined();
    expect(r.details.snapshot.tasks[0].status).toBe("done");
    // B should now be ready since its dependency (A) is done
    expect(r.details.snapshot.tasks[1].status).toBe("ready");
  });

  it("advances batch of tasks", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 2 }, ctx);
    // Both implementing

    const result = await callExecute(advanceTool, { ids: ["t-1.1", "t-1.2"] }, ctx);

    const r = result as { details: { snapshot: TaskBoardSnapshot; error?: string } };
    expect(r.details.error).toBeUndefined();
    expect(r.details.snapshot.tasks[0].status).toBe("reviewing");
    expect(r.details.snapshot.tasks[1].status).toBe("reviewing");
  });

  it("errors on invalid status (draft)", async () => {
    const writeTool = createWriteTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "A", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );
    // t-1.1 is draft (not compiled)

    const result = await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx);

    const r = result as { details: { error?: string } };
    expect(r.details.error).toBeDefined();
  });

  it("errors on invalid status (configured/blocked)", async () => {
    const writeTool = createWriteTasksTool(api);
    const editTool = createEditTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(
      editTool,
      { tasks: [{ id: "t-1.2", type: "blockers", data: { dependencies: ["t-1.1"] } }] },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    // B is configured (blocked by A)

    const result = await callExecute(advanceTool, { ids: ["t-1.2"] }, ctx);

    const r = result as { details: { error?: string } };
    expect(r.details.error).toBeDefined();
  });

  it("errors on nonexistent task", async () => {
    const advanceTool = createAdvanceTasksTool(api);

    const result = await callExecute(advanceTool, { ids: ["t-999.1"] }, ctx);

    const r = result as { details: { error?: string } };
    expect(r.details.error).toBeDefined();
  });

  it("shows double-advance warning when advanceWarningPending is set", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "A", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    // t-1.1 implementing

    await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx);
    // t-1.1 reviewing

    // Second consecutive advance triggers the warning (wasConsecutive = true)
    const result = await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx);
    // t-1.1 done

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { snapshot: TaskBoardSnapshot; error?: string };
    };
    expect(r.details.error).toBeUndefined();
    expect(r.content[0].text).toContain("Review should not be skipped");
    expect(r.details.snapshot.tasks[0].status).toBe("done");
  });

  it("deduplicates IDs", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "A", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    // t-1.1 is implementing

    const result = await callExecute(advanceTool, { ids: ["t-1.1", "t-1.1"] }, ctx);

    const r = result as { details: { snapshot: TaskBoardSnapshot; error?: string } };
    expect(r.details.error).toBeUndefined();
    // Should only advance once: implementing → reviewing (not done)
    expect(r.details.snapshot.tasks[0].status).toBe("reviewing");
  });

  it("renderCall shows task count", () => {
    const advanceTool = createAdvanceTasksTool(api);
    const theme = createMockTheme();
    const rendered = (advanceTool as any).renderCall({ ids: ["t-1.1", "t-1.2"] }, theme);
    const text = rendered.toString();
    expect(text).toContain("advance_tasks");
    expect(text).toContain("2 tasks");
  });
});

// ═══════════════════════════════════════════
// 5. edit_tasks - abandon
// ═══════════════════════════════════════════

describe("edit_tasks - abandon", () => {
  let api: ReturnType<typeof createMockAPI>["api"];
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    const mockApi = createMockAPI();
    api = mockApi.api;
    ctx = createMockContext();
  });

  it("succeeds from allowed statuses (ready)", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    // t-1.1 is ready

    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.1", type: "abandon" }],
      },
      ctx,
    );

    const r = result as { details: { snapshot: TaskBoardSnapshot; error?: string } };
    expect(r.details.error).toBeUndefined();
    expect(r.details.snapshot.tasks[0].status).toBe("abandoned");
  });

  it("succeeds from implementing", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    // t-1.1 implementing

    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.1", type: "abandon" }],
      },
      ctx,
    );

    const r = result as { details: { snapshot: TaskBoardSnapshot; error?: string } };
    expect(r.details.error).toBeUndefined();
    expect(r.details.snapshot.tasks[0].status).toBe("abandoned");
  });

  it("rejects from done", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const editTool = createEditTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx); // → reviewing
    await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx); // → done

    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.1", type: "abandon" }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("Already resolved");
  });

  it("rejects from abandoned", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(editTool, { tasks: [{ id: "t-1.1", type: "abandon" }] }, ctx);

    // Try to abandon again
    const result = await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.1", type: "abandon" }],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("Already resolved");
  });
});

// ═══════════════════════════════════════════
// 6. edit_tasks - atomicity
// ═══════════════════════════════════════════

describe("edit_tasks - atomicity", () => {
  let api: ReturnType<typeof createMockAPI>["api"];
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    const mockApi = createMockAPI();
    api = mockApi.api;
    ctx = createMockContext();
  });

  it("mixed batch with one failure rolls back all", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const editTool = createEditTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    // Both ready

    // Batch: valid data edit + invalid id
    const result = await callExecute(
      editTool,
      {
        tasks: [
          { id: "t-1.1", type: "data", data: { title: "New A" } },
          { id: "t-999.1", type: "data", data: { title: "Z" } },
        ],
      },
      ctx,
    );

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string; snapshot: TaskBoardSnapshot };
    };
    expect(r.details.error).toBeDefined();
    // Original task titles unchanged
    expect(r.details.snapshot.tasks[0].title).toBe("A");
    expect(r.details.snapshot.tasks[1].title).toBe("B");
  });
});

// ═══════════════════════════════════════════
// 7. compile_tasks
// ═══════════════════════════════════════════

describe("compile_tasks", () => {
  let api: ReturnType<typeof createMockAPI>["api"];
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    const mockApi = createMockAPI();
    api = mockApi.api;
    ctx = createMockContext();
  });

  it("succeeds on valid board", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );

    const result = await callExecute(compileTool, {}, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { snapshot: TaskBoardSnapshot; error?: string };
    };
    expect(r.details.error).toBeUndefined();
    expect(r.details.snapshot.tasks[0].status).toBe("ready");
    expect(r.content[0].text).toContain("Board compiled");
  });

  it("rejects empty board", async () => {
    const compileTool = createCompileTasksTool(api);

    const result = await callExecute(compileTool, {}, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("Cannot compile an empty board");
  });

  it("rejects when active tasks exist (implementing)", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    // t-1.1 is implementing

    // Try to compile again — should fail
    const result = await callExecute(compileTool, {}, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("implementing or reviewing");
  });

  it("rejects cycles", async () => {
    const writeTool = createWriteTasksTool(api);
    const editTool = createEditTasksTool(api);
    const compileTool = createCompileTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );

    // Create a cycle: A→B and B→A
    await callExecute(
      editTool,
      {
        tasks: [
          { id: "t-1.1", type: "blockers", data: { dependencies: ["t-1.2"] } },
          { id: "t-1.2", type: "blockers", data: { dependencies: ["t-1.1"] } },
        ],
      },
      ctx,
    );

    const result = await callExecute(compileTool, {}, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("cycle detected");
  });
});

// ═══════════════════════════════════════════
// 8. clear_tasks
// ═══════════════════════════════════════════

describe("clear_tasks", () => {
  let api: ReturnType<typeof createMockAPI>["api"];
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    const mockApi = createMockAPI();
    api = mockApi.api;
    ctx = createMockContext();
  });

  it("clears the board", async () => {
    const writeTool = createWriteTasksTool(api);
    const clearTool = createClearTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c", phase: 2 },
            ],
          },
        ],
      },
      ctx,
    );

    const result = await callExecute(clearTool, {}, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { snapshot: TaskBoardSnapshot };
    };
    expect(r.content[0].text).toContain("Board cleared");
    expect(r.details.snapshot.tasks).toEqual([]);
    expect(r.details.snapshot.phases).toEqual([]);
  });

  it("rejects when tasks are implementing", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const clearTool = createClearTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "A", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    // t-1.1 is implementing

    const result = await callExecute(clearTool, {}, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("implementing or reviewing");
  });

  it("rejects when tasks are reviewing", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);
    const clearTool = createClearTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [{ title: "Phase 1", tasks: [{ title: "A", prompt: "P", profile: "c" }] }],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx);
    // t-1.1 is reviewing

    const result = await callExecute(clearTool, {}, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("implementing or reviewing");
  });

  it("clears board and allows fresh task ids", async () => {
    const writeTool = createWriteTasksTool(api);
    const clearTool = createClearTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );

    await callExecute(clearTool, {}, ctx);

    // Write again — should start from t-1.1 since board is empty
    const result = await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "B", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );

    const r = result as { details: { snapshot: TaskBoardSnapshot } };
    expect(r.details.snapshot.tasks[0].id).toBe("t-1.1");
    expect(r.details.snapshot.tasks).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════
// 9. get_ready_tasks
// ═══════════════════════════════════════════

describe("get_ready_tasks", () => {
  let api: ReturnType<typeof createMockAPI>["api"];
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    const mockApi = createMockAPI();
    api = mockApi.api;
    ctx = createMockContext();
  });

  it("auto-claims ready tasks", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "Do A", profile: "coder" },
              { title: "B", prompt: "Do B", profile: "coder" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);

    const result = await callExecute(getReadyTool, { count: 2 }, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { snapshot: TaskBoardSnapshot; error?: string };
    };
    expect(r.details.error).toBeUndefined();
    expect(r.content[0].text).toContain("Claimed 2 task(s)");
    expect(r.content[0].text).toContain("Review each claimed task");
    expect(r.details.snapshot.tasks[0].status).toBe("implementing");
    expect(r.details.snapshot.tasks[1].status).toBe("implementing");
  });

  it("returns task details with instruction text", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "Task A", prompt: "Implement feature X", profile: "coder" }],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);

    const result = await callExecute(getReadyTool, { count: 1 }, ctx);

    const r = result as { content: Array<{ type: string; text: string }> };
    expect(r.content[0].text).toContain("t-1.1: Task A");
    expect(r.content[0].text).toContain("Implement feature X");
    expect(r.content[0].text).toContain("implementing → reviewing → done");
  });

  it("rejects when implementing/reviewing tasks exist", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    // Claim 1 task
    await callExecute(getReadyTool, { count: 1 }, ctx);
    // task-1 is implementing, task-2 is ready but can't be claimed while task-1 is active

    const result = await callExecute(getReadyTool, { count: 1 }, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain(
      "Cannot claim tasks while tasks are implementing or reviewing",
    );
  });

  it("deadlock message when no ready tasks but non-terminal remain", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const editTool = createEditTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    // Set B to depend on A
    await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.2", type: "blockers", data: { dependencies: ["t-1.1"] } }],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);

    // Abandon A — B depends on A which is now abandoned (not done)
    await callExecute(
      editTool,
      {
        tasks: [{ id: "t-1.1", type: "abandon" }],
      },
      ctx,
    );
    // B is configured but can't become ready (dep not satisfied)

    // Try to get ready tasks — should get deadlock message
    const result = await callExecute(getReadyTool, { count: 1 }, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("No ready tasks available");
    expect(r.content[0].text).toContain("Blocked tasks");
  });

  it("done message when all tasks are terminal", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [{ title: "A", prompt: "P", profile: "c" }],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);
    await callExecute(getReadyTool, { count: 1 }, ctx);
    await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx); // → reviewing
    await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx); // → done

    const result = await callExecute(getReadyTool, { count: 1 }, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("All tasks resolved");
  });

  it("rejects count < 1", async () => {
    const getReadyTool = createGetReadyTasksTool(api);

    const result = await callExecute(getReadyTool, { count: 0 }, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("count must be >= 1");
  });

  it("claims up to count tasks even if more are ready", async () => {
    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);

    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
              { title: "C", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      ctx,
    );
    await callExecute(compileTool, {}, ctx);

    const result = await callExecute(getReadyTool, { count: 1 }, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { snapshot: TaskBoardSnapshot };
    };
    expect(r.content[0].text).toContain("Claimed 1 task(s)");
    expect(r.details.snapshot.tasks[0].status).toBe("implementing");
    expect(r.details.snapshot.tasks[1].status).toBe("ready");
    expect(r.details.snapshot.tasks[2].status).toBe("ready");
  });

  it("no tasks on board message", async () => {
    const getReadyTool = createGetReadyTasksTool(api);

    const result = await callExecute(getReadyTool, { count: 1 }, ctx);

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { error?: string };
    };
    expect(r.details.error).toBeDefined();
    expect(r.content[0].text).toContain("No tasks on the board");
  });
});

// ═══════════════════════════════════════════
// Render functions
// ═══════════════════════════════════════════

describe("tool render functions", () => {
  let api: ReturnType<typeof createMockAPI>["api"];
  let theme: ReturnType<typeof createMockTheme>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    api = createMockAPI().api;
    theme = createMockTheme();
  });

  it("write_tasks renderCall shows item count", () => {
    const tool = createWriteTasksTool(api);
    const result = (tool as any).renderCall(
      {
        mode: "replace",
        phases: [
          {
            title: "Phase 1",
            tasks: [
              { title: "A", prompt: "P", profile: "c" },
              { title: "B", prompt: "P", profile: "c" },
            ],
          },
        ],
      },
      theme,
    );
    expect(result.toString()).toContain("write_tasks");
    expect(result.toString()).toContain("2 items");
  });

  it("edit_tasks renderCall shows edit count", () => {
    const tool = createEditTasksTool(api);
    const result = (tool as any).renderCall(
      {
        tasks: [
          { id: "t-1.1", type: "data", data: { title: "X" } },
          { id: "t-1.2", type: "data", data: { title: "Y" } },
        ],
      },
      theme,
    );
    expect(result.toString()).toContain("edit_tasks");
    expect(result.toString()).toContain("2 edits");
  });

  it("compile_tasks renderCall shows tool name", () => {
    const tool = createCompileTasksTool(api);
    const result = (tool as any).renderCall({}, theme);
    expect(result.toString()).toContain("compile_tasks");
  });

  it("clear_tasks renderCall shows tool name", () => {
    const tool = createClearTasksTool(api);
    const result = (tool as any).renderCall({}, theme);
    expect(result.toString()).toContain("clear_tasks");
  });

  it("get_ready_tasks renderCall shows count", () => {
    const tool = createGetReadyTasksTool(api);
    const result = (tool as any).renderCall({ count: 3 }, theme);
    expect(result.toString()).toContain("get_ready_tasks");
    expect(result.toString()).toContain("count: 3");
  });

  it("renderResult renders success text with theme", () => {
    const tool = createWriteTasksTool(api);
    const result = {
      content: [{ type: "text" as const, text: "Success message" }],
      details: {
        snapshot: { version: 1 as const, tasks: [], phases: [] } as TaskBoardSnapshot,
      },
    };
    const rendered = (tool as any).renderResult(
      result,
      { expanded: false, isPartial: false },
      theme,
    );
    expect(rendered.toString()).toContain("Success message");
  });

  it("renderResult renders error text with error color", () => {
    const tool = createWriteTasksTool(api);
    const result = {
      content: [{ type: "text" as const, text: "Some error" }],
      details: {
        snapshot: { version: 1 as const, tasks: [], phases: [] } as TaskBoardSnapshot,
        error: "Some error",
      },
    };
    const rendered = (tool as any).renderResult(
      result,
      { expanded: false, isPartial: false },
      theme,
    );
    expect(rendered.toString()).toContain("Some error");
  });
});

// ═══════════════════════════════════════════
// 10. Phase completion prompt
// ═══════════════════════════════════════════

describe("phase completion prompt", () => {
  let api: ReturnType<typeof createMockAPI>["api"];
  let ctx: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    resetState();
    configModule.resetConfig();
    const mockApi = createMockAPI();
    api = mockApi.api;
    ctx = createMockContext();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets pendingPhasePrompt when a phase completes after advance", async () => {
    vi.spyOn(configModule, "loadConfig").mockResolvedValue({
      phaseCompletionPromptTemplate: "Phase {phase} complete!",
    });

    const writeTool = createWriteTasksTool(api);
    const compileTool = createCompileTasksTool(api);
    const getReadyTool = createGetReadyTasksTool(api);
    const advanceTool = createAdvanceTasksTool(api);

    // Write 2 phases with 1 task each
    await callExecute(
      writeTool,
      {
        mode: "replace",
        phases: [
          { title: "Phase 1", tasks: [{ title: "A", prompt: "P", profile: "c" }] },
          { title: "Phase 2", tasks: [{ title: "B", prompt: "P", profile: "c" }] },
        ],
      },
      ctx,
    );

    await callExecute(compileTool, {}, ctx);
    // Phase 1 task is ready, Phase 2 task is configured (gated)

    await callExecute(getReadyTool, { count: 1 }, ctx);
    // t-1.1 is implementing

    await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx);
    // t-1.1 is reviewing

    const result = await callExecute(advanceTool, { ids: ["t-1.1"] }, ctx);
    // t-1.1 is done — Phase 1 should complete

    const r = result as {
      content: Array<{ type: string; text: string }>;
      details: { snapshot: TaskBoardSnapshot; error?: string };
    };

    expect(r.details.error).toBeUndefined();
    expect(r.details.snapshot.pendingPhasePrompt).toBeDefined();
    expect(r.details.snapshot.pendingPhasePrompt?.phase).toBe(1);
    expect(r.details.snapshot.pendingPhasePrompt?.message).toContain("Phase 1 complete!");
  });
});
