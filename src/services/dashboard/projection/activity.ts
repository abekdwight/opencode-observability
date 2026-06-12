import type {
  DashboardActivityDataContract,
  DashboardLineSeriesContract,
  DashboardRepoBreakdownContract,
  DashboardRepoRowContract,
  DashboardSelectionContract,
  DashboardStackBarContract,
  DashboardSubagentTrendContract,
  DashboardTokenTrendContract,
} from "../../../contracts/dashboard.js";
import { computeRatio } from "../../../lib/analytics.js";
import { formatDurationShort } from "../../../lib/text-format.js";
import type { DashboardSessionAtom } from "../aggregator/types.js";
import {
  buildDailyPoints,
  buildSelectedDays,
  isDayWithinSelection,
  SERIES_COLORS,
  selectAtomsForWindow,
  selectedDayContributions,
  TOKEN_INPUT_COLOR,
  TOKEN_OUTPUT_COLOR,
  topNLabels,
} from "./shared.js";

function emptyHourTotals(): number[] {
  return new Array(24).fill(0);
}

function buildTokenTrend(
  atoms: DashboardSessionAtom[],
  selection: DashboardSelectionContract,
): DashboardTokenTrendContract {
  const inputByDay = new Map<string, number>();
  const outputByDay = new Map<string, number>();
  const inputByHour = emptyHourTotals();
  const outputByHour = emptyHourTotals();
  let totalInput = 0;
  let totalOutput = 0;

  for (const day of selectedDayContributions(atoms, selection.bounds)) {
    inputByDay.set(
      day.day,
      (inputByDay.get(day.day) ?? 0) + day.tokenTotals.input,
    );
    outputByDay.set(
      day.day,
      (outputByDay.get(day.day) ?? 0) + day.tokenTotals.output,
    );
    totalInput += day.tokenTotals.input;
    totalOutput += day.tokenTotals.output;
    for (const [hour, value] of day.tokenInputByHour) {
      inputByHour[Number(hour)] += value;
    }
    for (const [hour, value] of day.tokenOutputByHour) {
      outputByHour[Number(hour)] += value;
    }
  }

  const inputRatioPercent =
    computeRatio(totalInput, totalInput + totalOutput) * 100;

  if (selection.view === "hourly") {
    const hourlyBars: DashboardStackBarContract[] = Array.from(
      { length: 24 },
      (_, hour) => ({
        label: String(hour).padStart(2, "0"),
        stacks: [
          { name: "Input", value: inputByHour[hour], color: TOKEN_INPUT_COLOR },
          {
            name: "Output",
            value: outputByHour[hour],
            color: TOKEN_OUTPUT_COLOR,
          },
        ],
      }),
    );
    return { inputRatioPercent, dailySeries: [], hourlyBars };
  }

  const dailySeries: DashboardLineSeriesContract[] = [
    {
      label: "Input",
      color: TOKEN_INPUT_COLOR,
      points: buildDailyPoints(inputByDay, selection.bounds),
    },
    {
      label: "Output",
      color: TOKEN_OUTPUT_COLOR,
      points: buildDailyPoints(outputByDay, selection.bounds),
    },
  ];

  return { inputRatioPercent, dailySeries, hourlyBars: [] };
}

function buildSubagentTrend(
  atoms: DashboardSessionAtom[],
  selection: DashboardSelectionContract,
): DashboardSubagentTrendContract {
  const agentTotals = new Map<string, number>();
  for (const day of selectedDayContributions(atoms, selection.bounds)) {
    for (const [agent, count] of day.agentCounts) {
      agentTotals.set(agent, (agentTotals.get(agent) ?? 0) + count);
    }
  }

  const topAgents = topNLabels(agentTotals, 5);
  const topAgentSet = new Set(topAgents);

  if (selection.view === "hourly") {
    const seriesOrder = [...topAgents, "Other"];
    const hourBuckets = new Map<string, number[]>(
      seriesOrder.map((agent) => [agent, emptyHourTotals()]),
    );
    for (const day of selectedDayContributions(atoms, selection.bounds)) {
      for (const [agentHour, count] of day.subagentByHour) {
        const [agent, hour] = agentHour.split("\t");
        const seriesKey = topAgentSet.has(agent) ? agent : "Other";
        const bucket = hourBuckets.get(seriesKey);
        if (bucket) bucket[Number(hour)] += count;
      }
    }

    const hourlyBars: DashboardStackBarContract[] = Array.from(
      { length: 24 },
      (_, hour) => ({
        label: String(hour).padStart(2, "0"),
        stacks: seriesOrder
          .map((agent) => ({ agent, bucket: hourBuckets.get(agent) }))
          .filter((entry): entry is { agent: string; bucket: number[] } =>
            Boolean(entry.bucket?.some((value) => value > 0)),
          )
          .map((entry, index) => ({
            name: entry.agent,
            value: entry.bucket[hour] ?? 0,
            color: SERIES_COLORS[index] ?? "#86868b",
          })),
      }),
    );

    return { dailySeries: [], hourlyBars };
  }

  const agentDayMaps = new Map<string, Map<string, number>>(
    [...topAgents, "Other"].map((agent) => [agent, new Map<string, number>()]),
  );
  for (const day of selectedDayContributions(atoms, selection.bounds)) {
    for (const [agent, count] of day.agentCounts) {
      const seriesKey = topAgentSet.has(agent) ? agent : "Other";
      const dayMap = agentDayMaps.get(seriesKey);
      if (dayMap) dayMap.set(day.day, (dayMap.get(day.day) ?? 0) + count);
    }
  }

  const seriesOrder = [
    ...topAgents,
    ...(agentDayMaps.get("Other")?.size ? ["Other"] : []),
  ];

  const dailySeries: DashboardLineSeriesContract[] = seriesOrder.map(
    (agent, index) => ({
      label: agent,
      color: SERIES_COLORS[index] ?? "#86868b",
      points: buildDailyPoints(
        agentDayMaps.get(agent) ?? new Map(),
        selection.bounds,
      ),
    }),
  );

  return { dailySeries, hourlyBars: [] };
}

