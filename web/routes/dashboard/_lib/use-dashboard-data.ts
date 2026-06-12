import React from "react";
import type {
  DashboardActivityContract,
  DashboardModelsContract,
  DashboardOverviewContract,
  DashboardToolsContract,
} from "../../../../src/contracts/dashboard";
import type { DashboardApiUrls } from "../../../lib/dashboard-selection";
import { createDashboardRequestVersionTracker } from "../../../lib/dashboard-selection";
import { REFRESH_INTERVAL } from "./constants";

export interface EndpointState<T> {
  data: T | null;
  error: string | null;
  /** True only on the very first fetch attempt before any response arrives */
  initialLoading: boolean;
}

export interface DashboardData {
  overview: EndpointState<DashboardOverviewContract>;
  activity: EndpointState<DashboardActivityContract>;
  models: EndpointState<DashboardModelsContract>;
  tools: EndpointState<DashboardToolsContract>;
}

type SetEndpoint<T> = (
  updater: (prev: EndpointState<T>) => EndpointState<T>,
) => void;

function initialEndpointState<T>(): EndpointState<T> {
  return { data: null, error: null, initialLoading: true };
}

async function fetchEndpoint<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(body?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function makeFetcher<T>(
  url: string,
  tracker: ReturnType<typeof createDashboardRequestVersionTracker>,
  set: SetEndpoint<T>,
) {
  return async function load(signal: AbortSignal) {
    const version = tracker.start();
    try {
      const data = await fetchEndpoint<T>(url, signal);
      if (tracker.isCurrent(version)) {
        set((prev) => ({ ...prev, data, error: null, initialLoading: false }));
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (tracker.isCurrent(version)) {
        const msg = err instanceof Error ? err.message : String(err);
        set((prev) => ({ ...prev, error: msg, initialLoading: false }));
      }
    }
  };
}

export function useDashboardData(
  apiUrls: DashboardApiUrls,
  refreshable: boolean,
): DashboardData {
  const [overview, setOverview] =
    React.useState<EndpointState<DashboardOverviewContract>>(
      initialEndpointState,
    );
  const [activity, setActivity] =
    React.useState<EndpointState<DashboardActivityContract>>(
      initialEndpointState,
    );
  const [models, setModels] =
    React.useState<EndpointState<DashboardModelsContract>>(
      initialEndpointState,
    );
  const [tools, setTools] =
    React.useState<EndpointState<DashboardToolsContract>>(initialEndpointState);

  // Independent per-endpoint version trackers to discard stale responses
  const overviewTrackerRef = React.useRef(
    createDashboardRequestVersionTracker(),
  );
  const activityTrackerRef = React.useRef(
    createDashboardRequestVersionTracker(),
  );
  const modelsTrackerRef = React.useRef(createDashboardRequestVersionTracker());
  const toolsTrackerRef = React.useRef(createDashboardRequestVersionTracker());

  // Track the last generation seen from overview so we can trigger heavy refetches
  const lastGenerationRef = React.useRef<number | null>(null);

  // --- Overview: fetches on URL change and on REFRESH_INTERVAL when refreshable ---
  React.useEffect(() => {
    setOverview(initialEndpointState);
    lastGenerationRef.current = null;

    const ac = new AbortController();
    const load = makeFetcher<DashboardOverviewContract>(
      apiUrls.overview,
      overviewTrackerRef.current,
      setOverview,
    );

    load(ac.signal);

    const timer = refreshable
      ? setInterval(() => load(ac.signal), REFRESH_INTERVAL)
      : null;

    return () => {
      ac.abort();
      if (timer) clearInterval(timer);
    };
  }, [apiUrls.overview, refreshable]);

  // --- Heavy endpoints: fetch on URL change ---
  React.useEffect(() => {
    setActivity(initialEndpointState);
    const ac = new AbortController();
    makeFetcher<DashboardActivityContract>(
      apiUrls.activity,
      activityTrackerRef.current,
      setActivity,
    )(ac.signal);
    return () => ac.abort();
  }, [apiUrls.activity]);

  React.useEffect(() => {
    setModels(initialEndpointState);
    const ac = new AbortController();
    makeFetcher<DashboardModelsContract>(
      apiUrls.models,
      modelsTrackerRef.current,
      setModels,
    )(ac.signal);
    return () => ac.abort();
  }, [apiUrls.models]);

  React.useEffect(() => {
    setTools(initialEndpointState);
    const ac = new AbortController();
    makeFetcher<DashboardToolsContract>(
      apiUrls.tools,
      toolsTrackerRef.current,
      setTools,
    )(ac.signal);
    return () => ac.abort();
  }, [apiUrls.tools]);

  // --- Generation watch: re-fetch heavy endpoints when overview.meta.generation changes ---
  React.useEffect(() => {
    const generation = overview.data?.meta?.generation ?? null;
    if (generation === null) return;
    if (lastGenerationRef.current === null) {
      // First arrival: record but don't re-fetch (initial fetches already in flight)
      lastGenerationRef.current = generation;
      return;
    }
    if (generation === lastGenerationRef.current) return;

    // Generation changed: re-fetch heavy endpoints
    lastGenerationRef.current = generation;

    const ac = new AbortController();
    makeFetcher<DashboardActivityContract>(
      apiUrls.activity,
      activityTrackerRef.current,
      setActivity,
    )(ac.signal);
    makeFetcher<DashboardModelsContract>(
      apiUrls.models,
      modelsTrackerRef.current,
      setModels,
    )(ac.signal);
    makeFetcher<DashboardToolsContract>(
      apiUrls.tools,
      toolsTrackerRef.current,
      setTools,
    )(ac.signal);

    return () => ac.abort();
  }, [
    overview.data?.meta?.generation,
    apiUrls.activity,
    apiUrls.models,
    apiUrls.tools,
  ]);

  return { overview, activity, models, tools };
}
