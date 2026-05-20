import { describe, it, expect } from "vitest";
import { registerMessageRenderers } from "../renderers";
import { createMockAPI, createMockTheme } from "./helpers/mocks";

describe("registerMessageRenderers", () => {
  it("registers renderers for both message types", () => {
    const mockObj = createMockAPI();
    registerMessageRenderers(mockObj.api);

    expect(mockObj.registerMessageRenderer).toHaveBeenCalledTimes(2);
    const registeredTypes = mockObj.registerMessageRenderer.mock.calls.map(
      (call: unknown) => (call as [string, unknown])[0],
    );
    expect(registeredTypes).toContain("phased-tasks-context");
    expect(registeredTypes).toContain("phased-tasks-notice");
  });

  it("renders phased-tasks-context with accent icon and dimmed content", () => {
    const mockObj = createMockAPI();
    registerMessageRenderers(mockObj.api);

    // Find the context renderer callback
    const contextCall = mockObj.registerMessageRenderer.mock.calls.find(
      (call: unknown) => (call as [string, unknown])[0] === "phased-tasks-context",
    );
    const renderer = (contextCall as [string, (...args: unknown[]) => unknown])[1];
    const theme = createMockTheme();

    const result = renderer({ content: "Board context here" }, {}, theme) as { toString(): string };

    expect(theme.fg).toHaveBeenCalledWith("accent", "📋 ");
    expect(theme.fg).toHaveBeenCalledWith("dim", "Board context here");
    // The result should be a Text instance wrapping the themed output
    expect(result).toBeDefined();
    expect(result.toString()).toBe("[accent]📋 [dim]Board context here");
  });

  it("renders phased-tasks-notice with warning icon and text content", () => {
    const mockObj = createMockAPI();
    registerMessageRenderers(mockObj.api);

    // Find the notice renderer callback
    const noticeCall = mockObj.registerMessageRenderer.mock.calls.find(
      (call: unknown) => (call as [string, unknown])[0] === "phased-tasks-notice",
    );
    const renderer = (noticeCall as [string, (...args: unknown[]) => unknown])[1];
    const theme = createMockTheme();

    const result = renderer({ content: "Limit reached!" }, {}, theme) as { toString(): string };

    expect(theme.fg).toHaveBeenCalledWith("warning", "⚠ ");
    expect(theme.fg).toHaveBeenCalledWith("text", "Limit reached!");
    expect(result).toBeDefined();
    expect(result.toString()).toBe("[warning]⚠ [text]Limit reached!");
  });
});
