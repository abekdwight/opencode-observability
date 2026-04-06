import React from "react";
import { FILTER_CYCLE, type FilterMode } from "../_lib/constants";

// ---------------------------------------------------------------------------
// localStorage preference helpers
// ---------------------------------------------------------------------------
function readPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota etc. */
  }
}

// ---------------------------------------------------------------------------
// useSessionPreferences — view preferences persisted in localStorage
// ---------------------------------------------------------------------------
export interface UseSessionPreferencesOptions {
  getAnchor: () => { el: HTMLElement; offset: number } | null;
  restoreAnchor: (anchor: { el: HTMLElement; offset: number } | null) => void;
  recheckOverflows: () => void;
}

export interface SessionPreferences {
  collapseEnabled: boolean;
  filterMode: FilterMode;
  plainMode: boolean;
  toolsVisible: boolean;
  sidebarOpen: boolean;
  omoFilter: boolean;
}

export interface SessionPreferenceActions {
  toggleCollapse: () => void;
  cycleFilter: () => void;
  togglePlain: () => void;
  toggleTools: () => void;
  toggleSidebar: () => void;
  toggleOmoFilter: () => void;
}

export function useSessionPreferences(
  options: UseSessionPreferencesOptions,
): [SessionPreferences, SessionPreferenceActions] {
  const { getAnchor, restoreAnchor, recheckOverflows } = options;

  // Keep a ref to recheckOverflows so toggle callbacks always call the latest
  // version (recheckOverflows depends on plainMode/collapseEnabled owned by
  // this hook, so it changes after state updates).
  const recheckOverflowsRef = React.useRef(recheckOverflows);
  React.useEffect(() => {
    recheckOverflowsRef.current = recheckOverflows;
  }, [recheckOverflows]);

  // --- View preferences (persisted in localStorage) ---
  const [collapseEnabled, setCollapseEnabled] = React.useState(
    () => readPref("ot-collapse", "true") !== "false",
  );
  const [filterMode, setFilterMode] = React.useState<FilterMode>(
    () => (readPref("ot-filter", "all") as FilterMode) || "all",
  );
  const [plainMode, setPlainMode] = React.useState(
    () => readPref("ot-plain", "false") === "true",
  );
  const [toolsVisible, setToolsVisible] = React.useState(
    () => readPref("ot-tools", "true") !== "false",
  );
  const [sidebarOpen, setSidebarOpen] = React.useState(
    () => readPref("ot-sidebar", "true") !== "false",
  );
  const [omoFilter, setOmoFilter] = React.useState(
    () => readPref("ot-omo", "true") !== "false",
  );

  // --- Persist preferences ---
  React.useEffect(() => {
    writePref("ot-collapse", String(collapseEnabled));
  }, [collapseEnabled]);
  React.useEffect(() => {
    writePref("ot-filter", filterMode);
  }, [filterMode]);
  React.useEffect(() => {
    writePref("ot-plain", String(plainMode));
  }, [plainMode]);
  React.useEffect(() => {
    writePref("ot-tools", String(toolsVisible));
  }, [toolsVisible]);
  React.useEffect(() => {
    writePref("ot-sidebar", String(sidebarOpen));
  }, [sidebarOpen]);
  React.useEffect(() => {
    writePref("ot-omo", String(omoFilter));
  }, [omoFilter]);

  // --- Control actions ---
  const togglePlain = React.useCallback(() => {
    const anchor = getAnchor();
    setPlainMode((prev) => !prev);
    requestAnimationFrame(() => {
      recheckOverflowsRef.current();
      restoreAnchor(anchor);
    });
  }, [getAnchor, restoreAnchor]);

  const toggleCollapse = React.useCallback(() => {
    const anchor = getAnchor();
    setCollapseEnabled((prev) => !prev);
    requestAnimationFrame(() => {
      recheckOverflowsRef.current();
      restoreAnchor(anchor);
    });
  }, [getAnchor, restoreAnchor]);

  const cycleFilter = React.useCallback(() => {
    setFilterMode((prev) => {
      const idx = FILTER_CYCLE.indexOf(prev);
      return FILTER_CYCLE[(idx + 1) % FILTER_CYCLE.length];
    });
  }, []);

  const toggleTools = React.useCallback(() => {
    setToolsVisible((prev) => !prev);
  }, []);

  const toggleSidebar = React.useCallback(() => {
    setSidebarOpen((prev) => !prev);
  }, []);

  const toggleOmoFilter = React.useCallback(() => {
    const anchor = getAnchor();
    setOmoFilter((prev) => !prev);
    requestAnimationFrame(() => {
      recheckOverflowsRef.current();
      restoreAnchor(anchor);
    });
  }, [getAnchor, restoreAnchor]);

  const preferences: SessionPreferences = {
    collapseEnabled,
    filterMode,
    plainMode,
    toolsVisible,
    sidebarOpen,
    omoFilter,
  };

  const actions: SessionPreferenceActions = {
    toggleCollapse,
    cycleFilter,
    togglePlain,
    toggleTools,
    toggleSidebar,
    toggleOmoFilter,
  };

  return [preferences, actions];
}
