import {
  DASHBOARD_MAX_CUSTOM_DAYS,
  DASHBOARD_VIEWS,
  type DashboardSelectionBoundsContract,
  type DashboardViewContract,
} from "../../src/contracts/dashboard.js";

export const DASHBOARD_PRESET_IDS = [
  "today",
  "last7d",
  "last30d",
  "custom",
] as const;

export type DashboardPresetId = (typeof DASHBOARD_PRESET_IDS)[number];

export interface DashboardSelectionDraft {
  preset: DashboardPresetId;
  start: string;
  end: string;
  view: DashboardViewContract;
}

export interface DashboardAppliedSelection extends DashboardSelectionDraft {
  bounds: DashboardSelectionBoundsContract;
  refreshable: boolean;
}

export const DASHBOARD_ENDPOINTS = [
  "overview",
  "activity",
  "models",
  "tools",
] as const;
export type DashboardEndpoint = (typeof DASHBOARD_ENDPOINTS)[number];

export type DashboardApiUrls = Record<DashboardEndpoint, string>;

export interface DashboardSelectionControllerState {
  appliedSelection: DashboardAppliedSelection;
  draftSelection: DashboardSelectionDraft;
  apiUrls: DashboardApiUrls;
  validationError: string | null;
}

type DashboardSelectionInput = URLSearchParams | DashboardSelectionDraft;

interface DashboardSelectionValidationSuccess {
  ok: true;
  selection: DashboardAppliedSelection;
}

interface DashboardSelectionValidationFailure {
  ok: false;
  error: string;
}

type DashboardSelectionValidationResult =
  | DashboardSelectionValidationSuccess
  | DashboardSelectionValidationFailure;

export interface DashboardRequestVersionTracker {
  current(): number;
  start(): number;
  isCurrent(version: number): boolean;
}

const DEFAULT_VIEW: DashboardViewContract = "daily";
const DEFAULT_PRESET: Exclude<DashboardPresetId, "custom"> = "last7d";

