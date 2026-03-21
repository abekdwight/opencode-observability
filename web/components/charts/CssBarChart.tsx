import React from "react";
import type { DashboardBarItemContract } from "../../../src/contracts/dashboard";

interface Props {
  items: DashboardBarItemContract[];
  barColor: string;
}

export const CssBarChart = React.memo(function CssBarChart({
  items,
  barColor,
}: Props) {
  if (items.length === 0) {
    return <p className="no-data">No data</p>;
  }

  const maxCount = Math.max(...items.map((i) => i.count), 1);

  return (
    <div>
      {items.map(({ label, count }) => {
        const pct = (count / maxCount) * 100;
        return (
          <div className="css-bar-item" key={label}>
            <div className="css-bar-header">
              <span className="css-bar-label">{label}</span>
              <span className="css-bar-count">{count.toLocaleString()}</span>
            </div>
            <div
              className="css-bar-track"
              style={{ background: `${barColor}26` }}
            >
              <div
                className="css-bar-fill"
                style={{
                  width: `${pct.toFixed(1)}%`,
                  background: barColor,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});
