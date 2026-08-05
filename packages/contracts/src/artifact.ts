import { z } from "zod";

import { DeviceSerialSchema, type DeviceSerial } from "./device.js";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, "SHA-256 must be lowercase hex.");
export const AndroidPackageNameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/, "Invalid Android package name.");

export const ArtifactKindSchema = z.enum(["APK", "AAB", "INSTALLED"]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const SourceArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["APK", "AAB"]),
  sha256: Sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
  storedPath: z.string().min(1),
  originalName: z.string().min(1).max(128),
  packageName: AndroidPackageNameSchema.optional(),
  versionName: z.string().min(1).optional(),
  versionCode: z.number().int().nonnegative().optional(),
  signerSha256: Sha256Schema.optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export const InstalledArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("INSTALLED"),
  deviceSerial: DeviceSerialSchema,
  packageName: AndroidPackageNameSchema,
  versionName: z.string().min(1),
  versionCode: z.number().int().nonnegative(),
  signerSha256: Sha256Schema,
  installedSetSha256: Sha256Schema,
  observedAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
});

export const AppArtifactSchema = z.discriminatedUnion("kind", [
  SourceArtifactSchema,
  InstalledArtifactSchema,
]);

export type SourceArtifact = z.infer<typeof SourceArtifactSchema>;
export type InstalledArtifact = Omit<z.infer<typeof InstalledArtifactSchema>, "deviceSerial"> & {
  readonly deviceSerial: DeviceSerial;
};
export type AppArtifact = SourceArtifact | InstalledArtifact;

export interface ArtifactMetadata {
  readonly packageName?: string;
  readonly versionName?: string;
  readonly versionCode?: number;
  readonly signerSha256?: string;
}

export function parseAndroidPackageName(value: string): string {
  return AndroidPackageNameSchema.parse(value);
}
