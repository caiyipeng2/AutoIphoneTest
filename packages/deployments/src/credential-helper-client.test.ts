import { describe, expect, it } from "vitest";

import {
  CredentialHelperClient,
  credentialTarget,
  type CredentialProcess,
} from "./credential-helper-client.js";

describe("credential helper client", () => {
  it("allows only the signing target namespace", () => {
    expect(credentialTarget("qa-release")).toBe("UnityMultiDeviceTestCenter/Signing/qa-release");
    expect(() => credentialTarget("../outside")).toThrow(/target/i);
    expect(() => credentialTarget("UnityMultiDeviceTestCenter/Signing/nested")).toThrow(/target/i);
  });

  it("uses fixed commands and never includes the secret in the process spec", async () => {
    const calls: CredentialProcess[] = [];
    const client = new CredentialHelperClient({
      executablePath: "C:\\Tools\\TestCenter.CredentialHelper.exe",
      run: async (process) => {
        calls.push(process);
        return { exitCode: 0, stdout: "secret-from-helper\n", stderr: "" };
      },
    });

    await client.put("qa-release", "super-secret");
    await expect(client.get("qa-release")).resolves.toBe("secret-from-helper\n");
    await client.delete("qa-release");

    expect(calls.map((call) => call.args)).toEqual([
      ["put", "UnityMultiDeviceTestCenter/Signing/qa-release"],
      ["get", "UnityMultiDeviceTestCenter/Signing/qa-release"],
      ["delete", "UnityMultiDeviceTestCenter/Signing/qa-release"],
    ]);
    expect(JSON.stringify(calls)).not.toContain("super-secret");
  });
});
