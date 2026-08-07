// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeviceDetails } from "./DeviceDetails";
import * as api from "../../state/api";

const device = {
  serial: "R5CX211TXNT",
  state: "ONLINE" as const,
  metadata: { model: "SM-S9280" },
  firstSeenAt: "2026-08-07T10:00:00.000Z",
  lastSeenAt: "2026-08-07T10:01:00.000Z",
  connectionSeq: 7,
  tags: [],
};

const snapshot = {
  installation: {
    serial: device.serial,
    packageName: "com.hg.idleweaponshoptycoon.android",
    installGeneration: 3,
    appDataGeneration: 2,
    currentUid: "UID-1001",
    updatedAt: "2026-08-07T10:00:00.000Z",
  },
  uid: {
    uid: "UID-1001",
    source: "BRIDGE_AUTO" as const,
    actor: "bridge",
    buildId: "build-42",
    installGeneration: 3,
    appDataGeneration: 2,
    observedAt: "2026-08-07T10:00:30.000Z",
  },
  bridge: {
    status: "READY" as const,
    bridgeInstanceId: "bridge-1",
    bootId: "boot-1",
    buildId: "build-42",
    stateSeq: 12,
    lastStateAt: "2026-08-07T10:00:30.000Z",
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DeviceDetails", () => {
  it("loads current generation details and completes one-time manual UID correction", async () => {
    const fetchBridge = vi.spyOn(api, "fetchDeviceBridge").mockResolvedValue(snapshot);
    const issueConfirmation = vi.spyOn(api, "issueUidConfirmation").mockResolvedValue("nonce-1");
    const updated = {
      ...snapshot,
      uid: { ...snapshot.uid, uid: "UID-MANUAL", source: "MANUAL" as const, actor: "operator" },
      installation: { ...snapshot.installation, currentUid: "UID-MANUAL" },
    };
    const updateUid = vi.spyOn(api, "updateManualUid").mockResolvedValue(updated);

    render(<DeviceDetails device={device} onClose={vi.fn()} />);

    expect(await screen.findByText("UID-1001")).toBeInTheDocument();
    expect(fetchBridge).toHaveBeenCalledWith(device.serial, "com.hg.idleweaponshoptycoon.android");
    expect(screen.getByText("桥接就绪")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑 UID" }));
    expect(screen.getByRole("dialog", { name: "修正设备 UID" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "UID-MANUAL" } });
    fireEvent.click(screen.getByRole("button", { name: "获取一次性确认" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存当前 UID" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "保存当前 UID" }));

    await waitFor(() =>
      expect(updateUid).toHaveBeenCalledWith(
        device.serial,
        "com.hg.idleweaponshoptycoon.android",
        "UID-MANUAL",
        "nonce-1",
      ),
    );
    await waitFor(() => expect(screen.getByText("UID-MANUAL")).toBeInTheDocument());
    expect(issueConfirmation).toHaveBeenCalledWith(
      device.serial,
      "com.hg.idleweaponshoptycoon.android",
    );
  });
});
