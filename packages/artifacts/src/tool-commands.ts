import { win32 } from "node:path";

export type ArtifactToolCommand =
  | { readonly kind: "aapt2Badging"; readonly executablePath: string; readonly apkPath: string }
  | { readonly kind: "apksignerCerts"; readonly executablePath: string; readonly apkPath: string }
  | {
      readonly kind: "bundletoolManifest";
      readonly javaPath: string;
      readonly bundletoolPath: string;
      readonly bundlePath: string;
    }
  | {
      readonly kind: "jarsignerVerify";
      readonly executablePath: string;
      readonly bundlePath: string;
    };

export interface RenderedArtifactToolCommand {
  readonly executablePath: string;
  readonly args: readonly string[];
}

export function renderArtifactToolCommand(
  command: ArtifactToolCommand,
): RenderedArtifactToolCommand {
  switch (command.kind) {
    case "aapt2Badging":
      return {
        executablePath: requireAbsolute(command.executablePath),
        args: ["dump", "badging", requireAbsolute(command.apkPath)],
      };
    case "apksignerCerts":
      return {
        executablePath: requireAbsolute(command.executablePath),
        args: ["verify", "--print-certs", requireAbsolute(command.apkPath)],
      };
    case "bundletoolManifest":
      return {
        executablePath: requireAbsolute(command.javaPath),
        args: [
          "-jar",
          requireAbsolute(command.bundletoolPath),
          "dump",
          "manifest",
          "--bundle",
          requireAbsolute(command.bundlePath),
        ],
      };
    case "jarsignerVerify":
      return {
        executablePath: requireAbsolute(command.executablePath),
        args: ["-verify", "-certs", requireAbsolute(command.bundlePath)],
      };
  }
}

function requireAbsolute(value: string): string {
  if (!win32.isAbsolute(value))
    throw new TypeError("Artifact tool paths must be absolute Windows paths.");
  return win32.normalize(value);
}
