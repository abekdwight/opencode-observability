import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type Database from "better-sqlite3";
import {
  DASHBOARD_PRESETS,
  DASHBOARD_VIEWS,
  type DashboardPresetContract,
  type DashboardSelectionContract,
  type DashboardViewContract,
} from "../src/contracts/dashboard.js";
import {
  deriveDashboardRangeFromSelection,
  normalizeDashboardSelectionInput,
} from "../src/lib/dashboard-time.js";
import { getWritableDb } from "../src/lib/db.js";
import { readDashboardCacheStamp } from "../src/repositories/dashboard/dashboard-repository.js";
import {
  getDashboardApiCacheSnapshotForTests,
  invalidateDashboardApiCache,
  readDashboardSnapshot,
} from "../src/server/dashboard-api.js";

const DEFAULT_ITERATIONS = 30;
const DEFAULT_TIMEOUT_MS = 300_000;
const ALLOWED_FLAGS = new Set([
  "--db",
  "--preset",
  "--start",
  "--end",
  "--view",
  "--iterations",
  "--timeoutMs",
  "--output",
]);

interface CliOptions {
  dbPath: string;
  preset: DashboardPresetContract;
  start?: string;
  end?: string;
  view: DashboardViewContract;
  iterations: number;
  timeoutMs: number;
  outputPath: string;
}

interface BenchmarkResult {
  measuredAt: string;
  dbPath: string;
  selection: DashboardSelectionContract;
  iterations: number;
  timeoutMs: number;
  coldReadMs: number;
  warmMedianMs: number;
  warmP95Ms: number;
  changedReadMs: number;
  unchangedGenerationStable: boolean;
  notes: string[];
}

interface TimedReadResult {
  durationMs: number;
  snapshotSignature: string;
  generation: number;
}

