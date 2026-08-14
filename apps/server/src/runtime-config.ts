export type BridgeMode = "REQUIRED" | "APPIUM_ONLY";

/**
 * Keep the production default strict while allowing packages without the QA
 * Bridge to use Appium-only synchronization explicitly. This is a mode switch,
 * not a silent fallback: callers must pass the selected mode to every worker
 * and action-dispatch boundary.
 */
export function parseBridgeMode(
  env: Readonly<Record<string, string | undefined>>,
): BridgeMode {
  const value = env.TEST_CENTER_BRIDGE_MODE?.trim().toLowerCase();
  if (value === undefined || value === "" || value === "required") return "REQUIRED";
  if (value === "optional" || value === "appium_only" || value === "appium-only") {
    return "APPIUM_ONLY";
  }
  throw new Error("TEST_CENTER_BRIDGE_MODE must be 'required' or 'optional'.");
}
