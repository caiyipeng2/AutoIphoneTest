import { mkdir } from "node:fs/promises";
import { request, type FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = String(config.projects[0]?.use.baseURL ?? "http://127.0.0.1:4780");
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/bootstrap/exchange", {
    headers: { Host: "127.0.0.1:4780", Origin: baseURL, "content-type": "application/json" },
    data: { code: "dev-bootstrap-code" },
  });
  if (response.status() !== 204)
    throw new Error(`Bootstrap setup failed: ${response.status()} ${await response.text()}`);
  await mkdir("data/e2e", { recursive: true });
  await context.storageState({ path: "data/e2e/storage-state.json" });
  await context.dispose();
}
