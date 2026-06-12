import { describe, expect, test } from "vitest";
import {
  applyDashboardDraftSelection,
  buildDashboardApiUrls,
  cancelDashboardDraftSelection,
  computeDashboardRefreshEligibility,
  createDashboardRequestVersionTracker,
  createDashboardSelectionController,
  normalizeDashboardSelection,
  serializeAppliedDashboardSelection,
  setDashboardDraftDates,
  setDashboardDraftPreset,
  setDashboardDraftView,
} from "../../web/lib/dashboard-selection.js";

describe("dashboard selection controller", () => {
  const now = new Date("2024-01-11T11:06:00.000Z");

  test("deserializes default URL params into the bounded latest-week selection", () => {
    const selection = normalizeDashboardSelection(new URLSearchParams(), now);

    expect(selection).toMatchObject({
      preset: "last7d",
      start: "2024-01-05",
      end: "2024-01-11",
      view: "daily",
      refreshable: true,
      bounds: {
        startDayInclusive: "2024-01-05",
        endDayInclusive: "2024-01-11",
        endDayExclusive: "2024-01-12",
        dayCount: 7,
      },
    });
  });

  test("serializes only the applied state back to the URL", () => {
    const controller = createDashboardSelectionController(
      new URLSearchParams(),
      now,
    );
    const draftChanged = setDashboardDraftDates(controller, {
      start: "2024-01-01",
      end: "2024-01-03",
    });

    expect(
      serializeAppliedDashboardSelection(
        draftChanged.appliedSelection,
      ).toString(),
    ).toBe("preset=last7d&view=daily");

    const applied = applyDashboardDraftSelection(draftChanged, now);
    expect(
      serializeAppliedDashboardSelection(applied.appliedSelection).toString(),
    ).toBe("preset=custom&view=daily&start=2024-01-01&end=2024-01-03");
  });

  test("keeps draft edits separate until apply and can cancel them", () => {
    const controller = createDashboardSelectionController(
      new URLSearchParams(),
      now,
    );
    const drafted = setDashboardDraftDates(controller, {
      start: "2024-01-02",
      end: "2024-01-04",
    });

    expect(drafted.appliedSelection.preset).toBe("last7d");
    expect(drafted.draftSelection).toMatchObject({
      preset: "custom",
      start: "2024-01-02",
      end: "2024-01-04",
    });
    expect(drafted.apiUrls.overview).toBe(
      "/api/dashboard/overview?preset=last7d&start=2024-01-05&end=2024-01-11&view=daily",
    );

    const cancelled = cancelDashboardDraftSelection(drafted);
    expect(cancelled.draftSelection).toMatchObject({
      preset: "last7d",
      start: "2024-01-05",
      end: "2024-01-11",
      view: "daily",
    });
  });

  test("builds per-endpoint API URLs from normalized bounded params", () => {
    const params = new URLSearchParams(
      "preset=custom&start=2024-01-01&end=2024-01-03&view=hourly",
    );
    const controller = createDashboardSelectionController(params, now);
    const roundTrip = serializeAppliedDashboardSelection(
      controller.appliedSelection,
    ).toString();

    expect(roundTrip).toBe(
      "preset=custom&view=hourly&start=2024-01-01&end=2024-01-03",
    );
    expect(buildDashboardApiUrls(controller.appliedSelection)).toEqual({
      overview:
        "/api/dashboard/overview?preset=custom&start=2024-01-01&end=2024-01-03&view=hourly",
      activity:
        "/api/dashboard/activity?preset=custom&start=2024-01-01&end=2024-01-03&view=hourly",
      models:
        "/api/dashboard/models?preset=custom&start=2024-01-01&end=2024-01-03&view=hourly",
      tools:
        "/api/dashboard/tools?preset=custom&start=2024-01-01&end=2024-01-03&view=hourly",
    });
  });

  test("computes refresh eligibility from normalized selections", () => {
    expect(computeDashboardRefreshEligibility("2024-01-11", now)).toBe(true);
    expect(computeDashboardRefreshEligibility("2024-01-10", now)).toBe(false);

    const historical = normalizeDashboardSelection(
      new URLSearchParams(
        "preset=custom&start=2024-01-01&end=2024-01-03&view=daily",
      ),
      now,
    );
    expect(historical.refreshable).toBe(false);
  });

  test("applies preset and view changes through the controller", () => {
    const controller = createDashboardSelectionController(
      new URLSearchParams(),
      now,
    );
    const changed = applyDashboardDraftSelection(
      setDashboardDraftView(
        setDashboardDraftPreset(controller, "today", now),
        "hourly",
      ),
      now,
    );

    expect(changed.appliedSelection).toMatchObject({
      preset: "today",
      start: "2024-01-11",
      end: "2024-01-11",
      view: "hourly",
    });
    expect(changed.apiUrls.models).toBe(
      "/api/dashboard/models?preset=today&start=2024-01-11&end=2024-01-11&view=hourly",
    );
  });

  test("protects against stale responses with request versions", () => {
    const tracker = createDashboardRequestVersionTracker();
    const first = tracker.start();
    const second = tracker.start();

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
    expect(tracker.current()).toBe(2);
  });
});
