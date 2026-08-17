import { createApp } from "./app.js";
import { createRuntimeDeviceRegistry } from "./device-runtime.js";
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
  const runtimeDevices = await createRuntimeDeviceRegistry(process.cwd());
  const app = await createApp({
    port,
    bootstrapCode: launcherInit.bootstrapCode,
    launchSecret: launcherInit.launchSecret,
    deviceRegistry: runtimeDevices.registry,
    artifactService: runtimeDevices.artifactService,
    deploymentService: runtimeDevices.deploymentService,
    uidService: runtimeDevices.uidService,
    sessionService: runtimeDevices.sessionService,
    incidentService: runtimeDevices.incidentService,
    resultsService: runtimeDevices.resultsService,
    resultsExportRoot: runtimeDevices.resultsExportRoot,
  });
  app.addHook("onClose", async () => {
    runtimeDevices.faultMonitor.stop();
    runtimeDevices.logcatFaultMonitor.stop();
    runtimeDevices.runtimeFaultMonitor.stop();
    runtimeDevices.registry.stop();
    await runtimeDevices.close();
  });
  await app.listen({ host: "127.0.0.1", port });
  void runtimeDevices.registry.start();
  runtimeDevices.faultMonitor.start();
  runtimeDevices.logcatFaultMonitor.start();
  runtimeDevices.runtimeFaultMonitor.start();
  process.stdout.write(
    `${JSON.stringify(createReadinessRecord(launcherInit.launchSecret, port, process.pid))}\n`,
  );
}

if (process.argv[1]?.endsWith("main.js")) {
  await main();
}
