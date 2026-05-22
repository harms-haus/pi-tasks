import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// ── Schemas ──

export const WriteTasksParams = Type.Object({
  mode: StringEnum(["replace", "append"], {
    description: "'replace' clears the board before writing; 'append' adds to existing tasks",
  }),
  phases: Type.Array(
    Type.Object({
      title: Type.String({ description: "Short phase title" }),
      tasks: Type.Array(
        Type.Object({
          title: Type.String({ description: "Short task title" }),
          prompt: Type.String({ description: "Detailed implementation instructions" }),
          profile: Type.String({ description: "Agent profile name for task delegation" }),
        }),
        { description: "Tasks in this phase (at least 1)", minItems: 1 },
      ),
    }),
    { description: "Phases to write to the board", minItems: 1 },
  ),
});

export const EditTasksParams = Type.Object({
  tasks: Type.Array(
    Type.Union([
      Type.Object({
        id: Type.String(),
        type: StringEnum(["data"]),
        data: Type.Object({
          title: Type.Optional(Type.String()),
          prompt: Type.Optional(Type.String()),
          profile: Type.Optional(Type.String()),
          phase: Type.Optional(Type.Integer()),
        }),
      }),
      Type.Object({
        id: Type.String(),
        type: StringEnum(["blockers"]),
        data: Type.Object({
          dependencies: Type.Array(Type.String()),
        }),
      }),
      Type.Object({
        id: Type.String(),
        type: StringEnum(["abandon"]),
      }),
    ]),
    { maxItems: 50 },
  ),
});

export const CompileTasksParams = Type.Object({});

export const ClearTasksParams = Type.Object({});

export const GetReadyTasksParams = Type.Object({
  count: Type.Integer({ description: "Number of tasks to claim (>= 1)", minimum: 1 }),
});

export const AdvanceTasksParams = Type.Object({
  ids: Type.Array(Type.String(), { description: "Task IDs to advance", maxItems: 50 }),
});