function isDashboardPresetId(
  value: string | null | undefined,
): value is DashboardPresetId {
  return (
    typeof value === "string" &&
    (DASHBOARD_PRESET_IDS as readonly string[]).includes(value)
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

function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(year, month - 1, date);
  parsed.setHours(0, 0, 0, 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addLocalDays(day: string, delta: number): string {
  const parsed = parseLocalDate(day);
  if (!parsed) {
    return day;
  }
  parsed.setDate(parsed.getDate() + delta);
  return toLocalDateString(parsed);
}

function countInclusiveDays(start: string, end: string): number {
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) {
    return 0;
  }
  return Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
}

function buildPresetDraft(
  preset: Exclude<DashboardPresetId, "custom">,
  view: DashboardViewContract,
  now = new Date(),
): DashboardSelectionDraft {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const end = toLocalDateString(today);
  const start =
    preset === "today"
      ? end
      : preset === "last7d"
        ? addLocalDays(end, -6)
        : addLocalDays(end, -29);

  return { preset, start, end, view };
}

function toDraftSelection(
  selection: DashboardAppliedSelection,
): DashboardSelectionDraft {
  return {
    preset: selection.preset,
    start: selection.start,
    end: selection.end,
    view: selection.view,
  };
}

function toAppliedSelection(
  draft: DashboardSelectionDraft,
  now = new Date(),
): DashboardAppliedSelection {
  const dayCount = countInclusiveDays(draft.start, draft.end);
  return {
    ...draft,
    bounds: {
      startDayInclusive: draft.start,
      endDayInclusive: draft.end,
      endDayExclusive: addLocalDays(draft.end, 1),
      dayCount,
    },
    refreshable: computeDashboardRefreshEligibility(draft.end, now),
  };
}

function validateCustomDraft(
  draft: DashboardSelectionDraft,
  now = new Date(),
): DashboardSelectionValidationResult {
  const startDate = parseLocalDate(draft.start);
  const endDate = parseLocalDate(draft.end);
  if (!startDate || !endDate) {
    return {
      ok: false,
      error: "Custom range requires valid start and end dates.",
    };
  }

  const dayCount = countInclusiveDays(draft.start, draft.end);
  if (dayCount < 1) {
    return {
      ok: false,
      error: "Custom range start date must be on or before the end date.",
    };
  }

  if (dayCount > DASHBOARD_MAX_CUSTOM_DAYS) {
    return {
      ok: false,
      error: `Custom ranges are limited to ${DASHBOARD_MAX_CUSTOM_DAYS} days.`,
    };
  }

  return { ok: true, selection: toAppliedSelection(draft, now) };
}

export function computeDashboardRefreshEligibility(
  endDayInclusive: string,
  now = new Date(),
): boolean {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return endDayInclusive === toLocalDateString(today);
}

export function normalizeDashboardSelection(
  input: DashboardSelectionInput,
  now = new Date(),
): DashboardAppliedSelection {
  const source =
    input instanceof URLSearchParams
      ? {
          preset: input.get("preset"),
          start: input.get("start"),
          end: input.get("end"),
          view: input.get("view"),
        }
      : input;

  const view = isDashboardView(source.view) ? source.view : DEFAULT_VIEW;
  const preset = isDashboardPresetId(source.preset)
    ? source.preset
    : DEFAULT_PRESET;

  if (preset !== "custom") {
    return toAppliedSelection(
      buildPresetDraft(
        preset as Exclude<DashboardPresetId, "custom">,
        view,
        now,
      ),
      now,
    );
  }

  const customDraft: DashboardSelectionDraft = {
    preset: "custom",
    start: source.start ?? "",
    end: source.end ?? "",
    view,
  };
  const customSelection = validateCustomDraft(customDraft, now);
  return customSelection.ok
    ? customSelection.selection
    : toAppliedSelection(buildPresetDraft(DEFAULT_PRESET, view, now), now);
}

export function serializeAppliedDashboardSelection(
  selection: DashboardAppliedSelection,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("preset", selection.preset);
  params.set("view", selection.view);
  if (selection.preset === "custom") {
    params.set("start", selection.start);
    params.set("end", selection.end);
  }
  return params;
}

function buildDashboardSelectionQuery(
  selection: DashboardAppliedSelection,
): string {
  const params = new URLSearchParams();
  params.set("preset", selection.preset);
  params.set("start", selection.bounds.startDayInclusive);
  params.set("end", selection.bounds.endDayInclusive);
  params.set("view", selection.view);
  return params.toString();
}

// One URL per endpoint. The four dashboard endpoints share the same selection
// query but fetch independently (overview polls; the heavy three re-fetch only
// when overview's generation or the selection changes).
export function buildDashboardApiUrls(
  selection: DashboardAppliedSelection,
): DashboardApiUrls {
  const query = buildDashboardSelectionQuery(selection);
  return {
    overview: `/api/dashboard/overview?${query}`,
    activity: `/api/dashboard/activity?${query}`,
    models: `/api/dashboard/models?${query}`,
    tools: `/api/dashboard/tools?${query}`,
  };
}

export function createDashboardSelectionController(
  input: DashboardSelectionInput,
  now = new Date(),
): DashboardSelectionControllerState {
  const appliedSelection = normalizeDashboardSelection(input, now);
  return {
    appliedSelection,
    draftSelection: toDraftSelection(appliedSelection),
    apiUrls: buildDashboardApiUrls(appliedSelection),
    validationError: null,
  };
}

export function setDashboardDraftPreset(
  controller: DashboardSelectionControllerState,
  preset: DashboardPresetId,
  now = new Date(),
): DashboardSelectionControllerState {
  const draftSelection =
    preset === "custom"
      ? {
          ...controller.draftSelection,
          preset,
        }
      : buildPresetDraft(
          preset as Exclude<DashboardPresetId, "custom">,
          controller.draftSelection.view,
          now,
        );

  return {
    ...controller,
    draftSelection,
    validationError: null,
  };
}

export function setDashboardDraftDates(
  controller: DashboardSelectionControllerState,
  patch: Partial<Pick<DashboardSelectionDraft, "start" | "end">>,
): DashboardSelectionControllerState {
  return {
    ...controller,
    draftSelection: {
      ...controller.draftSelection,
      preset: "custom",
      start: patch.start ?? controller.draftSelection.start,
      end: patch.end ?? controller.draftSelection.end,
    },
    validationError: null,
  };
}

export function setDashboardDraftView(
  controller: DashboardSelectionControllerState,
  view: DashboardViewContract,
): DashboardSelectionControllerState {
  return {
    ...controller,
    draftSelection: {
      ...controller.draftSelection,
      view,
    },
    validationError: null,
  };
}

export function applyDashboardDraftSelection(
  controller: DashboardSelectionControllerState,
  now = new Date(),
): DashboardSelectionControllerState {
  const result: DashboardSelectionValidationResult =
    controller.draftSelection.preset === "custom"
      ? validateCustomDraft(controller.draftSelection, now)
      : {
          ok: true,
          selection: normalizeDashboardSelection(
            controller.draftSelection,
            now,
          ),
        };

  if (!result.ok) {
    return {
      ...controller,
      validationError: result.error,
    };
  }

  return {
    appliedSelection: result.selection,
    draftSelection: toDraftSelection(result.selection),
    apiUrls: buildDashboardApiUrls(result.selection),
    validationError: null,
  };
}

export function cancelDashboardDraftSelection(
  controller: DashboardSelectionControllerState,
): DashboardSelectionControllerState {
  return {
    ...controller,
    draftSelection: toDraftSelection(controller.appliedSelection),
    validationError: null,
  };
}

export function createDashboardRequestVersionTracker(
  initialVersion = 0,
): DashboardRequestVersionTracker {
  let version = initialVersion;
  return {
    current() {
      return version;
    },
    start() {
      version += 1;
      return version;
    },
    isCurrent(candidateVersion: number) {
      return candidateVersion === version;
    },
  };
}
