import { createApp } from "./app.js";

const port = Number(process.env.TEST_CENTER_SERVER_PORT ?? 4780);
const options = {
  port,
  bootstrapCode: process.env.TEST_CENTER_BOOTSTRAP_CODE ?? "dev-bootstrap-code",
  launchSecret: "dev-launch-secret",
} as const;
const app = await createApp(
  process.env.TEST_CENTER_CONSOLE_DIST
    ? { ...options, consoleDist: process.env.TEST_CENTER_CONSOLE_DIST }
    : options,
);
await app.listen({ host: "127.0.0.1", port });
process.stdout.write(`DEV_READY ${port}\n`);
