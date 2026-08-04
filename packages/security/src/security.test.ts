import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { BootstrapSessionStore } from "./bootstrap-session.js";
import { assertAllowedHost, assertSameOrigin, assertValidCsrf } from "./request-policy.js";

describe("bootstrap sessions", () => {
  it("consumes a bootstrap code once and never stores the plaintext material", () => {
    const store = new BootstrapSessionStore({ now: () => 1_000 });
    const launchSecret = randomBytes(32).toString("base64url");
    store.issue({ bootstrapCode: "one-time-code", launchSecret, expiresAt: 2_000 });

    const session = store.consume("one-time-code");
    expect(session).toMatchObject({ sessionId: expect.any(String), csrfToken: expect.any(String) });
    expect(store.consume("one-time-code")).toBeUndefined();
    expect(store.debugRecords()).not.toContainEqual(
      expect.objectContaining({ bootstrapCode: "one-time-code" }),
    );
  });

  it("rejects expired bootstrap codes", () => {
    let now = 1_000;
    const store = new BootstrapSessionStore({ now: () => now });
    store.issue({ bootstrapCode: "expired", launchSecret: "secret", expiresAt: 2_000 });
    now = 2_001;
    expect(store.consume("expired")).toBeUndefined();
  });
});

describe("local request policy", () => {
  it("allows only the actual loopback host and exact console origin", () => {
    expect(() => assertAllowedHost("127.0.0.1:4780", 4780)).not.toThrow();
    expect(() => assertAllowedHost("[::1]:4780", 4780)).not.toThrow();
    expect(() => assertAllowedHost("localhost:4780", 4780)).toThrow(/Host/);
    expect(() => assertAllowedHost("127.0.0.1:4781", 4780)).toThrow(/Host/);
    expect(() => assertSameOrigin("http://127.0.0.1:4780", 4780)).not.toThrow();
    expect(() => assertSameOrigin("http://evil.example", 4780)).toThrow(/Origin/);
  });

  it("requires a matching CSRF cookie and header for mutations", () => {
    expect(() => assertValidCsrf("csrf-value", "csrf-value")).not.toThrow();
    expect(() => assertValidCsrf("csrf-value", "wrong")).toThrow(/CSRF/);
    expect(() => assertValidCsrf(undefined, "csrf-value")).toThrow(/CSRF/);
  });
});
