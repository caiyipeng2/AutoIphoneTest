import type { LucideIcon } from "lucide-react";
import {
  AppWindow,
  Boxes,
  ClipboardCheck,
  FileCheck2,
  LayoutDashboard,
  Settings2,
  Smartphone,
} from "lucide-react";

export const NAV_ITEMS: Array<{ key: string; label: string; icon: LucideIcon }> = [
  { key: "overview", label: "总览", icon: LayoutDashboard },
  { key: "devices", label: "设备", icon: Smartphone },
  { key: "apps", label: "应用", icon: AppWindow },
  { key: "deployments", label: "构建", icon: Boxes },
  { key: "sessions", label: "会话", icon: ClipboardCheck },
  { key: "results", label: "报告", icon: FileCheck2 },
  { key: "settings", label: "设置", icon: Settings2 },
];

export function readRoute(hash = window.location.hash): string {
  const route = hash.replace(/^#\/?/, "");
  return NAV_ITEMS.some((item) => item.key === route) ? route : "overview";
}
