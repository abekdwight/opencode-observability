import type { DashboardPresetId } from "../../../lib/dashboard-selection";

export const PRESET_OPTIONS: {
  value: DashboardPresetId;
  label: string;
  helper: string;
}[] = [
  { value: "last30d", label: "1 Month", helper: "Last 30 days" },
  { value: "last7d", label: "1 Week", helper: "Last 7 days" },
  { value: "today", label: "1 Day", helper: "Today" },
  { value: "custom", label: "Custom Range", helper: "Select specific dates" },
];

export const REFRESH_INTERVAL = 30_000;

export const MODEL_PIE_COLORS = [
  "#0b57d0",
  "#2e7d32",
  "#8e24aa",
  "#ef6c00",
  "#c62828",
  "#00838f",
  "#5d4037",
  "#5e35b1",
  "#1e88e5",
  "#7cb342",
  "#f4511e",
  "#546e7a",
] as const;
