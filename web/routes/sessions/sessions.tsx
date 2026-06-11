import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  type HarnessSessionsContract,
  type HarnessSessionsSort,
  isHarnessId,
} from "../../../src/contracts/harness.js";
import { HarnessIcon } from "../../components/harness-icon";
import { Badge } from "../../components/ui/badge";
import { useJson } from "../../hooks/use-json";
import { cn } from "../../lib/cn";
import {
  formatDirectory,
  formatTimestampShort,
  formatTokens,
} from "../../lib/format";
import { sessionPath } from "../../lib/harness";
import { DirectoryCombobox } from "./_components/directory-combobox";

const SORT_LABELS: Record<HarnessSessionsSort, string> = {
  updated: "更新順",
  created: "作成順",
  tokens: "トークン順",
  messages: "メッセージ順",
};

const SOURCE_REASON_LABELS: Record<string, string> = {
  "missing-database": "データベースが見つかりません",
  "missing-directory": "ディレクトリが見つかりません",
  error: "読み込みに失敗しました",
};

const inputClasses = cn(
  "h-8 rounded-md border border-[var(--color-border-default)]",
  "bg-[var(--color-bg-surface)] px-3 text-[0.82em]",
  "text-[var(--color-text-primary)]",
  "focus:outline-none focus:border-[var(--color-accent)]",
);

