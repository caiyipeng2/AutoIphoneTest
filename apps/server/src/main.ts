import { createApp } from "./app.js";
import { createReadinessRecord, readLauncherInit } from "./launcher-ipc.js";

export async function main(): Promise<void> {
  const launcherInit = await readLauncherInit(process.stdin);
  const port =
    launcherInit.requestedPort === undefined || launcherInit.requestedPort === 0
      ? 4780
      : launcherInit.requestedPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("TEST_CENTER_PORT must be a valid TCP port.");
  }
  const app = await createApp({
    port,
    bootstrapCode: launcherInit.bootstrapCode,
    launchSecret: launcherInit.launchSecret,
  });
  await app.listen({ host: "127.0.0.1", port });
  process.stdout.write(
    `${JSON.stringify(createReadinessRecord(launcherInit.launchSecret, port, process.pid))}\n`,
  );
}

if (process.argv[1]?.endsWith("main.js")) {
  await main();
}
