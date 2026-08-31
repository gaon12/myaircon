import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Direction } from "../shared/protocol.ts";
import {
  HOUR_MS,
  type HourlyEntry,
  type RankEntry,
  type RecentEntry,
  type StatsSnapshot,
} from "../shared/stats.ts";

export type StatsLogger = {
  info?: (details: unknown, message?: string) => void;
  warn?: (details: unknown, message?: string) => void;
};

export type StatsStoreOptions = {
  /** SQLite 파일 경로. ":memory:" 면 디스크를 쓰지 않는다. */
  file: string;
  enabled?: boolean | undefined;
  /** "오늘"의 경계를 정할 IANA 시간대. null이면 서버 로컬. */
  timeZone?: string | null | undefined;
  /** 순위에 유지할 최대 이름 수. 넘으면 상위만 남기고 정리한다. */
  maxNames?: number | undefined;
  /** 최근 기록 링버퍼 크기. */
  recentSize?: number | undefined;
  /** 시간대별 롤업을 몇 시간치 보관할지. */
  retentionHours?: number | undefined;
  /** 메모리 집계를 디스크에 반영하는 주기(ms). */
  flushIntervalMs?: number | undefined;
  logger?: StatsLogger | undefined;
};

type HourBucket = { changes: number; sum: number; min: number; max: number };

const KEEP_NAMES = 500;
const TOP_N = 10;
const RECENT_SHOWN = 50;
const HOURS_SHOWN = 24;

const DEFAULTS = {
  maxNames: 2000,
  recentSize: 500,
  retentionHours: 48,
  flushIntervalMs: 5000,
};

/** 주어진 시간대 기준의 날짜 문자열(YYYY-MM-DD). */
export function dayKey(at: number, timeZone: string | null): string {
  const date = new Date(at);
  if (timeZone === null || timeZone === "") {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  // en-CA 로케일이 YYYY-MM-DD 형식을 준다.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    calendar: "gregory",
  }).format(date);
}

/** Map에서 상위 N개를 횟수 내림차순으로 뽑는다. 동점이면 이름 순. */
function topEntries(counts: Map<string, number>, limit: number): RankEntry[] {
  return [...counts.entries()]
    .map(([username, count]) => ({ username, count }))
    .sort((a, b) => b.count - a.count || a.username.localeCompare(b.username))
    .slice(0, limit);
}

/**
 * 통계 집계.
 *
 * 집계는 전부 메모리에서 한다. 조회가 초당 수천 번 와도 SQL을 돌지 않는다.
 * SQLite는 오직 "재시작해도 역대 순위가 남아야 한다"를 위한 백업이고,
 * 버튼 누를 때마다가 아니라 주기적으로 한 번에 반영한다(배치 커밋).
 *
 * 무한 증가 방지가 중요하다. 닉네임은 인증도 유일성도 없는 자유 문자열이라,
 * 스크립트가 매번 다른 이름으로 보내면 집계 Map이 끝없이 자란다(실측: 100만
 * 항목 58MB). maxNames를 넘으면 상위 KEEP_NAMES개만 남기고 잘라낸다.
 */
export class StatsStore {
  readonly #enabled: boolean;
  readonly #timeZone: string | null;
  readonly #maxNames: number;
  readonly #recentSize: number;
  readonly #retentionHours: number;
  readonly #logger: StatsLogger;

  #db: DatabaseSync | null = null;
  #today = new Map<string, number>();
  #allTime = new Map<string, number>();
  #todayKey: string;
  #hourly = new Map<number, HourBucket>();
  #recent: RecentEntry[] = [];
  #dirty = false;
  #timer: NodeJS.Timeout | null = null;

