import React from "react";

// ---------------------------------------------------------------------------
// useOpenDetails — tool detail open/close state
// ---------------------------------------------------------------------------
export function useOpenDetails(): {
  openDetails: Set<string>;
  toggle: (id: string) => void;
} {
  const [openDetails, setOpenDetails] = React.useState<Set<string>>(new Set());

  const toggle = React.useCallback((detailId: string) => {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (next.has(detailId)) next.delete(detailId);
      else next.add(detailId);
      return next;
    });
  }, []);

  return { openDetails, toggle };
}
