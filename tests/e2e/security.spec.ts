import { expect, test } from "@playwright/test";

test.describe("M1 local security boundary", () => {
  test("rejects invalid and reused bootstrap codes", async ({ request }) => {
    const invalid = await request.post("/api/bootstrap/exchange", {
      headers: { Host: "127.0.0.1:4780", Origin: "http://127.0.0.1:4780" },
      data: { code: "invalid" },
    });
    expect(invalid.status()).toBe(401);
    const reused = await request.post("/api/bootstrap/exchange", {
      headers: { Host: "127.0.0.1:4780", Origin: "http://127.0.0.1:4780" },
      data: { code: "dev-bootstrap-code" },
    });
    expect(reused.status()).toBe(401);
  });

  test("rejects foreign host, origin, and csrf mutation", async ({ request }) => {
    const foreignHost = await request.get("/api/health", { headers: { Host: "localhost:4780" } });
    expect(foreignHost.status()).toBe(400);
    const foreignOrigin = await request.patch("/api/settings", {
      headers: {
        Host: "127.0.0.1:4780",
        Origin: "http://localhost:4780",
        "x-test-center-csrf": "bad",
        "if-match": '"1"',
      },
      data: { retentionDays: 21 },
    });
    expect(foreignOrigin.status()).toBe(403);
    const csrfMismatch = await request.patch("/api/settings", {
      headers: {
        Host: "127.0.0.1:4780",
        Origin: "http://127.0.0.1:4780",
        "x-test-center-csrf": "bad",
        "if-match": '"1"',
      },
      data: { retentionDays: 21 },
    });
    expect(csrfMismatch.status()).toBe(403);
  });
});
