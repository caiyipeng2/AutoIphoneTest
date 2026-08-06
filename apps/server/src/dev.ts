import { createApp } from "./app.js";
import { createRuntimeDeviceRegistry } from "./device-runtime.js";

const port = Number(process.env.TEST_CENTER_SERVER_PORT ?? 4780);
const options = {
  port,
  bootstrapCode: process.env.TEST_CENTER_BOOTSTRAP_CODE ?? "dev-bootstrap-code",
  launchSecret: "dev-launch-secret",
} as const;
const runtimeDevices = await createRuntimeDeviceRegistry(process.cwd());
const app = await createApp(
  process.env.TEST_CENTER_CONSOLE_DIST
    ? {
        ...options,
        consoleDist: process.env.TEST_CENTER_CONSOLE_DIST,
        deviceRegistry: runtimeDevices.registry,
        artifactService: runtimeDevices.artifactService,
        deploymentService: runtimeDevices.deploymentService,
      }
    : {
        ...options,
        deviceRegistry: runtimeDevices.registry,
        artifactService: runtimeDevices.artifactService,
        deploymentService: runtimeDevices.deploymentService,
      },
);
app.addHook("onClose", async () => {
  runtimeDevices.registry.stop();
  runtimeDevices.close();
});
await app.listen({ host: "127.0.0.1", port });
void runtimeDevices.registry.start();
process.stdout.write(`DEV_READY ${port}\n`);
