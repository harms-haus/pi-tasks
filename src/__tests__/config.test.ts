import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadConfig, resolvePhasePrompt, resetConfig } from "../config";

// ── Mocks ──

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("node:path", () => ({
  join: vi.fn((...parts: string[]) => parts.join("/")),
}));

import { readFile } from "node:fs/promises";

const mockReadFile = vi.mocked(readFile);

// ── Tests ──

describe("config", () => {
  beforeEach(() => {
    resetConfig();
    mockReadFile.mockReset();
  });

  // ── loadConfig ──

  describe("loadConfig", () => {
    it("returns empty config when file does not exist", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));

      const config = await loadConfig();

      expect(config).toEqual({});
    });

    it("returns empty config when file contains invalid JSON", async () => {
      mockReadFile.mockResolvedValue("not valid json {{{");

      const config = await loadConfig();

      expect(config).toEqual({});
    });

    it("returns empty config when JSON is not an object", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify("a string"));

      const config = await loadConfig();

      expect(config).toEqual({});
    });

    it("returns empty config when JSON is null", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify(null));

      const config = await loadConfig();

      expect(config).toEqual({});
    });

    it("returns empty config when phaseCompletionPromptTemplate is missing", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ otherField: 42 }));

      const config = await loadConfig();

      expect(config).toEqual({});
    });

    it("returns empty config when phaseCompletionPromptTemplate is not a string", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ phaseCompletionPromptTemplate: 123 }),
      );

      const config = await loadConfig();

      expect(config).toEqual({});
    });

    it("returns custom config with valid phaseCompletionPromptTemplate", async () => {
      const template = "Phase {phase} complete!";
      mockReadFile.mockResolvedValue(
        JSON.stringify({ phaseCompletionPromptTemplate: template }),
      );

      const config = await loadConfig();

      expect(config).toEqual({ phaseCompletionPromptTemplate: template });
    });

    it("caches the config on first load", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ phaseCompletionPromptTemplate: "cached" }),
      );

      const first = await loadConfig();
      const second = await loadConfig();

      // readFile should only be called once because the second call uses cache
      expect(mockReadFile).toHaveBeenCalledTimes(1);
      expect(first).toBe(second); // Same reference
    });
  });

  // ── resolvePhasePrompt ──

  describe("resolvePhasePrompt", () => {
    it("returns undefined when template is undefined", () => {
      expect(resolvePhasePrompt(undefined, 1)).toBeUndefined();
    });

    it("returns undefined when template is empty string", () => {
      expect(resolvePhasePrompt("", 3)).toBeUndefined();
    });

    it("replaces {phase} with the phase number", () => {
      const result = resolvePhasePrompt("Completed phase {phase}", 2);
      expect(result).toBe("Completed phase 2");
    });

    it("replaces multiple {phase} occurrences", () => {
      const result = resolvePhasePrompt(
        "Phase {phase} of {phase} is done",
        3,
      );
      expect(result).toBe("Phase 3 of 3 is done");
    });

    it("preserves surrounding text when no placeholder present", () => {
      const result = resolvePhasePrompt("All done!", 1);
      expect(result).toBe("All done!");
    });
  });

  // ── resetConfig ──

  describe("resetConfig", () => {
    it("clears cache so next loadConfig re-reads the file", async () => {
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ phaseCompletionPromptTemplate: "first" }),
      );

      const first = await loadConfig();
      expect(first).toEqual({ phaseCompletionPromptTemplate: "first" });
      expect(mockReadFile).toHaveBeenCalledTimes(1);

      // Reset and change the mock
      resetConfig();
      mockReadFile.mockResolvedValueOnce(
        JSON.stringify({ phaseCompletionPromptTemplate: "second" }),
      );

      const afterReset = await loadConfig();
      expect(afterReset).toEqual({ phaseCompletionPromptTemplate: "second" });
      expect(mockReadFile).toHaveBeenCalledTimes(2);
    });
  });
});
