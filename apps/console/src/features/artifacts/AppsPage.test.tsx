// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppsPage } from "../../pages/AppsPage";

const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AppsPage", () => {
  it("renders source and installed records, filters them, and keeps installed paths hidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          schemaVersion: 1,
          artifacts: [
            {
              id: "source-1",
              kind: "APK",
              sha256: digest,
              sizeBytes: 1024,
              storedPath: "sha256/01/game.apk",
              originalName: "game.apk",
              packageName: "com.example.game",
              versionName: "1.4.2",
              versionCode: 42,
              signerSha256: digest,
              createdAt: "2026-08-05T12:00:00.000Z",
            },
            {
              id: "installed-1",
              kind: "INSTALLED",
              deviceSerial: "R5CX211TXNT",
              packageName: "com.example.game",
              versionName: "1.4.2",
              versionCode: 42,
              signerSha256: digest,
              installedSetSha256: digest,
              observedAt: "2026-08-05T12:00:00.000Z",
              createdAt: "2026-08-05T12:00:00.000Z",
            },
          ],
        }),
      }),
    );
    render(<AppsPage />);
    expect(await screen.findByText("game.apk")).toBeInTheDocument();
    expect(screen.getByText("已安装版本")).toBeInTheDocument();
    expect(screen.getByText("UID · R5CX211TXNT")).toBeInTheDocument();
    expect(screen.queryByText("sha256/01/game.apk")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "制品类型筛选" }), {
      target: { value: "INSTALLED" },
    });
    await waitFor(() => expect(screen.queryByText("game.apk")).not.toBeInTheDocument());
    expect(screen.getByText("已安装版本")).toBeInTheDocument();
  });

  it("opens the import dialog with explicit APK/AAB controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ artifacts: [] }) }),
    );
    render(<AppsPage />);
    await screen.findByText("暂无符合筛选条件的制品。");
    fireEvent.click(screen.getByRole("button", { name: "导入包体" }));
    expect(screen.getByRole("dialog", { name: "导入 Android 包体" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "包体类型" })).toHaveValue("APK");
  });

  it("loads providers and shows the build result timeline", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/artifacts/providers")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            schemaVersion: 1,
            providers: [
              { id: "artifact-import", default: true },
              { id: "unity-command", default: false },
            ],
          }),
        });
      }
      if (url.endsWith("/api/artifacts/build")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            schemaVersion: 1,
            state: "CREATED",
            buildId: "build-ui-1",
            artifact: {
              artifactId: "artifact-ui-1",
              kind: "APK",
              sha256: digest,
              publishState: "CREATED",
            },
            events: [
              {
                buildId: "build-ui-1",
                phase: "validate",
                status: "completed",
                at: "2026-08-25T03:00:00.000Z",
              },
              {
                buildId: "build-ui-1",
                phase: "build",
                status: "completed",
                at: "2026-08-25T03:00:01.000Z",
              },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ schemaVersion: 1, artifacts: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AppsPage />);
    await screen.findByText("暂无符合筛选条件的制品。");
    const buildButton = await screen.findByRole("button", { name: /按提供器构建/ });
    expect(buildButton).toBeEnabled();
    fireEvent.click(buildButton);
    expect(screen.getByRole("dialog", { name: "按提供器构建包体" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "构建提供器" }), {
      target: { value: "unity-command" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "构建输出路径" }), {
      target: { value: "Builds/game.apk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始构建" }));
    expect(await screen.findByText("包体已发布")).toBeInTheDocument();
    expect(screen.getByText("validate")).toBeInTheDocument();
    expect(screen.getByText("build")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/artifacts/build",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
