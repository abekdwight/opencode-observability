import {
  DASHBOARD_MAX_CUSTOM_DAYS,
  DASHBOARD_PRESETS,
  DASHBOARD_VIEWS,
  type DashboardPresetContract,
  type DashboardSelectionBoundsContract,
  type DashboardSelectionContract,
  type DashboardViewContract,
} from "../contracts/dashboard.js";

export interface DashboardTimeWindow {
  startDayInclusive: string;
  endDayExclusive: string;
}

export interface DashboardSelectionInput {
  preset?: string | null;
  start?: string | null;
  end?: string | null;
  view?: string | null;
}

export type DashboardSelectionNormalizationResult =
  | {
      ok: true;
      selection: DashboardSelectionContract;
      window: DashboardTimeWindow;
    }
  | {
      ok: false;
      message: string;
    };

const DEFAULT_PRESET: Exclude<DashboardPresetContract, "custom"> = "last7d";
const DEFAULT_VIEW: DashboardViewContract = "daily";

export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveDashboardTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function parseLocalDate(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }

  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(year, month - 1, date);
  parsed.setHours(0, 0, 0, 0);

  return toLocalDateString(parsed) === day ? parsed : null;
}

export function addLocalDays(day: string, delta: number): string {
  const parsed = parseLocalDate(day);
  if (!parsed) {
    return day;
  }

  parsed.setDate(parsed.getDate() + delta);
  return toLocalDateString(parsed);
}

export function countInclusiveDays(
  startDayInclusive: string,
  endDayInclusive: string,
): number {
  const start = parseLocalDate(startDayInclusive);
  const end = parseLocalDate(endDayInclusive);
  if (!start || !end || start.getTime() > end.getTime()) {
    return 0;
  }

  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function buildDashboardSelectionBounds(
  window: DashboardTimeWindow,
): DashboardSelectionBoundsContract {
  const endDayInclusive = addLocalDays(window.endDayExclusive, -1);
  const maxStartDayInclusive = addLocalDays(
    endDayInclusive,
    -(DASHBOARD_MAX_CUSTOM_DAYS - 1),
  );
  const startDayInclusive =
    window.startDayInclusive < maxStartDayInclusive
      ? maxStartDayInclusive
      : window.startDayInclusive;

  return {
    startDayInclusive,
    endDayInclusive,
    endDayExclusive: window.endDayExclusive,
    dayCount: countInclusiveDays(startDayInclusive, endDayInclusive),
  };
}

export function computeDashboardRefreshEligibility(
  endDayInclusive: string,
  now = new Date(),
): boolean {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return endDayInclusive === toLocalDateString(today);
}

function isDashboardPreset(
  value: string | null | undefined,
): value is DashboardPresetContract {
  return (
    typeof value === "string" &&
    (DASHBOARD_PRESETS as readonly string[]).includes(value)
  );
}

function isDashboardView(
  value: string | null | undefined,
): value is DashboardViewContract {
  return (
    typeof value === "string" &&
    (DASHBOARD_VIEWS as readonly string[]).includes(value)
  );
}

function buildPresetWindow(
  preset: Exclude<DashboardPresetContract, "custom">,
  now = new Date(),
): DashboardTimeWindow {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const endDayInclusive = toLocalDateString(today);
  const startDayInclusive =
    preset === "today"
      ? endDayInclusive
      : preset === "last7d"
        ? addLocalDays(endDayInclusive, -6)
        : addLocalDays(endDayInclusive, -29);

  return {
    startDayInclusive,
    endDayExclusive: addLocalDays(endDayInclusive, 1),
  };
}

function buildSelection(
  preset: DashboardPresetContract,
  view: DashboardViewContract,
  window: DashboardTimeWindow,
  now = new Date(),
): DashboardSelectionContract {
  const bounds = buildDashboardSelectionBounds(window);
  return {
    preset,
    start: bounds.startDayInclusive,
    end: bounds.endDayInclusive,
    view,
    timezone: resolveDashboardTimezone(),
    refreshable: computeDashboardRefreshEligibility(
      bounds.endDayInclusive,
      now,
    ),
    bounds,
  };
}

export function deriveDashboardRangeFromSelection(
  selection: Pick<DashboardSelectionContract, "preset" | "bounds">,
): "day" | "week" | "month" | "all" {
  if (selection.preset === "today") {
    return "day";
  }
  if (selection.preset === "last7d") {
    return "week";
  }
  if (selection.preset === "last30d") {
    return "month";
  }
  if (selection.bounds.dayCount <= 1) {
    return "day";
  }
  if (selection.bounds.dayCount <= 7) {
    return "week";
  }
  if (selection.bounds.dayCount <= 30) {
    return "month";
  }
  return "all";
}

export function normalizeDashboardSelectionInput(
  input: DashboardSelectionInput,
  now = new Date(),
): DashboardSelectionNormalizationResult {
  const view = isDashboardView(input.view) ? input.view : DEFAULT_VIEW;
  const preset = isDashboardPreset(input.preset)
    ? input.preset
    : DEFAULT_PRESET;

  if (preset !== "custom") {
    const window = buildPresetWindow(preset, now);
    return {
      ok: true,
      selection: buildSelection(preset, view, window, now),
      window,
    };
  }

  const start = input.start ?? "";
  const end = input.end ?? "";
  if (!parseLocalDate(start) || !parseLocalDate(end)) {
    return {
      ok: false,
      message: "Custom range requires valid start and end dates.",
    };
  }

  const dayCount = countInclusiveDays(start, end);
  if (dayCount < 1) {
    return {
      ok: false,
      message: "Custom range start date must be on or before the end date.",
    };
  }

  if (dayCount > DASHBOARD_MAX_CUSTOM_DAYS) {
    return {
      ok: false,
      message: `Custom ranges are limited to ${DASHBOARD_MAX_CUSTOM_DAYS} days.`,
    };
  }

  const window = {
    startDayInclusive: start,
    endDayExclusive: addLocalDays(end, 1),
  };

  return {
    ok: true,
    selection: buildSelection("custom", view, window, now),
    window,
  };
}
