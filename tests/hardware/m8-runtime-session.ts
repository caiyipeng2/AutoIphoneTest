import { win32 } from "node:path";

import { createRuntimeDeviceRegistry } from "../../apps/server/src/device-runtime.js";

const projectRoot = win32.normalize(process.env.TEST_CENTER_PROJECT_ROOT ?? process.cwd());
const serial = process.env.TEST_CENTER_DEVICE_SERIAL ?? "192.168.22.73:5555";
const packageName = process.env.TEST_CENTER_PACKAGE ?? "com.hg.idleweaponshoptycoon.android";

process.env.TEST_CENTER_DATA_ROOT ??= win32.join(
  projectRoot,
  "data",
  "hardware-m8-runtime-session",
);
process.env.TEST_CENTER_APPIUM_NODE ??= process.execPath;
process.env.TEST_CENTER_APPIUM_ENTRY ??= win32.join(
  projectRoot,
  "node_modules",
  "appium",
  "build",
  "lib",
  "main.js",
);
process.env.TEST_CENTER_APPIUM_HOME ??= win32.join(projectRoot, "data", "appium-home");

const runtime = await createRuntimeDeviceRegistry(projectRoot);
try {
  await runtime.registry.poll();
  const device = runtime.registry.get(serial);
  if (device?.state !== "ONLINE") throw new Error(`Device is not online: ${serial}.`);

  const created = await runtime.sessionService.create({
    clientRequestId: `m8-hardware-${Date.now()}`,
    packageName,
    deviceSerial: serial,
    leaderVideoEnabled: false,
    actorSessionId: "m8-hardware-acceptance",
  });
  await runtime.sessionService.preflight(created.session.id, "m8-hardware-acceptance");
  const started = await runtime.sessionService.start(created.session.id, "m8-hardware-acceptance");
  const activeSerials = runtime.workerCoordinator.list(created.session.id);
  if (started.state !== "RUNNING" || activeSerials.length !== 1 || activeSerials[0] !== serial) {
    throw new Error(
      `Unexpected managed session state: ${JSON.stringify({ state: started.state, activeSerials })}`,
    );
  }

  await runtime.workerCoordinator.stop(created.session.id);
  const stoppedSerials = runtime.workerCoordinator.list(created.session.id);
  if (stoppedSerials.length !== 0) throw new Error("Managed worker remained active after stop.");

  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      sessionId: created.session.id,
      serial,
      packageName,
      state: started.state,
      activeSerials,
      stoppedSerials,
    })}\n`,
  );
} finally {
  await runtime.close();
}