  constructor(options: StatsStoreOptions) {
    this.#enabled = options.enabled ?? true;
    this.#timeZone = options.timeZone ?? null;
    this.#maxNames = options.maxNames ?? DEFAULTS.maxNames;
    this.#recentSize = options.recentSize ?? DEFAULTS.recentSize;
    this.#retentionHours = options.retentionHours ?? DEFAULTS.retentionHours;
    this.#logger = options.logger ?? {};
    this.#todayKey = dayKey(Date.now(), this.#timeZone);

    if (!this.#enabled) return;

    try {
      if (options.file !== ":memory:") {
        mkdirSync(path.dirname(options.file), { recursive: true });
      }
      this.#db = new DatabaseSync(options.file);
      this.#db.exec("PRAGMA journal_mode = WAL");
      // NORMAL이면 커밋마다 fsync 하지 않는다. 통계는 마지막 몇 초를 잃어도
      // 괜찮은 데이터라 내구성보다 처리량을 택한다.
      this.#db.exec("PRAGMA synchronous = NORMAL");
      this.#db.exec(
        "CREATE TABLE IF NOT EXISTS tally (" +
          "period TEXT NOT NULL, username TEXT NOT NULL, count INTEGER NOT NULL, " +
          "PRIMARY KEY (period, username)) WITHOUT ROWID",
      );
      this.#db.exec(
        "CREATE TABLE IF NOT EXISTS hourly (" +
          "hour INTEGER PRIMARY KEY, changes INTEGER NOT NULL, temp_sum INTEGER NOT NULL, " +
          "temp_min INTEGER NOT NULL, temp_max INTEGER NOT NULL)",
      );
      this.#load();
    } catch (err) {
      // 통계를 쓸 수 없다고 서비스가 죽으면 안 된다.
      this.#logger.warn?.(
        { err, file: options.file },
        "stats store unavailable, running without persistence",
      );
      this.#db = null;
    }

    this.#timer = setInterval(
      () => this.flush(),
      options.flushIntervalMs ?? DEFAULTS.flushIntervalMs,
    );
    this.#timer.unref?.();
  }

  #load(): void {
    const db = this.#db;
    if (db === null) return;

    const tallies = db.prepare("SELECT period, username, count FROM tally").all() as unknown as {
      period: string;
      username: string;
      count: number;
    }[];
    for (const row of tallies) {
      if (row.period === "allTime") this.#allTime.set(row.username, row.count);
      else if (row.period === `day:${this.#todayKey}`) this.#today.set(row.username, row.count);
    }

    const hours = db
      .prepare("SELECT hour, changes, temp_sum, temp_min, temp_max FROM hourly")
      .all() as unknown as {
      hour: number;
      changes: number;
      temp_sum: number;
      temp_min: number;
      temp_max: number;
    }[];
    for (const row of hours) {
      this.#hourly.set(row.hour, {
        changes: row.changes,
        sum: row.temp_sum,
        min: row.temp_min,
        max: row.temp_max,
      });
    }

    this.#logger.info?.(
      { names: this.#allTime.size, hours: this.#hourly.size },
      "loaded persisted statistics",
    );
  }

  /**
   * 온도가 실제로 바뀐 조절 하나를 기록한다.
   *
   * 경계값에서 눌러 값이 그대로인 경우(changed=false)는 세지 않는다.
   * 30도에서 + 를 연타해 순위를 올리는 것을 막기 위해서다.
   */
  record(change: { username: string; direction: Direction; temp: number; at?: number }): void {
    if (!this.#enabled) return;
    const at = change.at ?? Date.now();

    // 날짜가 넘어갔으면 "오늘" 집계를 새로 시작한다.
    const key = dayKey(at, this.#timeZone);
    if (key !== this.#todayKey) {
      this.#todayKey = key;
      this.#today.clear();
    }

    this.#bump(this.#today, change.username);
    this.#bump(this.#allTime, change.username);

    const hour = Math.floor(at / HOUR_MS);
    const bucket = this.#hourly.get(hour);
    if (bucket === undefined) {
      this.#hourly.set(hour, {
        changes: 1,
        sum: change.temp,
        min: change.temp,
        max: change.temp,
      });
    } else {
      bucket.changes += 1;
      bucket.sum += change.temp;
      bucket.min = Math.min(bucket.min, change.temp);
      bucket.max = Math.max(bucket.max, change.temp);
    }

    this.#recent.push({
      at,
      username: change.username,
      direction: change.direction,
      temp: change.temp,
    });
    if (this.#recent.length > this.#recentSize) this.#recent.shift();

    this.#dirty = true;
  }

  #bump(counts: Map<string, number>, username: string): void {
    counts.set(username, (counts.get(username) ?? 0) + 1);
    if (counts.size <= this.#maxNames) return;
    // 상위만 남기고 잘라낸다. 잘린 이름이 다시 오면 0부터 시작하지만,
    // 순위권 밖이었으므로 화면에 보이는 결과는 달라지지 않는다.
    const kept = topEntries(counts, KEEP_NAMES);
    counts.clear();
    for (const entry of kept) counts.set(entry.username, entry.count);
  }

  /** 화면에 보여줄 스냅샷. 전부 메모리에서 만든다. */
  snapshot(online: number, now = Date.now()): StatsSnapshot {
    const currentHour = Math.floor(now / HOUR_MS);
    const hourly: HourlyEntry[] = [];
    for (let hour = currentHour - (HOURS_SHOWN - 1); hour <= currentHour; hour++) {
      const bucket = this.#hourly.get(hour);
      if (bucket === undefined || bucket.changes === 0) {
        hourly.push({ hour, changes: 0, averageTemp: 0, minTemp: 0, maxTemp: 0 });
      } else {
        hourly.push({
          hour,
          changes: bucket.changes,
          averageTemp: Math.round(bucket.sum / bucket.changes),
          minTemp: bucket.min,
          maxTemp: bucket.max,
        });
      }
    }

    return {
      online,
      today: topEntries(this.#today, TOP_N),
      allTime: topEntries(this.#allTime, TOP_N),
      // 최신이 앞에 오도록 뒤집어 보낸다.
      recent: this.#recent.slice(-RECENT_SHOWN).reverse(),
      hourly,
      at: now,
    };
  }

  /** 메모리 집계를 디스크에 반영한다. */
  flush(): void {
    const db = this.#db;
    if (db === null || !this.#dirty) return;
    this.#dirty = false;
    try {
      const upsertTally = db.prepare(
        "INSERT INTO tally (period, username, count) VALUES (?, ?, ?) " +
          "ON CONFLICT(period, username) DO UPDATE SET count = excluded.count",
      );
      const upsertHour = db.prepare(
        "INSERT INTO hourly (hour, changes, temp_sum, temp_min, temp_max) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(hour) DO UPDATE SET changes = excluded.changes, " +
          "temp_sum = excluded.temp_sum, temp_min = excluded.temp_min, temp_max = excluded.temp_max",
      );

      db.exec("BEGIN");
      const todayPeriod = `day:${this.#todayKey}`;
      for (const [username, count] of this.#today) upsertTally.run(todayPeriod, username, count);
      for (const [username, count] of this.#allTime) upsertTally.run("allTime", username, count);
      for (const [hour, bucket] of this.#hourly) {
        upsertHour.run(hour, bucket.changes, bucket.sum, bucket.min, bucket.max);
      }
      db.exec("COMMIT");

      this.#prune();
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // 열린 트랜잭션이 없으면 무시한다.
      }
      this.#logger.warn?.({ err }, "failed to persist statistics");
    }
  }

  /** 오래된 롤업과 순위권 밖 이름을 정리한다. */
  #prune(): void {
    const db = this.#db;
    if (db === null) return;

    const cutoff = Math.floor(Date.now() / HOUR_MS) - this.#retentionHours;
    db.prepare("DELETE FROM hourly WHERE hour < ?").run(cutoff);
    for (const hour of this.#hourly.keys()) {
      if (hour < cutoff) this.#hourly.delete(hour);
    }

    // 지난 날짜의 순위는 보관하지 않는다(화면에 오늘/역대만 보여준다).
    db.prepare("DELETE FROM tally WHERE period LIKE 'day:%' AND period <> ?").run(
      `day:${this.#todayKey}`,
    );
    db.prepare(
      "DELETE FROM tally WHERE period = 'allTime' AND username NOT IN " +
        "(SELECT username FROM tally WHERE period = 'allTime' ORDER BY count DESC LIMIT ?)",
    ).run(KEEP_NAMES);
  }

  close(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.flush();
    this.#db?.close();
    this.#db = null;
  }
}