function buildActiveRepos(
  atoms: DashboardSessionAtom[],
  selection: DashboardSelectionContract,
): DashboardRepoBreakdownContract {
  // Aggregate repo-session counts and active durations per (repo, day) over the
  // in-window contributions. repoKey is constant per atom; the per-day fields
  // live on each day contribution.
  const repoTotals = new Map<string, number>(); // repo -> total session count
  const repoDaySessionCount = new Map<string, number>(); // "repo\tday" -> count
  const repoDayDurationMs = new Map<string, number>(); // "repo\tday" -> ms

  for (const atom of atoms) {
    const repo = atom.repoKey;
    for (const contribution of atom.days.values()) {
      if (!isDayWithinSelection(contribution.day, selection.bounds)) {
        continue;
      }
      if (contribution.repoSessionCount > 0) {
        repoTotals.set(
          repo,
          (repoTotals.get(repo) ?? 0) + contribution.repoSessionCount,
        );
        const sessionKey = `${repo}\t${contribution.day}`;
        repoDaySessionCount.set(
          sessionKey,
          (repoDaySessionCount.get(sessionKey) ?? 0) +
            contribution.repoSessionCount,
        );
      }
      if (contribution.repoActiveDurationMs > 0) {
        const durationKey = `${repo}\t${contribution.day}`;
        repoDayDurationMs.set(
          durationKey,
          (repoDayDurationMs.get(durationKey) ?? 0) +
            contribution.repoActiveDurationMs,
        );
      }
    }
  }

  const dayHeaders = buildSelectedDays(selection.bounds);

  // Top 10 repos by total session count, excluding the empty-key bucket.
  const activeRepos = Array.from(repoTotals.entries())
    .filter(([repo]) => repo !== "")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([repo]) => repo);

  if (activeRepos.length === 0) {
    return { dayHeaders, rows: [] };
  }

  const rows: DashboardRepoRowContract[] = activeRepos.map((repo) => {
    let totalActiveMs = 0;
    const dayCells = dayHeaders.map((day) => {
      const key = `${repo}\t${day}`;
      const dur = repoDayDurationMs.get(key) ?? 0;
      const sessionCount = repoDaySessionCount.get(key) ?? 0;
      if (dur > 0) totalActiveMs += dur;
      // Cell label prefers active duration; falls back to a session count
      // ("Ns") and finally an em dash when the repo was idle that day.
      const label =
        dur > 0
          ? formatDurationShort(dur)
          : sessionCount > 0
            ? `${sessionCount}s`
            : "—";
      return { day, label, muted: false };
    });

    const totalSessions = repoTotals.get(repo) ?? 0;
    const totalLabel =
      totalActiveMs > 0
        ? formatDurationShort(totalActiveMs)
        : totalSessions > 0
          ? `${totalSessions}s`
          : "—";

    return { repo, dayCells, totalLabel };
  });

  return { dayHeaders, rows };
}

export function projectActivity(
  atoms: Iterable<DashboardSessionAtom>,
  selection: DashboardSelectionContract,
): DashboardActivityDataContract {
  const selectedAtoms = selectAtomsForWindow(atoms, selection.bounds);
  return {
    tokenTrend: buildTokenTrend(selectedAtoms, selection),
    subagentTrend: buildSubagentTrend(selectedAtoms, selection),
    activeRepos: buildActiveRepos(selectedAtoms, selection),
  };
}
