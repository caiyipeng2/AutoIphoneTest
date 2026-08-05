import { z } from "zod";

const ADB_SERIAL_PATTERN = /^[\x21-\x7e]+$/;

export const DeviceSerialSchema = z
  .string()
  .trim()
  .min(1, "Device serial is required.")
  .regex(ADB_SERIAL_PATTERN, "Device serial must contain printable non-whitespace characters.");

export type DeviceSerial = z.infer<typeof DeviceSerialSchema> & {
  readonly __brand: "DeviceSerial";
};

export function parseDeviceSerial(value: string): DeviceSerial {
  return DeviceSerialSchema.parse(value) as DeviceSerial;
}
