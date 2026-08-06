import { describe, expect, it } from "vitest";

import {
  SigningProfileStore,
  createSecretFiles,
  type KeytoolProcess,
  validateSigningProfile,
} from "./signing-profile.js";

describe("signing profiles", () => {
  it("stores only validated absolute Windows keystore metadata and defaults to memory-only", () => {
    const store = new SigningProfileStore();
    const profile = store.create({
      id: "qa-release",
      displayName: "QA release",
      keystorePath: "E:\\Secrets\\qa-release.keystore",
      alias: "qa",
      certificateSha256: "a".repeat(64),
      credentialTarget: "UnityMultiDeviceTestCenter/Signing/qa-release",
    });

    expect(profile.storage).toBe("memory");
    expect(store.get("qa-release")).toEqual(profile);
    expect(new SigningProfileStore().get("qa-release")).toBeUndefined();
    expect(() =>
      store.create({
        ...profile,
        keystorePath: "relative.keystore",
      }),
    ).toThrow(/absolute/i);
  });

  it("routes Windows-backed secrets through the credential client", async () => {
    const calls: string[] = [];
    const store = new SigningProfileStore({
      credentialClient: {
        put: async (name, secret) => {
          calls.push(`put:${name}:${secret}`);
        },
        get: async (name) => {
          calls.push(`get:${name}`);
          return "persisted-secret\n";
        },
        delete: async (name) => {
          calls.push(`delete:${name}`);
        },
      },
    });
    store.create({
      id: "qa-persisted",
      displayName: "QA persisted",
      keystorePath: "E:\\Secrets\\qa-release.keystore",
      alias: "qa",
      certificateSha256: "a".repeat(64),
      credentialTarget: "UnityMultiDeviceTestCenter/Signing/qa-persisted",
      storage: "windows-credential-manager",
    });

    await store.putSecret("qa-persisted", "persisted-secret\n");
    await expect(store.getSecret("qa-persisted")).resolves.toBe("persisted-secret\n");
    await store.deleteSecret("qa-persisted");
    expect(calls).toEqual([
      "put:UnityMultiDeviceTestCenter/Signing/qa-persisted:persisted-secret\n",
      "get:UnityMultiDeviceTestCenter/Signing/qa-persisted",
      "delete:UnityMultiDeviceTestCenter/Signing/qa-persisted",
    ]);
  });

  it("validates the certificate with keytool arguments that never carry a password", async () => {
    const calls: KeytoolProcess[] = [];
    await validateSigningProfile(
      {
        id: "qa-release",
        displayName: "QA release",
        keystorePath: "E:\\Secrets\\qa-release.keystore",
        alias: "qa",
        certificateSha256: "a".repeat(64),
        credentialTarget: "UnityMultiDeviceTestCenter/Signing/qa-release",
        storage: "memory",
      },
      async (process) => {
        calls.push(process);
        return { exitCode: 0, stdout: `SHA256: ${"AA:".repeat(31)}AA`, stderr: "" };
      },
    );

    expect(calls[0]?.args).toEqual([
      "-list",
      "-v",
      "-keystore",
      "E:\\Secrets\\qa-release.keystore",
      "-alias",
      "qa",
    ]);
    expect(JSON.stringify(calls)).not.toContain("password");
  });

  it("rejects a keytool fingerprint that does not match the profile", async () => {
    await expect(
      validateSigningProfile(
        {
          id: "qa-release",
          displayName: "QA release",
          keystorePath: "E:\\Secrets\\qa-release.keystore",
          alias: "qa",
          certificateSha256: "a".repeat(64),
          credentialTarget: "UnityMultiDeviceTestCenter/Signing/qa-release",
          storage: "memory",
        },
        async () => ({ exitCode: 0, stdout: `SHA256: ${"BB:".repeat(31)}BB`, stderr: "" }),
      ),
    ).rejects.toThrow(/certificate fingerprint/i);
  });

  it("creates operation-scoped password files and removes them through cleanup", async () => {
    let aclPath: string | undefined;
    const files = await createSecretFiles(
      "E:\\Projects\\TestCenter\\data\\temp",
      "op-1",
      {
        storePassword: "store-secret",
        keyPassword: "key-secret",
      },
      {
        restrictDirectory: async (path) => {
          aclPath = path;
        },
      },
    );

    expect(files.storePasswordPath).toMatch(/data\\temp\\secrets\\op-1\\store-password\.txt$/i);
    expect(files.keyPasswordPath).toMatch(/data\\temp\\secrets\\op-1\\key-password\.txt$/i);
    expect(files.args).toEqual([
      `file:${files.storePasswordPath}`,
      `file:${files.keyPasswordPath}`,
    ]);
    expect(aclPath).toBe(files.storePasswordPath.replace(/\\[^\\]+$/, ""));
    await files.cleanup();
    expect(files.exists()).toBe(false);
  });
});
