import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// ── Schemas ──

export const WriteTasksParams = Type.Object({
  tasks: Type.Array(
    Type.Object({
      title: Type.String({ description: "Short task title" }),
      prompt: Type.String({ description: "Detailed implementation instructions" }),
      profile: Type.String({ description: "Agent profile name for task delegation" }),
      phase: Type.Integer({ description: "Phase number (>= 1)", minimum: 1 }),
    }),
    { description: "Tasks to add to the board" },
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
  ),
});

export const CompileTasksParams = Type.Object({});

export const ClearTasksParams = Type.Object({});

export const GetReadyTasksParams = Type.Object({
  count: Type.Integer({ description: "Number of tasks to claim (>= 1)", minimum: 1 }),
});

export const AdvanceTasksParams = Type.Object({
  ids: Type.Array(Type.String(), { description: "Task IDs to advance" }),
});