function parseIntegerFlag(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!ALLOWED_FLAGS.has(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (values.has(arg)) {
      throw new Error(`Duplicate argument: ${arg}`);
    }

    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${arg}`);
    }

    values.set(arg, value);
    index += 1;
  }

  const dbPath = values.get("--db");
  const presetValue = values.get("--preset");
  const viewValue = values.get("--view");
  const outputPath = values.get("--output");

  if (!dbPath || !presetValue || !viewValue || !outputPath) {
    throw new Error("--db, --preset, --view, and --output are required.");
  }

  if (!(DASHBOARD_PRESETS as readonly string[]).includes(presetValue)) {
    throw new Error(`Invalid --preset value: ${presetValue}`);
  }

  if (!(DASHBOARD_VIEWS as readonly string[]).includes(viewValue)) {
    throw new Error(`Invalid --view value: ${viewValue}`);
  }

  const preset = presetValue as DashboardPresetContract;
  const view = viewValue as DashboardViewContract;
  const start = values.get("--start");
  const end = values.get("--end");
  const iterations = parseIntegerFlag(
    values.get("--iterations") ?? `${DEFAULT_ITERATIONS}`,
    "--iterations",
  );
  const timeoutMs = parseIntegerFlag(
    values.get("--timeoutMs") ?? `${DEFAULT_TIMEOUT_MS}`,
    "--timeoutMs",
  );

  if (timeoutMs < DEFAULT_TIMEOUT_MS) {
    throw new Error(
      `--timeoutMs must be at least ${DEFAULT_TIMEOUT_MS} milliseconds.`,
    );
  }

  if (preset === "custom") {
    if (!start || !end) {
      throw new Error("Custom presets require both --start and --end.");
    }
  } else if (start || end) {
    throw new Error(
      "--start and --end may only be provided when --preset custom is used.",
    );
  }

  return {
    dbPath: path.resolve(dbPath),
    preset,
    start,
    end,
    view,
    iterations,
    timeoutMs,
    outputPath: path.resolve(outputPath),
  };
}

function ensureFileExists(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`DB not found: ${filePath}`);
  }
}

function copySqliteArtifact(sourcePath: string, targetPath: string) {
  fs.copyFileSync(sourcePath, targetPath);
  for (const suffix of ["-wal", "-shm"]) {
    const sourceSidecar = `${sourcePath}${suffix}`;
    if (fs.existsSync(sourceSidecar)) {
      fs.copyFileSync(sourceSidecar, `${targetPath}${suffix}`);
    }
  }
}

function assertWithinTimeout(startedAtMs: number, timeoutMs: number, step: string) {
  if (Date.now() - startedAtMs > timeoutMs) {
    throw new Error(`Benchmark timed out after ${timeoutMs}ms during ${step}.`);
  }
}

function captureSnapshotSignature(): { generation: number; signature: string } {
  const snapshot = getDashboardApiCacheSnapshotForTests();
  return {
    generation: snapshot.generation,
    signature: JSON.stringify({
      generation: snapshot.generation,
      timezone: snapshot.timezone,
      semanticsVersion: snapshot.semanticsVersion,
      sessionKeys: [...snapshot.sessionKeys],
      dayKeys: [...snapshot.dayKeys],
      rawKeys: [...snapshot.rawKeys],
      viewKeys: [...snapshot.viewKeys],
      stamp: snapshot.stamp ? { ...snapshot.stamp } : null,
    }),
  };
}

function measureRead(
  db: Database.Database,
  request: Parameters<typeof readDashboardSnapshot>[1],
  now: Date,
): TimedReadResult {
  const startedAt = performance.now();
  readDashboardSnapshot(db, request, now);
  const finishedAt = performance.now();
  const snapshot = captureSnapshotSignature();
  return {
    durationMs: finishedAt - startedAt,
    generation: snapshot.generation,
    snapshotSignature: snapshot.signature,
  };
}

function calculateMedian(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  }
  return sorted[midpoint] ?? 0;
}

function calculateP95(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

function roundMs(value: number): number {
  return Number(value.toFixed(3));
}

function selectSessionIdForMutation(
  db: Database.Database,
  selection: DashboardSelectionContract,
): { sessionId: string; changedDay: string } {
  const row = db
    .prepare(
      `
        SELECT id, date(time_created/1000, 'unixepoch', 'localtime') AS day
        FROM session
        WHERE date(time_created/1000, 'unixepoch', 'localtime') >= ?
          AND date(time_created/1000, 'unixepoch', 'localtime') <= ?
        ORDER BY time_updated DESC, rowid DESC
        LIMIT 1
      `,
    )
    .get(
      selection.bounds.startDayInclusive,
      selection.bounds.endDayInclusive,
    ) as
    | {
        id: string;
        day: string | null;
      }
    | undefined;

  if (!row?.id || !row.day) {
    throw new Error(
      `No session rows found between ${selection.bounds.startDayInclusive} and ${selection.bounds.endDayInclusive}.`,
    );
  }

  return {
    sessionId: row.id,
    changedDay: row.day,
  };
}

function mutateSelectionSession(
  db: Database.Database,
  selection: DashboardSelectionContract,
): { sessionId: string; changedDay: string } {
  const target = selectSessionIdForMutation(db, selection);
  const stamp = readDashboardCacheStamp(db);
  const nextTimeUpdated = stamp.maxSessionUpdatedAt + 1;
  db.prepare("UPDATE session SET time_updated = ? WHERE id = ?").run(
    nextTimeUpdated,
    target.sessionId,
  );
  return target;
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  ensureFileExists(cli.dbPath);

  const runStartedAtMs = Date.now();
  const benchmarkNow = new Date();
  const normalized = normalizeDashboardSelectionInput(
    {
      preset: cli.preset,
      start: cli.start,
      end: cli.end,
      view: cli.view,
    },
    benchmarkNow,
  );

  if (!normalized.ok) {
    throw new Error(normalized.message);
  }

  const selection = normalized.selection;
  const request = {
    range: deriveDashboardRangeFromSelection(selection),
    view: selection.view,
    window: normalized.window,
    selection,
  };

  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "dashboard-aggregation-benchmark-"),
  );
  const tempDbPath = path.join(tempRoot, path.basename(cli.dbPath));
  copySqliteArtifact(cli.dbPath, tempDbPath);

  const previousDbPath = process.env.OPENCODE_DB_PATH;
  process.env.OPENCODE_DB_PATH = tempDbPath;

  let db: Database.Database | null = null;

  try {
    db = getWritableDb();
    db.pragma("foreign_keys = ON");

    invalidateDashboardApiCache();
    assertWithinTimeout(runStartedAtMs, cli.timeoutMs, "cold read setup");
    const coldRead = measureRead(db, request, benchmarkNow);

    const warmDurations: number[] = [];
    let unchangedGenerationStable = true;
    for (let iteration = 0; iteration < cli.iterations; iteration += 1) {
      assertWithinTimeout(runStartedAtMs, cli.timeoutMs, `warm read ${iteration + 1}`);
      const warmRead = measureRead(db, request, benchmarkNow);
      warmDurations.push(warmRead.durationMs);
      unchangedGenerationStable =
        unchangedGenerationStable &&
        warmRead.generation === coldRead.generation &&
        warmRead.snapshotSignature === coldRead.snapshotSignature;
    }

    assertWithinTimeout(runStartedAtMs, cli.timeoutMs, "changed read mutation");
    const mutation = mutateSelectionSession(db, selection);

    assertWithinTimeout(runStartedAtMs, cli.timeoutMs, "changed read");
    const changedRead = measureRead(db, request, benchmarkNow);

    const result: BenchmarkResult = {
      measuredAt: benchmarkNow.toISOString(),
      dbPath: cli.dbPath,
      selection,
      iterations: cli.iterations,
      timeoutMs: cli.timeoutMs,
      coldReadMs: roundMs(coldRead.durationMs),
      warmMedianMs: roundMs(calculateMedian(warmDurations)),
      warmP95Ms: roundMs(calculateP95(warmDurations)),
      changedReadMs: roundMs(changedRead.durationMs),
      unchangedGenerationStable,
      notes: [
        "Benchmark runs against a temporary writable copy so the source DB is never modified.",
        `Warm reads reuse the same normalized selection (${selection.start}..${selection.end}, ${selection.view}) and verify cache stability via getDashboardApiCacheSnapshotForTests().`,
        `Changed read updates session ${mutation.sessionId} on ${mutation.changedDay} to exercise root-session-aware change detection and store reconcile.`,
      ],
    };

    fs.mkdirSync(path.dirname(cli.outputPath), { recursive: true });
    fs.writeFileSync(cli.outputPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (db) {
      db.close();
    }
    invalidateDashboardApiCache();
    if (previousDbPath) {
      process.env.OPENCODE_DB_PATH = previousDbPath;
    } else {
      delete process.env.OPENCODE_DB_PATH;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