export function Sessions(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const harness = ((value) => (value && isHarnessId(value) ? value : null))(
    searchParams.get("h"),
  );
  const directory = searchParams.get("dir") ?? "";
  const q = searchParams.get("q") ?? "";
  const sort = (searchParams.get("sort") ?? "updated") as HarnessSessionsSort;

  // Debounced search input
  const [qInput, setQInput] = React.useState(q);
  React.useEffect(() => {
    setQInput(q);
  }, [q]);

  const updateParams = React.useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  React.useEffect(() => {
    if (qInput === q) return;
    const timer = setTimeout(() => updateParams({ q: qInput || null }), 300);
    return () => clearTimeout(timer);
  }, [qInput, q, updateParams]);

  const apiUrl = React.useMemo(() => {
    const params = new URLSearchParams();
    if (harness) params.set("harness", harness);
    if (directory) params.set("directory", directory);
    if (q) params.set("q", q);
    if (sort !== "updated") params.set("sort", sort);
    const qs = params.toString();
    return `/api/sessions${qs ? `?${qs}` : ""}`;
  }, [harness, directory, q, sort]);

  // Filter changes revalidate the same view: keep the previous payload so
  // the controls and list never collapse into a loading state mid-filter.
  const { data, error, loading } = useJson<HarnessSessionsContract>(apiUrl, {
    keepPreviousData: true,
  });

  const totalCount = React.useMemo(
    () =>
      data?.harnesses.reduce((sum, entry) => sum + entry.sessionCount, 0) ?? 0,
    [data],
  );

  const unavailable =
    data?.harnesses.filter((entry) => !entry.source.available) ?? [];

  // Keep the selection visible when the current harness scope has no
  // sessions in it (0 here, not absent).
  const directoryOptions = React.useMemo(() => {
    const facets = data?.directories ?? [];
    if (directory && !facets.some((facet) => facet.directory === directory)) {
      return [...facets, { directory, count: 0 }];
    }
    return facets;
  }, [data, directory]);

  return (
    <section className="grid gap-3" data-testid="sessions-page">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-[var(--color-bg-elevated)] rounded-lg p-[3px] gap-0.5">
          <HarnessChip
            label="すべて"
            count={data ? totalCount : null}
            active={harness === null}
            onClick={() => updateParams({ h: null })}
          />
          {(data?.harnesses ?? []).map((entry) => (
            <HarnessChip
              key={entry.descriptor.id}
              label={entry.descriptor.label}
              count={entry.source.available ? entry.sessionCount : null}
              active={harness === entry.descriptor.id}
              onClick={() => updateParams({ h: entry.descriptor.id })}
            />
          ))}
        </div>

        <input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="タイトルで絞り込み"
          className={cn(inputClasses, "flex-1 min-w-[160px] max-w-[320px]")}
          data-testid="sessions-filter-input"
        />

        <DirectoryCombobox
          options={directoryOptions}
          selected={directory}
          onSelect={(dir) => updateParams({ dir })}
          className={cn(inputClasses, "max-w-[280px]")}
        />

        <select
          value={sort}
          onChange={(e) => updateParams({ sort: e.target.value })}
          className={inputClasses}
          data-testid="sessions-sort-select"
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Source availability */}
      {unavailable.length > 0 ? (
        <p className="m-0 text-[0.78em] text-[var(--color-text-tertiary)]">
          {unavailable
            .map(
              (entry) =>
                `${entry.descriptor.label}: ${SOURCE_REASON_LABELS[entry.source.reason] ?? entry.source.reason}`,
            )
            .join(" / ")}
        </p>
      ) : null}

      {/* List — while revalidating, the previous result stays visible,
          dimmed as the in-flight cue (no layout shift). */}
      {error ? (
        <p
          className="m-0 rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] px-4 py-3 text-sm text-[var(--color-error)]"
          data-testid="route-error"
        >
          Sessions API unavailable: {error}
        </p>
      ) : !data ? (
        <p
          className="m-0 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]"
          data-testid="route-loading"
        >
          Loading sessions...
        </p>
      ) : data.sessions.length === 0 ? (
        <p
          className={cn(
            "m-0 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-4 py-3 text-sm text-[var(--color-text-secondary)]",
            "transition-opacity duration-200",
            loading && "opacity-50",
          )}
        >
          セッションがありません
        </p>
      ) : (
        <div
          className={cn(
            "rounded-xl border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] divide-y divide-[var(--color-border-faint)] overflow-hidden",
            "transition-opacity duration-200",
            loading && "opacity-50",
          )}
        >
          {data.sessions.map((session) => (
            <Link
              key={`${session.harness}-${session.id}`}
              to={sessionPath(session.harness, session.id)}
              className="flex gap-2.5 px-4 py-2.5 no-underline hover:bg-[var(--color-bg-elevated)] hover:no-underline transition-colors duration-100"
              data-testid="session-row"
            >
              <HarnessIcon harness={session.harness} className="mt-[1px]" />
              <span className="min-w-0 flex-1">
                {/* Line 1: title … updated-at */}
                <span className="flex items-baseline gap-3">
                  <span className="truncate flex-1 text-[0.85em] font-medium text-[var(--color-text-primary)]">
                    {session.title}
                  </span>
                  <span className="shrink-0 text-[0.72em] tabular-nums text-[var(--color-text-tertiary)]">
                    {formatTimestampShort(session.updatedAt)}
                  </span>
                </span>
                {/* Line 2: meta chips + directory */}
                <span className="mt-1 flex min-w-0 items-center gap-1.5">
                  {session.messageCount !== null ? (
                    <Badge className="shrink-0 px-1.5 py-px text-[0.68em] font-normal tabular-nums">
                      {session.messageCount} msgs
                    </Badge>
                  ) : null}
                  {session.totalTokens !== null ? (
                    <Badge className="shrink-0 px-1.5 py-px text-[0.68em] font-normal tabular-nums">
                      {formatTokens(session.totalTokens)} tok
                    </Badge>
                  ) : null}
                  <span
                    className="truncate text-[0.7em] font-[var(--font-mono)] text-[var(--color-text-tertiary)]"
                    title={session.directory}
                  >
                    {formatDirectory(session.directory)}
                  </span>
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function HarnessChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number | null;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-[0.78em] font-medium whitespace-nowrap transition-all duration-150 cursor-pointer border-none",
        active
          ? "bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-sm"
          : "bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
      )}
    >
      {label}
      {count !== null ? (
        <span className="ml-1.5 text-[0.85em] text-[var(--color-text-tertiary)] tabular-nums">
          {count}
        </span>
      ) : null}
    </button>
  );
}
