import { z } from "zod";

export const DeploymentStateSchema = z.enum([
  "QUEUED",
  "PRECHECK",
  "PREPARE",
  "INSTALL",
  "VERIFY",
  "LAUNCH",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
export type DeploymentState = z.infer<typeof DeploymentStateSchema>;

export const DeploymentStepKindSchema = z.enum([
  "PRECHECK",
  "PREPARE",
  "INSTALL",
  "VERIFY",
  "LAUNCH",
]);
export type DeploymentStepKind = z.infer<typeof DeploymentStepKindSchema>;

export const DataMutationKindSchema = z.enum(["CLEAR_DATA", "UNINSTALL_REINSTALL"]);
export type DataMutationKind = z.infer<typeof DataMutationKindSchema>;

export const MutationStatusSchema = z.enum(["PENDING", "SUCCEEDED", "FAILED"]);
export type MutationStatus = z.infer<typeof MutationStatusSchema>;
