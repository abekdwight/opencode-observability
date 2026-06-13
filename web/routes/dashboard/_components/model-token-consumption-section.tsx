import React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { DashboardModelTokenConsumptionRowContract } from "../../../../src/contracts/dashboard";
import { cn } from "../../../lib/cn";
import { MODEL_PIE_COLORS } from "../_lib/constants";
import { toModelProviderLabel } from "../_lib/formatters";

export function ModelTokenConsumptionSection({
  rows,
}: {
  rows: DashboardModelTokenConsumptionRowContract[];
}) {
  const [includeCache, setIncludeCache] = React.useState(true);

  const displayRows = React.useMemo(() => rows.slice(0, 10), [rows]);

  const pieRows = React.useMemo(
    () =>
      displayRows.map((row, index) => {
        const cacheInputTokens = row.cacheReadTokens + row.cacheWriteTokens;
        return {
          key: `${row.model}-${row.provider}`,
          name: toModelProviderLabel(row.model, row.provider),
          color: MODEL_PIE_COLORS[index % MODEL_PIE_COLORS.length],
          nonCacheInput: Math.max(0, row.nonCacheInputTokens),
          cacheInput: Math.max(0, cacheInputTokens),
          inputWithCache: Math.max(0, row.inputTotalTokens),
          output: Math.max(0, row.outputTokens),
        };
      }),
    [displayRows],
  );

  const inputSolidData = React.useMemo(
    () =>
      pieRows
        .map((row) => ({
          name: row.name,
          value: row.nonCacheInput,
          color: row.color,
        }))
        .filter((row) => row.value > 0),
    [pieRows],
  );

  const inputDashedData = React.useMemo(
    () =>
      pieRows
        .map((row) => ({
          name: row.name,
          value: row.cacheInput,
          color: row.color,
        }))
        .filter((row) => row.value > 0),
    [pieRows],
  );

  const inputSingleData = React.useMemo(
    () =>
      pieRows
        .map((row) => ({
          name: row.name,
          value: includeCache ? row.inputWithCache : row.nonCacheInput,
          color: row.color,
        }))
        .filter((row) => row.value > 0),
    [includeCache, pieRows],
  );

  const outputData = React.useMemo(
    () =>
      pieRows
        .map((row) => ({
          name: row.name,
          value: row.output,
          color: row.color,
        }))
        .filter((row) => row.value > 0),
    [pieRows],
  );

  const inputTotal = React.useMemo(
    () => inputSingleData.reduce((sum, row) => sum + row.value, 0),
    [inputSingleData],
  );
  const outputTotal = React.useMemo(
    () => outputData.reduce((sum, row) => sum + row.value, 0),
    [outputData],
  );

  const showData = inputSingleData.length > 0 || outputData.length > 0;

  return (
    <section className="rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[var(--color-text-primary)]">
            Model Token Consumption
          </h2>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Input / Output を円グラフで比較。Input は cache 表示の ON/OFF
            を切替可能。
          </p>
        </div>
        <div
          className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-bg-elevated)] p-0.5"
          role="tablist"
          aria-label="Input cache mode"
        >
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              includeCache
                ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
            onClick={() => setIncludeCache(true)}
            aria-pressed={includeCache}
          >
            Cache ON
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              !includeCache
                ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            )}
            onClick={() => setIncludeCache(false)}
            aria-pressed={!includeCache}
          >
            Cache OFF
          </button>
        </div>
      </div>

      {showData ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Input tokens pie */}
          <article className="rounded-lg border border-[var(--color-border-subtle)] p-3">
            <header className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Input tokens
              </h3>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {inputTotal.toLocaleString()} total
              </span>
            </header>
            <div>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Tooltip
                    formatter={(value) =>
                      `${Math.round(Number(value) || 0).toLocaleString()} tokens`
                    }
                  />
                  {includeCache ? (
                    <>
                      <Pie
                        data={inputSolidData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={42}
                        outerRadius={78}
                        stroke="#ffffff"
                        strokeWidth={1.2}
                      >
                        {inputSolidData.map((entry) => (
                          <Cell
                            key={`input-solid-${entry.name}`}
                            fill={entry.color}
                          />
                        ))}
                      </Pie>
                      <Pie
                        data={inputDashedData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={82}
                        outerRadius={106}
                        stroke="#2b2b2f"
                        strokeWidth={1.2}
                        strokeDasharray="4 3"
                      >
                        {inputDashedData.map((entry) => (
                          <Cell
                            key={`input-cache-${entry.name}`}
                            fill={entry.color}
                            fillOpacity={0.35}
                          />
                        ))}
                      </Pie>
                    </>
                  ) : (
                    <Pie
                      data={inputSingleData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={46}
                      outerRadius={106}
                      stroke="#ffffff"
                      strokeWidth={1.2}
                    >
                      {inputSingleData.map((entry) => (
                        <Cell key={`input-${entry.name}`} fill={entry.color} />
                      ))}
                    </Pie>
                  )}
                </PieChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-center text-xs text-[var(--color-text-tertiary)]">
              {includeCache
                ? "内側=non-cache(実線), 外側=cache(点線リング)"
                : "cache を除外した Input 内訳"}
            </p>
          </article>

          {/* Output tokens pie */}
          <article className="rounded-lg border border-[var(--color-border-subtle)] p-3">
            <header className="mb-2 flex items-baseline justify-between">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                Output tokens
              </h3>
              <span className="text-xs text-[var(--color-text-secondary)]">
                {outputTotal.toLocaleString()} total
              </span>
            </header>
            <div>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Tooltip
                    formatter={(value) =>
                      `${Math.round(Number(value) || 0).toLocaleString()} tokens`
                    }
                  />
                  <Pie
                    data={outputData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={46}
                    outerRadius={106}
                    stroke="#ffffff"
                    strokeWidth={1.2}
                  >
                    {outputData.map((entry) => (
                      <Cell key={`output-${entry.name}`} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-center text-xs text-[var(--color-text-tertiary)]">
              モデル別 Output 構成
            </p>
          </article>
        </div>
      ) : (
        <p className="text-sm text-[var(--color-text-tertiary)]">No data</p>
      )}

      {displayRows.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 md:grid-cols-4">
          {pieRows.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-1.5 overflow-hidden"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ background: row.color }}
              />
              <span
                className="truncate text-xs text-[var(--color-text-secondary)]"
                title={row.name}
              >
                {row.name}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
