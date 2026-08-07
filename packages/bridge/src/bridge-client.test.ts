import { describe, expect, it } from "vitest";

import { BridgeClient, BridgeClientError, type BridgeLineTransport } from "./bridge-client.js";

const instance = "bridge-instance-a";

function hello(bridgeInstanceId = instance, bootId = "boot-1"): string {
  return JSON.stringify({
    type: "QA_HELLO",
    schemaVersion: 1,
    bridgeInstanceId,
    bootId,
    buildId: "qa-1",
  });
}

function state(bridgeInstanceId = instance, stateSeq = 1): string {
  return JSON.stringify({
    type: "QA_STATE",
    schemaVersion: 1,
    bridgeInstanceId,
    uid: "UID-1",
    installGeneration: 1,
    appDataGeneration: 2,
    buildId: "qa-1",
    width: 1080,
    height: 2400,
    safeArea: [0, 80, 1080, 2260],
    orientation: "Portrait",
    metricsEpoch: 12,
    view: "MainHUD",
    focusedControlId: null,
    textInputAvailable: false,
    stateSeq,
  });
}

class FakeTransport implements BridgeLineTransport {
  public readonly sent: string[] = [];
  public connected = false;
  private readonly lines = new Set<(line: string) => void>();
  private readonly closes = new Set<(error?: Error) => void>();

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public send(line: string): void {
    if (!this.connected) throw new Error("not connected");
    this.sent.push(line);
  }

  public async close(): Promise<void> {
    this.connected = false;
  }

  public onLine(listener: (line: string) => void): () => void {
    this.lines.add(listener);
    return () => this.lines.delete(listener);
  }

  public onClose(listener: (error?: Error) => void): () => void {
    this.closes.add(listener);
    return () => this.closes.delete(listener);
  }

  public emit(line: string): void {
    this.lines.forEach((listener) => listener(line));
  }

  public emitClose(error?: Error): void {
    this.connected = false;
    this.closes.forEach((listener) => listener(error));
  }
}

describe("BridgeClient", () => {
  it("is ready only after the matching hello and state arrive", async () => {
    const transport = new FakeTransport();
    const client = new BridgeClient({ transport, handshakeTimeoutMs: 100 });
    const statuses: string[] = [];
    client.onStatusChange((status) => statuses.push(status));

    const connecting = client.connect();
    await Promise.resolve();
    transport.emit(hello());
    expect(client.getSnapshot().status).toBe("connecting");
    transport.emit(state());
    await connecting;

    expect(client.getSnapshot()).toMatchObject({
      status: "ready",
      bridgeInstanceId: instance,
      state: { stateSeq: 1 },
    });
    expect(statuses).toEqual(["connecting", "ready"]);

    client.send({ type: "QA_PING", schemaVersion: 1, pingId: "ping-1" });
    expect(transport.sent).toEqual(['{"type":"QA_PING","schemaVersion":1,"pingId":"ping-1"}\n']);
  });

  it("fences a restarted bridge instance and becomes ready again only after its state", async () => {
    const transport = new FakeTransport();
    const client = new BridgeClient({ transport, handshakeTimeoutMs: 100 });
    const connecting = client.connect();
    await Promise.resolve();
    transport.emit(hello());
    transport.emit(state());
    await connecting;

    transport.emit(hello("bridge-instance-b", "boot-2"));
    expect(client.getSnapshot()).toMatchObject({
      status: "connecting",
      bridgeInstanceId: "bridge-instance-b",
    });
    transport.emit(state("bridge-instance-b", 1));
    expect(client.getSnapshot()).toMatchObject({ status: "ready", state: { stateSeq: 1 } });
  });

  it("fails the handshake on an invalid bridge message and reports timeout", async () => {
    const transport = new FakeTransport();
    const client = new BridgeClient({ transport, handshakeTimeoutMs: 100 });
    const connecting = client.connect();
    await Promise.resolve();
    transport.emit("not-json");
    await expect(connecting).rejects.toMatchObject({
      name: "BridgeClientError",
      code: "PROTOCOL_ERROR",
    });

    const timeoutClient = new BridgeClient({
      transport: new FakeTransport(),
      handshakeTimeoutMs: 1,
    });
    await expect(timeoutClient.connect()).rejects.toBeInstanceOf(BridgeClientError);
    await expect(timeoutClient.connect()).rejects.toMatchObject({ code: "HANDSHAKE_TIMEOUT" });
  });

  it("transitions to error when an established transport closes", async () => {
    const transport = new FakeTransport();
    const client = new BridgeClient({ transport, handshakeTimeoutMs: 100 });
    const connecting = client.connect();
    await Promise.resolve();
    transport.emit(hello());
    transport.emit(state());
    await connecting;
    transport.emitClose(new Error("device disconnected"));
    expect(client.getSnapshot().status).toBe("error");
  });
});
