import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useTheme } from "../hooks/use-theme";
import {
  DEFAULT_MERMAID_THEME_MODE,
  getMermaidConfigCacheKey,
  type MermaidRenderPreference,
  type MermaidResolvedTheme,
  type MermaidThemeMode,
} from "../lib/mermaid-config";

interface MermaidPreferencesContextValue {
  mermaidPreference: MermaidRenderPreference;
  mermaidThemeMode: MermaidThemeMode;
  mermaidConfigKey: string;
  toggleMermaidTheme: () => void;
}

const STORAGE_KEY = "ot-mermaid-theme";

const MermaidPreferencesContext = createContext<
  MermaidPreferencesContextValue | undefined
>(undefined);

function readStoredMermaidThemeMode(): MermaidThemeMode {
  if (typeof window === "undefined") {
    return DEFAULT_MERMAID_THEME_MODE;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "auto" || stored === "readable"
      ? stored
      : DEFAULT_MERMAID_THEME_MODE;
  } catch {
    return DEFAULT_MERMAID_THEME_MODE;
  }
}

export function MermaidPreferencesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { resolvedTheme } = useTheme();
  const [mermaidThemeMode, setMermaidThemeMode] = useState<MermaidThemeMode>(
    readStoredMermaidThemeMode,
  );

  const toggleMermaidTheme = useCallback(() => {
    setMermaidThemeMode((prev) => {
      const next = prev === "readable" ? "auto" : "readable";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // localStorage can be unavailable in private mode/quota pressure.
      }
      return next;
    });
  }, []);

  // Mermaid only distinguishes polarity; sepia renders with the light theme.
  const mermaidResolvedTheme: MermaidResolvedTheme =
    resolvedTheme === "dark" ? "dark" : "light";

  const mermaidPreference = useMemo<MermaidRenderPreference>(
    () => ({
      mode: mermaidThemeMode,
      resolvedTheme: mermaidResolvedTheme,
    }),
    [mermaidThemeMode, mermaidResolvedTheme],
  );

  const mermaidConfigKey = useMemo(
    () => getMermaidConfigCacheKey(mermaidPreference),
    [mermaidPreference],
  );

  const value = useMemo<MermaidPreferencesContextValue>(
    () => ({
      mermaidPreference,
      mermaidThemeMode,
      mermaidConfigKey,
      toggleMermaidTheme,
    }),
    [mermaidPreference, mermaidThemeMode, mermaidConfigKey, toggleMermaidTheme],
  );

  return (
    <MermaidPreferencesContext.Provider value={value}>
      {children}
    </MermaidPreferencesContext.Provider>
  );
}

export function useMermaidPreferences(): MermaidPreferencesContextValue {
  const ctx = useContext(MermaidPreferencesContext);
  if (!ctx) {
    throw new Error(
      "useMermaidPreferences must be used within a MermaidPreferencesProvider",
    );
  }
  return ctx;
}
