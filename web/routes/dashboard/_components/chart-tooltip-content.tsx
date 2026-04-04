import { CHART_THEME } from "../../../lib/chart-theme";

export function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: CHART_THEME.tooltip.backgroundColor,
        color: CHART_THEME.tooltip.textColor,
        borderRadius: CHART_THEME.tooltip.borderRadius,
        padding: `${CHART_THEME.tooltip.padding[0]}px ${CHART_THEME.tooltip.padding[1]}px`,
        fontSize: CHART_THEME.tooltip.fontSize,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((entry) => (
        <div
          key={entry.name}
          style={{ display: "flex", gap: 6, alignItems: "center" }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: entry.color,
              display: "inline-block",
            }}
          />
          <span>
            {entry.name}: {entry.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
