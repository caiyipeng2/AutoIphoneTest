import { parseAndroidPackageName } from "@test-center/contracts/artifact";
import { DeviceSerialSchema, type DeviceSerial } from "@test-center/contracts/device";

export const ALLOWLISTED_GETPROP_KEYS = [
  "ro.product.model",
  "ro.product.name",
  "ro.product.device",
  "ro.product.manufacturer",
  "ro.build.version.release",
  "ro.build.version.sdk",
  "ro.product.cpu.abilist",
] as const;

export type GetPropKey = (typeof ALLOWLISTED_GETPROP_KEYS)[number];

export type AdbDiscoveryCommand = { readonly kind: "devices" };

export type AdbDeviceCommand =
  | { readonly kind: "getState"; readonly serial: DeviceSerial }
  | { readonly kind: "getSerialno"; readonly serial: DeviceSerial }
  | { readonly kind: "getProp"; readonly serial: DeviceSerial; readonly key: GetPropKey }
  | { readonly kind: "wmSize"; readonly serial: DeviceSerial }
  | { readonly kind: "wmDensity"; readonly serial: DeviceSerial }
  | { readonly kind: "dumpsysBattery"; readonly serial: DeviceSerial }
  | { readonly kind: "dumpsysDisplay"; readonly serial: DeviceSerial };

export type AdbPackageCommand =
  | { readonly kind: "packagePaths"; readonly serial: DeviceSerial; readonly packageName: string }
  | { readonly kind: "packageDetails"; readonly serial: DeviceSerial; readonly packageName: string }
  | {
      readonly kind: "resolveActivity";
      readonly serial: DeviceSerial;
      readonly packageName: string;
    }
  | {
      readonly kind: "streamPackageFile";
      readonly serial: DeviceSerial;
      readonly packageName: string;
      readonly filePath: string;
    };

export type AdbCommand = AdbDiscoveryCommand | AdbDeviceCommand | AdbPackageCommand;

export function renderAdbCommand(command: AdbCommand): string[] {
  if (command.kind === "devices") {
    return ["devices", "-l"];
  }

  const serial = DeviceSerialSchema.parse(command.serial) as DeviceSerial;
  switch (command.kind) {
    case "getState":
      return ["-s", serial, "get-state"];
    case "getSerialno":
      return ["-s", serial, "get-serialno"];
    case "getProp":
      assertAllowlistedGetProp(command.key);
      return ["-s", serial, "shell", "getprop", command.key];
    case "wmSize":
      return ["-s", serial, "shell", "wm", "size"];
    case "wmDensity":
      return ["-s", serial, "shell", "wm", "density"];
    case "dumpsysBattery":
      return ["-s", serial, "shell", "dumpsys", "battery"];
    case "dumpsysDisplay":
      return ["-s", serial, "shell", "dumpsys", "display"];
    case "packagePaths":
      return ["-s", serial, "shell", "pm", "path", parseAndroidPackageName(command.packageName)];
    case "packageDetails":
      return [
        "-s",
        serial,
        "shell",
        "dumpsys",
        "package",
        parseAndroidPackageName(command.packageName),
      ];
    case "resolveActivity":
      return [
        "-s",
        serial,
        "shell",
        "cmd",
        "package",
        "resolve-activity",
        "--brief",
        parseAndroidPackageName(command.packageName),
      ];
    case "streamPackageFile":
      parseAndroidPackageName(command.packageName);
      return ["-s", serial, "exec-out", "cat", validatePackageFilePath(command.filePath)];
  }
}

function validatePackageFilePath(value: string): string {
  if (
    !value.startsWith("/data/app/") ||
    value.includes("..") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new TypeError("Installed package file must remain below /data/app/.");
  }
  return value;
}

export function commandSerial(command: AdbCommand): DeviceSerial | undefined {
  return command.kind === "devices"
    ? undefined
    : (DeviceSerialSchema.parse(command.serial) as DeviceSerial);
}

export function renderProcessArguments(command: AdbCommand): string[] {
  const rendered = renderAdbCommand(command);
  return command.kind === "devices" ? rendered : rendered.slice(2);
}

function assertAllowlistedGetProp(key: string): asserts key is GetPropKey {
  if (!(ALLOWLISTED_GETPROP_KEYS as readonly string[]).includes(key)) {
    throw new TypeError(`getprop key '${key}' is not allowlisted.`);
  }
}
