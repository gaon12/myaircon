import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type BanLogger = {
  info?: (details: unknown, message?: string) => void;
  warn?: (details: unknown, message?: string) => void;
};

export type BanRecord = {
  /** 차단된 주소. 화면에는 태그로 보여주고 이 값은 관리자만 본다. */
  ip: string;
  /** 만료 시각(epoch ms). */
  until: number;
  reason: string;
  createdAt: number;
};

export type BanStoreOptions = {
  file: string;
  enabled?: boolean | undefined;
  logger?: BanLogger | undefined;
};

/**
 * 차단 목록.
 *
 * kick만으로는 의미가 없다. 끊어도 즉시 새로고침하면 돌아오기 때문에 짧게라도
 * 재접속을 막아야 한다. 그래서 kick은 "끊기 + 일정 시간 차단"이다.
 *
 * 판정은 메모리 Map에서 하고(핸드셰이크마다 조회하므로 SQL을 돌리면 안 된다),
 * SQLite에는 재시작 대비로 저장한다. 통계와 달리 즉시 쓴다 -- 차단은 몇 건
 * 되지 않고, 방금 내린 차단이 재시작으로 사라지면 곤란하다.
 *
 * 한계: IP 차단은 VPN이나 모바일 IP 변경으로 우회된다. 완전한 차단이 아니라
 * "가벼운 장난의 비용을 올리는" 장치다.
 */
export class BanStore {
  readonly #enabled: boolean;
  readonly #logger: BanLogger;
  #db: DatabaseSync | null = null;
  #bans = new Map<string, BanRecord>();

  constructor({ file, enabled = true, logger = {} }: BanStoreOptions) {
    this.#enabled = enabled;
    this.#logger = logger;
    if (!this.#enabled) return;

    try {
      if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
      this.#db = new DatabaseSync(file);
      this.#db.exec("PRAGMA journal_mode = WAL");
      this.#db.exec(
        "CREATE TABLE IF NOT EXISTS ban (" +
          "ip TEXT PRIMARY KEY, until INTEGER NOT NULL, reason TEXT NOT NULL, " +
          "created_at INTEGER NOT NULL)",
      );
      const rows = this.#db
        .prepare("SELECT ip, until, reason, created_at FROM ban")
        .all() as unknown as { ip: string; until: number; reason: string; created_at: number }[];
      const now = Date.now();
      for (const row of rows) {
        if (row.until <= now) continue;
        this.#bans.set(row.ip, {
          ip: row.ip,
          until: row.until,
          reason: row.reason,
          createdAt: row.created_at,
        });
      }
      this.#logger.info?.({ count: this.#bans.size }, "loaded active bans");
    } catch (err) {
      // 차단 목록을 못 열었다고 서비스가 죽으면 안 된다. 메모리로만 동작한다.
      this.#logger.warn?.({ err, file }, "ban store unavailable, bans will not survive restart");
      this.#db = null;
    }
  }

  /** 지금 차단 중이면 그 기록을, 아니면 null. 만료된 것은 지운다. */
  find(ip: string, now = Date.now()): BanRecord | null {
    const record = this.#bans.get(ip);
    if (record === undefined) return null;
    if (record.until <= now) {
      this.remove(ip);
      return null;
    }
    return record;
  }

  isBanned(ip: string, now = Date.now()): boolean {
    return this.find(ip, now) !== null;
  }

  /** 차단을 추가하거나 연장한다. 저장소가 꺼져 있으면 아무 일도 하지 않는다. */
  add(ip: string, durationMs: number, reason: string, now = Date.now()): BanRecord {
    const record0: BanRecord = { ip, until: now + durationMs, reason, createdAt: now };
    if (!this.#enabled) return record0;
    const existing = this.#bans.get(ip);
    const record: BanRecord = {
      ip,
      until: now + durationMs,
      reason,
      createdAt: existing?.createdAt ?? now,
    };
    this.#bans.set(ip, record);
    this.#write(record);
    return record;
  }

  remove(ip: string): boolean {
    const existed = this.#bans.delete(ip);
    try {
      this.#db?.prepare("DELETE FROM ban WHERE ip = ?").run(ip);
    } catch (err) {
      this.#logger.warn?.({ err, ip }, "failed to delete ban");
    }
    return existed;
  }

  /** 유효한 차단 목록. 만료된 것은 정리해서 내보낸다. */
  list(now = Date.now()): BanRecord[] {
    for (const [ip, record] of [...this.#bans]) {
      if (record.until <= now) this.remove(ip);
    }
    return [...this.#bans.values()].sort((a, b) => b.until - a.until);
  }

  #write(record: BanRecord): void {
    try {
      this.#db
        ?.prepare(
          "INSERT INTO ban (ip, until, reason, created_at) VALUES (?, ?, ?, ?) " +
            "ON CONFLICT(ip) DO UPDATE SET until = excluded.until, reason = excluded.reason",
        )
        .run(record.ip, record.until, record.reason, record.createdAt);
    } catch (err) {
      this.#logger.warn?.({ err, ip: record.ip }, "failed to persist ban");
    }
  }

  close(): void {
    this.#db?.close();
    this.#db = null;
  }
}
