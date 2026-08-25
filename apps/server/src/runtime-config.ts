export type BridgeMode = "REQUIRED" | "APPIUM_ONLY";

export interface UnityCommandConfig {
  readonly executablePath: string;
  readonly projectPath: string;
  readonly argumentTemplates: readonly string[];
}

/**
 * Keep the production default strict while allowing packages without the QA
 * Bridge to use Appium-only synchronization explicitly. This is a mode switch,
 * not a silent fallback: callers must pass the selected mode to every worker
 * and action-dispatch boundary.
 */
export function parseBridgeMode(env: Readonly<Record<string, string | undefined>>): BridgeMode {
  const value = env.TEST_CENTER_BRIDGE_MODE?.trim().toLowerCase();
  if (value === undefined || value === "" || value === "required") return "REQUIRED";
  if (value === "optional" || value === "appium_only" || value === "appium-only") {
    return "APPIUM_ONLY";
  }
  throw new Error("TEST_CENTER_BRIDGE_MODE must be 'required' or 'optional'.");
}

export function parseUnityCommandConfig(
  env: Readonly<Record<string, string | undefined>>,
): UnityCommandConfig | undefined {
  const executablePath = env.TEST_CENTER_UNITY_EXECUTABLE_PATH?.trim() ?? "";
  const projectPath = env.TEST_CENTER_UNITY_PROJECT_PATH?.trim() ?? "";
  const argsJson = env.TEST_CENTER_UNITY_BUILD_ARGS_JSON?.trim() ?? "";
  const configured = [executablePath, projectPath, argsJson].some((value) => value !== "");
  if (!configured) return undefined;
  if (executablePath === "" || projectPath === "" || argsJson === "") {
    throw new Error(
      "TEST_CENTER_UNITY_EXECUTABLE_PATH, TEST_CENTER_UNITY_PROJECT_PATH, and TEST_CENTER_UNITY_BUILD_ARGS_JSON must be configured together.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch (error) {
    throw new Error("TEST_CENTER_UNITY_BUILD_ARGS_JSON must be a JSON array of strings.", {
      cause: error,
    });
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new TypeError("TEST_CENTER_UNITY_BUILD_ARGS_JSON must be a JSON array of strings.");
  }
  const argumentTemplates = parsed.map((value) => value.trim());
  if (argumentTemplates.length === 0 || argumentTemplates.some((value) => value === "")) {
    throw new TypeError("TEST_CENTER_UNITY_BUILD_ARGS_JSON must contain at least one argument.");
  }
  return { executablePath, projectPath, argumentTemplates };
}
