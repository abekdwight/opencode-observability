import React from "react";

export type LayoutMode = "default" | "ide";

export const LayoutModeContext = React.createContext<{
  mode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
}>({ mode: "default", setMode: () => {} });

export function useLayoutMode() {
  return React.useContext(LayoutModeContext);
}
