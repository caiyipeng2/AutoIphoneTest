import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const adapterPath = join(
  repositoryRoot,
  "packages",
  "unity-qa-bridge",
  "integrations",
  "idle-weapon-shop-tycoon",
  "IdleWeaponShopQaBridge.cs",
);
const stagingScriptPath = join(repositoryRoot, "scripts", "stage-unity-qa-bridge.ps1");
const editorSmokePath = join(
  repositoryRoot,
  "packages",
  "unity-qa-bridge",
  "integrations",
  "idle-weapon-shop-tycoon",
  "Editor",
  "TestCenterQaBridgeEditorSmoke.cs",
);
const productionStateScriptPath = join(
  repositoryRoot,
  "tests",
  "hardware",
  "idle-weapon-shop-qa-bridge-state.ts",
);
const qaServerPath = join(
  repositoryRoot,
  "packages",
  "unity-qa-bridge",
  "com.caiyipeng.testcenter.qa",
  "Runtime",
  "QaBridgeServer.cs",
);
const runtimeBridgePath = join(repositoryRoot, "apps", "server", "src", "runtime-bridge.ts");
const productionActionScriptPath = join(
  repositoryRoot,
  "tests",
  "hardware",
  "idle-weapon-shop-qa-bridge-action.ts",
);

describe("Idle Weapon Shop Tycoon QA bridge integration contract", () => {
  it("keeps the production adapter behind the QA-only compilation symbol", async () => {
    const source = await readFile(adapterPath, "utf8");

    expect(source).toContain("#if UNITY_MULTI_DEVICE_QA");
    expect(source).toContain("IQaIdentityProvider");
    expect(source).toContain("IQaViewStateProvider");
    expect(source).toContain("QaBridgeBootstrap.Configure");
    expect(source).toContain("Application.identifier");
    expect(source).toContain("AccountInfo");
  });

  it("correlates observed input without invoking game actions", async () => {
    const source = await readFile(adapterPath, "utf8");

    expect(source).toContain("QaInputObserver");
    expect(source).toContain("QaActionDescriptor");
    expect(source).toContain("Observe(");
    expect(source).not.toMatch(/\.onClick\s*\.Invoke\s*\(/);
    expect(source).not.toMatch(/\.Click\s*\(/);
    expect(source).not.toMatch(/GameEntity\.BridgeCtrl\.Call\s*\(/);
  });

  it("requires an explicit dirty-project override in the staging script", async () => {
    const source = await readFile(stagingScriptPath, "utf8");
    const editorSource = await readFile(editorSmokePath, "utf8");

    expect(source).toContain("[switch]$AllowDirty");
    expect(source).toContain("AllowDirty");
    expect(source).toContain("Packages\\com.caiyipeng.testcenter.qa");
    expect(source).toContain("Assets\\TestCenter\\QaBridge");
    expect(source).toContain("Assets\\Editor");
    expect(source).toContain("TestCenterQaBridgeEditorSmoke");
    expect(source).toContain("BackupRoot");
    expect(source).toContain(".testcenter-backups");
    expect(editorSource).toContain("ExportAndroidProject");
    expect(editorSource).toContain("EnableQaSymbolAndExportAndroidProject");
    expect(editorSource).toContain("SetScriptingDefineSymbolsForGroup");
    expect(editorSource).toContain("BuildProject.BuildProjectAndroidStudio");
    expect(editorSource).toContain("InstallHybridCLR");
    expect(editorSource).toContain("InstallDefaultHybridCLR");
    expect(editorSource).toContain("GenerateHybridCLR");
    expect(editorSource).toContain("PrebuildCommand.GenerateAll");
  });

  it("keeps production hardware acceptance state-only", async () => {
    const source = await readFile(productionStateScriptPath, "utf8");

    expect(source).toContain("QA_HELLO");
    expect(source).toContain("QA_STATE");
    expect(source).toContain("ClockCalibrator");
    expect(source).toContain("forwardAdd");
    expect(source).toContain("startActivity");
    expect(source).not.toMatch(/shell.*input\s+(tap|swipe)/i);
    expect(source).not.toContain("performActions");
    expect(source).not.toContain("clearPackageData");
    expect(source).not.toContain("uninstallPackage");
  });

  it("normalizes Unity JsonUtility empty nullable bridge fields", async () => {
    const source = await readFile(qaServerPath, "utf8");

    expect(source).toContain("NormalizeNullableBridgeFields");
    expect(source).toMatch(/NormalizeNullableBridgeFields[\s\S]*uid/);
    expect(source).toMatch(/NormalizeNullableBridgeFields[\s\S]*focusedControlId/);
    expect(source).toMatch(/NormalizeNullableBridgeFields[\s\S]*expectedFocus/);
  });

  it("observes real Unity touch starts without injecting gameplay input", async () => {
    const source = await readFile(adapterPath, "utf8");

    expect(source).toContain("Input.touchCount");
    expect(source).toContain("TouchPhase.Began");
    expect(source).toContain("ObservePointerPosition");
    expect(source).toContain("Screen.height - 1f");
    expect(source).not.toMatch(/Input\.(Set|Simulate|Reset)/);
  });

  it("quantizes host tap descriptors to the device viewport", async () => {
    const source = await readFile(runtimeBridgePath, "utf8");

    expect(source).toContain("bridgeEventShape");
    expect(source).toContain("state.width");
    expect(source).toContain("toFixed(3)");
  });

  it("keeps production QA action acceptance bounded to one controlled tap", async () => {
    const source = await readFile(productionActionScriptPath, "utf8");

    expect(source).toContain("createRuntimeBridgeSession");
    expect(source).toContain("actionBarrier.arm");
    expect(source).toContain('"input", "tap"');
    expect(source).toContain("waitForAck");
    expect(source).not.toContain("clearPackageData");
    expect(source).not.toContain("uninstallPackage");
  });
});
