import type {
  DashboardBarItemContract,
  DashboardModelPerformanceStatsRowContract,
  DashboardModelsDataContract,
  DashboardModelTokenConsumptionRowContract,
  DashboardSelectionContract,
} from "../../../contracts/dashboard.js";
import type {
  DashboardModelTokenTotals,
  DashboardSessionAtom,
} from "../aggregator/types.js";
import {
  isDayWithinSelection,
  PERCENTILE_P10_MIN_SAMPLES,
  PERCENTILE_P50_MIN_SAMPLES,
  PERCENTILE_P90_MIN_SAMPLES,
  PERCENTILE_P99_MIN_SAMPLES,
  quantileOrNull,
  selectAtomsForWindow,
  selectedDayContributions,
  TPS_AVG_MIN_SAMPLES,
  TPS_P50_MIN_SAMPLES,
} from "./shared.js";

function buildModelUsage(
  atoms: DashboardSessionAtom[],
  selection: DashboardSelectionContract,
): DashboardBarItemContract[] {
  const counts = new Map<string, number>();
  for (const day of selectedDayContributions(atoms, selection.bounds)) {
    for (const [model, count] of day.modelCounts) {
      counts.set(model, (counts.get(model) ?? 0) + count);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([model, count]) => ({ label: model || "(unknown)", count }));
}

function buildModelTokenConsumption(
  atoms: DashboardSessionAtom[],
  selection: DashboardSelectionContract,
): DashboardModelTokenConsumptionRowContract[] {
  const merged = new Map<string, DashboardModelTokenTotals>();
  for (const day of selectedDayContributions(atoms, selection.bounds)) {
    for (const [key, totals] of day.modelTokenTotals) {
      let entry = merged.get(key);
      if (!entry) {
        entry = {
          model: totals.model,
          provider: totals.provider,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          nonCacheInputTokens: 0,
          inputTotalTokens: 0,
          totalTokens: 0,
        };
        merged.set(key, entry);
      }
      entry.inputTokens += totals.inputTokens;
      entry.outputTokens += totals.outputTokens;
      entry.cacheReadTokens += totals.cacheReadTokens;
      entry.cacheWriteTokens += totals.cacheWriteTokens;
      entry.nonCacheInputTokens += totals.nonCacheInputTokens;
      entry.inputTotalTokens += totals.inputTotalTokens;
      entry.totalTokens += totals.totalTokens;
    }
  }

  return Array.from(merged.values())
    .map((value) => ({
      model: value.model || "(unknown)",
      provider: value.provider || "unknown",
      inputTokens: value.inputTokens,
      outputTokens: value.outputTokens,
      cacheReadTokens: value.cacheReadTokens,
      cacheWriteTokens: value.cacheWriteTokens,
      nonCacheInputTokens: value.nonCacheInputTokens,
      inputTotalTokens: value.inputTotalTokens,
      // Guard against under-reported $.tokens.total by taking the larger of the
      // reported total and the reconstructed input-total + output.
      totalTokens: Math.max(
        value.totalTokens,
        value.inputTotalTokens + value.outputTokens,
      ),
    }))
    .filter((row) => row.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 12);
}

interface PerformanceBucket {
  model: string;
  provider: string;
  totalMessages: number;
  validTpsMessages: number;
  validLatencyMessages: number;
  outputTokens: number;
  reasoningTokens: number;
  sumTpsOutputTokens: number;
  sumTpsDurationMs: number;
  tpsValues: number[];
  latencyValuesMs: number[];
}

function buildModelPerformanceStats(
  atoms: DashboardSessionAtom[],
  selection: DashboardSelectionContract,
): DashboardModelPerformanceStatsRowContract[] {
  // Performance samples are per-root (not per-day); include a root's samples
  // only when at least one of its contributing days is in-window.
  const buckets = new Map<string, PerformanceBucket>();
  for (const atom of atoms) {
    let touchesWindow = false;
    for (const day of atom.days.keys()) {
      if (isDayWithinSelection(day, selection.bounds)) {
        touchesWindow = true;
        break;
      }
    }
    if (!touchesWindow) continue;

    for (const [key, sample] of atom.modelPerformanceSamples) {
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          model: sample.model,
          provider: sample.provider,
          totalMessages: 0,
          validTpsMessages: 0,
          validLatencyMessages: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          sumTpsOutputTokens: 0,
          sumTpsDurationMs: 0,
          tpsValues: [],
          latencyValuesMs: [],
        };
        buckets.set(key, bucket);
      }
      bucket.totalMessages += sample.totalMessages;
      bucket.validTpsMessages += sample.validTpsMessages;
      bucket.validLatencyMessages += sample.validLatencyMessages;
      bucket.outputTokens += sample.outputTokens;
      bucket.reasoningTokens += sample.reasoningTokens;
      bucket.sumTpsOutputTokens += sample.sumOutputTokens;
      bucket.sumTpsDurationMs += sample.sumDurationMs;
      bucket.tpsValues.push(...sample.tpsSamples);
      bucket.latencyValuesMs.push(...sample.latencySamplesMs);
    }
  }

  return Array.from(buckets.values())
    .map((bucket) => {
      const avgTps =
        bucket.validTpsMessages >= TPS_AVG_MIN_SAMPLES &&
        bucket.sumTpsDurationMs > 0
          ? Number(
              (
                (bucket.sumTpsOutputTokens * 1000) /
                bucket.sumTpsDurationMs
              ).toFixed(2),
            )
          : null;

      const validityRatio =
        bucket.totalMessages > 0
          ? Number((bucket.validTpsMessages / bucket.totalMessages).toFixed(4))
          : 0;

      const reasoningShare =
        bucket.outputTokens > 0
          ? Number((bucket.reasoningTokens / bucket.outputTokens).toFixed(4))
          : null;

      return {
        model: bucket.model,
        provider: bucket.provider,
        avgTps,
        // TPS percentiles over the per-turn TPS samples. tpsP50 keeps its
        // existing gate (and remains the primary sort key downstream).
        tpsP10: quantileOrNull(
          bucket.tpsValues,
          0.1,
          PERCENTILE_P10_MIN_SAMPLES,
        ),
        tpsP50: quantileOrNull(bucket.tpsValues, 0.5, TPS_P50_MIN_SAMPLES),
        tpsP90: quantileOrNull(
          bucket.tpsValues,
          0.9,
          PERCENTILE_P90_MIN_SAMPLES,
        ),
        tpsP99: quantileOrNull(
          bucket.tpsValues,
          0.99,
          PERCENTILE_P99_MIN_SAMPLES,
        ),
        // Latency percentiles (ms) over the per-turn completion durations.
        latencyP50Ms: quantileOrNull(
          bucket.latencyValuesMs,
          0.5,
          PERCENTILE_P50_MIN_SAMPLES,
        ),
        latencyP90Ms: quantileOrNull(
          bucket.latencyValuesMs,
          0.9,
          PERCENTILE_P90_MIN_SAMPLES,
        ),
        latencyP99Ms: quantileOrNull(
          bucket.latencyValuesMs,
          0.99,
          PERCENTILE_P99_MIN_SAMPLES,
        ),
        totalMessages: bucket.totalMessages,
        validTpsMessages: bucket.validTpsMessages,
        validLatencyMessages: bucket.validLatencyMessages,
        validityRatio,
        outputTokens: bucket.outputTokens,
        reasoningTokens: bucket.reasoningTokens,
        reasoningShare,
      } satisfies DashboardModelPerformanceStatsRowContract;
    })
    .filter((row) => row.validTpsMessages > 0)
    .sort((a, b) => {
      const hasPrimaryA = a.tpsP50 != null ? 1 : 0;
      const hasPrimaryB = b.tpsP50 != null ? 1 : 0;
      if (hasPrimaryA !== hasPrimaryB) return hasPrimaryB - hasPrimaryA;

      const scoreA = a.tpsP50 ?? a.avgTps ?? -1;
      const scoreB = b.tpsP50 ?? b.avgTps ?? -1;
      if (scoreA !== scoreB) return scoreB - scoreA;

      if (a.validityRatio !== b.validityRatio) {
        return b.validityRatio - a.validityRatio;
      }
      if (a.validTpsMessages !== b.validTpsMessages) {
        return b.validTpsMessages - a.validTpsMessages;
      }
      return a.model.localeCompare(b.model);
    });
}

export function projectModels(
  atoms: Iterable<DashboardSessionAtom>,
  selection: DashboardSelectionContract,
): DashboardModelsDataContract {
  const selectedAtoms = selectAtomsForWindow(atoms, selection.bounds);
  return {
    modelUsage: buildModelUsage(selectedAtoms, selection),
    modelTokenConsumption: buildModelTokenConsumption(selectedAtoms, selection),
    modelPerformanceStats: buildModelPerformanceStats(selectedAtoms, selection),
  };
}
