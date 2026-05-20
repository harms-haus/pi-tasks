import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface PhasedTasksConfig {
  phaseCompletionPromptTemplate?: string;
}

const CONFIG_PATH = ".pi/phased-tasks.json";

/** Cached config, loaded once per session. */
let cachedConfig: PhasedTasksConfig | null = null;

/** Load config from the project-local JSON file. Returns empty config on missing/invalid file. */
export async function loadConfig(): Promise<PhasedTasksConfig> {
  if (cachedConfig !== null) return cachedConfig;
  try {
    const raw = await readFile(join(process.cwd(), CONFIG_PATH), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    cachedConfig =
      typeof parsed === "object" &&
      parsed !== null &&
      "phaseCompletionPromptTemplate" in parsed &&
      typeof (parsed as Record<string, unknown>).phaseCompletionPromptTemplate === "string"
        ? {
            phaseCompletionPromptTemplate: (parsed as Record<string, unknown>)
              .phaseCompletionPromptTemplate as string,
          }
        : {};
  } catch {
    cachedConfig = {};
  }
  return cachedConfig;
}

/** Resolve the phase completion prompt template for a given phase number. Returns undefined if no template configured. */
export function resolvePhasePrompt(
  template: string | undefined,
  phase: number,
): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{phase\}/g, String(phase));
}

/** Reset cached config. For testing only. */
export function resetConfig(): void {
  cachedConfig = null;
}
