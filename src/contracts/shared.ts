export type SignalLevel = "info" | "success" | "warning" | "error";

export interface SignalBadge {
  key: string;
  label: string;
  level: SignalLevel;
  count: number;
}
