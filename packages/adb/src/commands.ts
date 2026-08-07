import { parseAndroidPackageName } from "@test-center/contracts/artifact";
import { DeviceSerialSchema, type DeviceSerial } from "@test-center/contracts/device";
import { win32 } from "node:path";

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

export type AdbDeploymentCommand =
  | { readonly kind: "installApk"; readonly serial: DeviceSerial; readonly apkPath: string }
  | {
      readonly kind: "clearPackageData";
      readonly serial: DeviceSerial;
      readonly packageName: string;
    }
  | {
      readonly kind: "uninstallPackage";
      readonly serial: DeviceSerial;
      readonly packageName: string;
    }
  | {
      readonly kind: "startActivity";
      readonly serial: DeviceSerial;
      readonly packageName: string;
      readonly activityName: string;
    }
  | { readonly kind: "forceStop"; readonly serial: DeviceSerial; readonly packageName: string }
  | { readonly kind: "foregroundActivity"; readonly serial: DeviceSerial }
  | { readonly kind: "packagePid"; readonly serial: DeviceSerial; readonly packageName: string };

export type AdbBridgeCommand =
  | {
      readonly kind: "forwardAdd";
      readonly serial: DeviceSerial;
      readonly hostPort: number;
      readonly devicePort: number;
    }
  | { readonly kind: "forwardList"; readonly serial: DeviceSerial }
  | { readonly kind: "forwardRemove"; readonly serial: DeviceSerial; readonly hostPort: number };

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

export type AdbCommand =
  | AdbDiscoveryCommand
  | AdbDeviceCommand
  | AdbPackageCommand
  | AdbDeploymentCommand
  | AdbBridgeCommand;

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
    case "installApk":
      return ["-s", serial, "install", "-r", "-t", validateApkPath(command.apkPath)];
    case "clearPackageData":
      return ["-s", serial, "shell", "pm", "clear", parseAndroidPackageName(command.packageName)];
    case "uninstallPackage":
      return ["-s", serial, "uninstall", parseAndroidPackageName(command.packageName)];
    case "startActivity": {
      const packageName = parseAndroidPackageName(command.packageName);
      return [
        "-s",
        serial,
        "shell",
        "am",
        "start",
        "-n",
        `${packageName}/${validateActivityName(command.activityName)}`,
      ];
    }
    case "forceStop":
      return [
        "-s",
        serial,
        "shell",
        "am",
        "force-stop",
        parseAndroidPackageName(command.packageName),
      ];
    case "foregroundActivity":
      return ["-s", serial, "shell", "dumpsys", "activity", "activities"];
    case "packagePid":
      return ["-s", serial, "shell", "pidof", parseAndroidPackageName(command.packageName)];
    case "forwardAdd":
      return [
        "-s",
        serial,
        "forward",
        `tcp:${validatePort(command.hostPort, "hostPort")}`,
        `tcp:${validatePort(command.devicePort, "devicePort")}`,
      ];
    case "forwardList":
      return ["-s", serial, "forward", "--list"];
    case "forwardRemove":
      return [
        "-s",
        serial,
        "forward",
        "--remove",
        `tcp:${validatePort(command.hostPort, "hostPort")}`,
      ];
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

function validateApkPath(value: string): string {
  if (!win32.isAbsolute(value) || !value.toLowerCase().endsWith(".apk") || value.includes("\0")) {
    throw new TypeError("APK path must be an absolute .apk file path.");
  }
  return win32.normalize(value);
}

function validateActivityName(value: string): string {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value)) {
    throw new TypeError("Invalid Android activity name.");
  }
  return value;
}

function validatePort(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new TypeError(`${name} must be an integer TCP port between 1 and 65535.`);
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
