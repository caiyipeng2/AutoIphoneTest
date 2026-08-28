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

    expect(source).toContain("[switch]$AllowDirty");
    expect(source).toContain("AllowDirty");
    expect(source).toContain("Packages\\com.caiyipeng.testcenter.qa");
    expect(source).toContain("Assets\\TestCenter\\QaBridge");
  });
});
