import { describe, expect, it } from "vitest";

import { createRuntimeBridgeSession } from "./runtime-bridge.js";

describe("createRuntimeBridgeSession", () => {
  it("exposes a bridge action barrier and keeps the configured nonce", async () => {
    const session = createRuntimeBridgeSession({
      hostPort: 1,
      runNonceHash: `sha256:${"a".repeat(64)}`,
      connectTimeoutMs: 10,
    });
    expect(session.actionBarrier).toHaveProperty("arm");
    await expect(session.connect()).rejects.toThrow();
    await session.close();
  });
});
