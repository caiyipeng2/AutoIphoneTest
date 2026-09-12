import { expect, test } from "@playwright/test";

const bridgeSnapshot = {
  installation: {
    serial: "R5CX211TXNT",
    packageName: "com.hg.idleweaponshoptycoon.android",
    installGeneration: 1,
    appDataGeneration: 1,
    currentUid: "UID-M5-FIXTURE",
  },
  uid: {
    uid: "UID-M5-FIXTURE",
    source: "BRIDGE_AUTO",
    actor: "bridge:bridge-m5",
    buildId: "0.1.0",
    installGeneration: 1,
    appDataGeneration: 1,
    observedAt: "2026-08-07T07:00:00.000Z",
  },
  bridge: {
    status: "READY",
    bridgeInstanceId: "bridge-m5",
    bootId: "boot-m5",
    buildId: "0.1.0",
    stateSeq: 9,
    lastStateAt: "2026-08-07T07:00:00.000Z",
  },
};

test.describe("M5 Unity bridge device detail", () => {
  test("shows live UID and bridge health for the selected device", async ({ page }) => {
    await page.route("**/api/devices", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          schemaVersion: 1,
          devices: [
            {
              serial: "R5CX211TXNT",
              state: "ONLINE",
              metadata: { model: "SM_S9280", androidRelease: "14", uid: "UID-M5-FIXTURE" },
              firstSeenAt: "2026-08-07T07:00:00.000Z",
              lastSeenAt: "2026-08-07T07:00:00.000Z",
              connectionSeq: 1,
              tags: [],
            },
          ],
        }),
      });
    });
    await page.route("**/api/devices/*/bridge?packageName=**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(bridgeSnapshot),
      });
    });
    await page.goto("/#devices");
    await expect(page.getByRole("heading", { name: "设备", exact: true })).toBeVisible();
    const deviceRow = page.getByText("SM_S9280", { exact: true });
    await expect(deviceRow).toBeVisible();
    await deviceRow.click();
    await expect(page.getByRole("heading", { name: /SM_S9280|R5CX211TXNT/ })).toBeVisible();
    await expect(page.getByText("UID-M5-FIXTURE", { exact: true })).toBeVisible();
    await expect(page.getByText("桥接就绪", { exact: true })).toBeVisible();
    await expect(page.getByText("状态序列 9", { exact: true })).toBeVisible();
    await expect(page.getByText("bridge-m5", { exact: true })).toBeVisible();
  });
});
