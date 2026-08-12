import { describe, expect, it } from "vitest";

import { actionCompletionPolicy, actionDescriptor, parseActionCommand } from "./action-command.js";

describe("parseActionCommand", () => {
  it("accepts bounded input and lifecycle commands", () => {
    expect(parseActionCommand({ type: "tap", x: 0.25, y: 0.75 })).toEqual({
      type: "tap",
      x: 0.25,
      y: 0.75,
    });
    expect(parseActionCommand({ type: "longPress", x: 0.5, y: 0.5, durationMs: 300 })).toEqual({
      type: "longPress",
      x: 0.5,
      y: 0.5,
      durationMs: 300,
    });
    expect(
      parseActionCommand({
        type: "swipe",
        path: [
          [0, 0],
          [1, 1],
        ],
        durationMs: 50,
      }),
    ).toMatchObject({ type: "swipe", durationMs: 50 });
    expect(parseActionCommand({ type: "back" })).toEqual({ type: "back" });
    expect(parseActionCommand({ type: "activate" })).toEqual({ type: "activate" });
    expect(parseActionCommand({ type: "terminate" })).toEqual({ type: "terminate" });
    expect(parseActionCommand({ type: "restart" })).toEqual({ type: "restart" });
  });

  it("rejects out-of-range gestures and empty text", () => {
    expect(() =>
      parseActionCommand({ type: "longPress", x: 0.5, y: 0.5, durationMs: 299 }),
    ).toThrow(/300-10000/);
    expect(() =>
      parseActionCommand({ type: "longPress", x: 0.5, y: 0.5, durationMs: 10_001 }),
    ).toThrow(/300-10000/);
    expect(() => parseActionCommand({ type: "swipe", path: [[0, 0]], durationMs: 100 })).toThrow(
      /2-128/,
    );
    expect(() => parseActionCommand({ type: "text", text: "" })).toThrow(/1-2000/);
    expect(() => parseActionCommand({ type: "text", text: "x".repeat(2_001) })).toThrow(/1-2000/);
  });
});

describe("actionCompletionPolicy", () => {
  it.each([
    ["tap", { armBridge: true, completion: "BRIDGE_ACK" }],
    ["longPress", { armBridge: true, completion: "BRIDGE_ACK" }],
    ["swipe", { armBridge: true, completion: "BRIDGE_ACK" }],
    ["back", { armBridge: true, completion: "BRIDGE_ACK" }],
    ["text", { armBridge: true, completion: "BRIDGE_ACK" }],
    ["activate", { armBridge: false, completion: "FRESH_BRIDGE_STATE" }],
    ["terminate", { armBridge: false, completion: "PROCESS_ABSENT" }],
    ["restart", { armBridge: false, completion: "FRESH_BRIDGE_STATE" }],
  ] as const)("maps %s to its acknowledgement policy", (type, expected) => {
    expect(actionCompletionPolicy({ type })).toEqual(expected);
  });
});

describe("actionDescriptor", () => {
  it("does not include plaintext text while retaining a stable class hash", () => {
    const first = actionDescriptor({ type: "text", text: "金币 CJK" });
    const second = actionDescriptor({ type: "text", text: "金币 CJK" });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ type: "text", length: 6 });
    expect(first.type).toBe("text");
    if (first.type !== "text") throw new Error("Expected a text descriptor.");
    expect(first).not.toHaveProperty("text");
    expect(first.classHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(actionDescriptor({ type: "text", text: "银币 ABC" })).toEqual(first);
  });
});
