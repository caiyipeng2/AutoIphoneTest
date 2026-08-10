import { describe, expect, it } from "vitest";

import { buildScrcpyServerArguments } from "./adb-scrcpy-transport.js";

describe("adb scrcpy transport", () => {
  it("builds a serial-bound control-free v3.1 server command", () => {
    expect(
      buildScrcpyServerArguments({
        serial: "R5CX211TXNT",
        serverPath: "E:/tools/scrcpy/3.1/scrcpy-server",
        remoteServerPath: "/data/local/tmp/test-center-scrcpy-server.jar",
        scid: "12abcdef",
        maxSize: 1080,
      }),
    ).toEqual({
      adbArgs: [
        "-s",
        "R5CX211TXNT",
        "shell",
        "CLASSPATH=/data/local/tmp/test-center-scrcpy-server.jar",
        "app_process",
        "/",
        "com.genymobile.scrcpy.Server",
        "3.1",
        "tunnel_forward=true",
        "scid=12abcdef",
        "audio=false",
        "control=false",
        "cleanup=true",
        "send_device_meta=false",
        "send_dummy_byte=false",
        "video_codec=h264",
        "max_size=1080",
      ],
      pushArgs: [
        "-s",
        "R5CX211TXNT",
        "push",
        "E:/tools/scrcpy/3.1/scrcpy-server",
        "/data/local/tmp/test-center-scrcpy-server.jar",
      ],
      forwardArgs: ["-s", "R5CX211TXNT", "forward", "tcp:27183", "localabstract:scrcpy_12abcdef"],
    });
  });
});
