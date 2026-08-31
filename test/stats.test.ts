import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { dayKey, StatsStore } from "../src/server/stats-store.ts";
import { HOUR_MS, statsSnapshotSchema } from "../src/shared/stats.ts";
import { once, startTestServer, type TestServer } from "./helpers.ts";

const silent = { info() {}, warn() {} };

/** 디스크를 쓰지 않는 인스턴스. 대부분의 단위 테스트에 쓴다. */
const memoryStore = (options: Record<string, unknown> = {}): StatsStore =>
  new StatsStore({ file: ":memory:", logger: silent, flushIntervalMs: 300_000, ...options });

describe("dayKey", () => {
  it("시간대 기준으로 날짜를 정한다", () => {
    // 2026-10-31 15:30 UTC = 2026-11-01 00:30 KST
    const instant = Date.UTC(2026, 9, 31, 15, 30);
    assert.equal(dayKey(instant, "UTC"), "2026-10-31");
    assert.equal(dayKey(instant, "Asia/Seoul"), "2026-11-01");
    assert.equal(dayKey(instant, "America/Los_Angeles"), "2026-10-31");
  });

  it("시간대가 없으면 서버 로컬을 쓴다", () => {
    const local = new Date(2026, 6, 15, 12);
    assert.equal(dayKey(local.getTime(), null), "2026-07-15");
    assert.equal(dayKey(local.getTime(), ""), "2026-07-15");
  });

  it("한 자리 월/일을 0으로 채운다", () => {
    assert.equal(dayKey(Date.UTC(2026, 0, 5, 12), "UTC"), "2026-01-05");
  });
});

describe("StatsStore", () => {
  it("이름별 횟수를 세고 내림차순으로 준다", () => {
    const stats = memoryStore();
    for (let i = 0; i < 5; i++) stats.record({ username: "가온", direction: "up", temp: 20 });
    for (let i = 0; i < 3; i++) stats.record({ username: "apple", direction: "down", temp: 19 });
    stats.record({ username: "익명", direction: "up", temp: 21 });

    const snap = stats.snapshot(0);
    assert.deepEqual(snap.today, [
      { username: "가온", count: 5 },
      { username: "apple", count: 3 },
      { username: "익명", count: 1 },
    ]);
    assert.deepEqual(snap.allTime, snap.today);
    stats.close();
  });

  it("동점이면 이름 순으로 안정적으로 정렬한다", () => {
    const stats = memoryStore();
    for (const name of ["c", "a", "b"]) stats.record({ username: name, direction: "up", temp: 20 });
    assert.deepEqual(
      stats.snapshot(0).today.map((e) => e.username),
      ["a", "b", "c"],
    );
    stats.close();
  });

  it("상위 10명까지만 준다", () => {
    const stats = memoryStore();
    for (let i = 0; i < 30; i++) {
      for (let n = 0; n <= i; n++) stats.record({ username: `u${i}`, direction: "up", temp: 20 });
    }
    const snap = stats.snapshot(0);
    assert.equal(snap.today.length, 10);
    assert.equal(snap.today[0]?.username, "u29");
    stats.close();
  });

  it("날짜가 바뀌면 오늘 순위만 리셋하고 역대는 유지한다", () => {
    const stats = memoryStore({ timeZone: "UTC" });
    const day1 = Date.UTC(2026, 5, 1, 10);
    const day2 = Date.UTC(2026, 5, 2, 10);
    for (let i = 0; i < 4; i++) {
      stats.record({ username: "가온", direction: "up", temp: 20, at: day1 });
    }
    stats.record({ username: "가온", direction: "up", temp: 20, at: day2 });

    const snap = stats.snapshot(0, day2);
    assert.deepEqual(snap.today, [{ username: "가온", count: 1 }], "오늘은 새로 시작해야 한다");
    assert.deepEqual(snap.allTime, [{ username: "가온", count: 5 }], "역대는 이어져야 한다");
    stats.close();
  });

  describe("무한 증가 방지", () => {
    it("이름이 상한을 넘으면 상위만 남긴다", () => {
      // 닉네임은 인증도 유일성도 없어서 스크립트가 매번 다른 이름을 보낼 수 있다.
      const stats = memoryStore({ maxNames: 600 });
      // 확실히 순위에 남을 이름
      for (let i = 0; i < 100; i++) stats.record({ username: "챔피언", direction: "up", temp: 20 });
      // 매번 다른 이름 3000개
      for (let i = 0; i < 3000; i++) {
        stats.record({ username: `bot-${i}`, direction: "up", temp: 20 });
      }
      const snap = stats.snapshot(0);
      assert.equal(snap.today[0]?.username, "챔피언", "많이 누른 이름은 살아남아야 한다");
      assert.equal(snap.today[0]?.count, 100);
      stats.close();
    });

    it("최근 기록은 링버퍼 크기를 넘지 않는다", () => {
      const stats = memoryStore({ recentSize: 20 });
      for (let i = 0; i < 500; i++) {
        stats.record({ username: `u${i}`, direction: "up", temp: 20, at: 1000 + i });
      }
      const snap = stats.snapshot(0);
      // 화면에는 50건까지 주지만 버퍼가 20이므로 20건뿐이다.
      assert.equal(snap.recent.length, 20);
      assert.equal(snap.recent[0]?.username, "u499", "최신이 앞에 와야 한다");
      assert.equal(snap.recent.at(-1)?.username, "u480");
      stats.close();
    });

    it("최근 기록은 최대 50건만 내보낸다", () => {
      const stats = memoryStore({ recentSize: 500 });
      for (let i = 0; i < 200; i++) {
        stats.record({ username: "가온", direction: "up", temp: 20 });
      }
      assert.equal(stats.snapshot(0).recent.length, 50);
      stats.close();
    });
  });

  describe("시간대별 롤업", () => {
    it("항상 24시간치를 주고 빈 시간은 0으로 채운다", () => {
      const stats = memoryStore();
      const now = Date.now();
      const snap = stats.snapshot(0, now);
      assert.equal(snap.hourly.length, 24);
      assert.ok(snap.hourly.every((h) => h.changes === 0));
      // 시간이 오름차순이고 마지막이 현재 시간이어야 한다
      assert.equal(snap.hourly.at(-1)?.hour, Math.floor(now / HOUR_MS));
      for (let i = 1; i < snap.hourly.length; i++) {
        assert.equal((snap.hourly[i]?.hour ?? 0) - (snap.hourly[i - 1]?.hour ?? 0), 1);
      }
      stats.close();
    });

    it("시간별로 횟수와 최저/최고/평균 온도를 모은다", () => {
      const stats = memoryStore();
      const now = Date.now();
      const hourAgo = now - HOUR_MS;
      for (const temp of [18, 22, 26]) {
        stats.record({ username: "가온", direction: "up", temp, at: hourAgo });
      }
      stats.record({ username: "가온", direction: "up", temp: 30, at: now });

      const snap = stats.snapshot(0, now);
      const previous = snap.hourly.at(-2);
      assert.equal(previous?.changes, 3);
      assert.equal(previous?.minTemp, 18);
      assert.equal(previous?.maxTemp, 26);
      assert.equal(previous?.averageTemp, 22);
      assert.equal(snap.hourly.at(-1)?.changes, 1);
      stats.close();
    });

    it("24시간보다 오래된 것은 화면에 나오지 않는다", () => {
      const stats = memoryStore();
      const now = Date.now();
      stats.record({ username: "가온", direction: "up", temp: 20, at: now - 30 * HOUR_MS });
      const snap = stats.snapshot(0, now);
      assert.ok(snap.hourly.every((h) => h.changes === 0));
      stats.close();
    });
  });

  it("스냅샷이 스키마를 만족한다", () => {
    const stats = memoryStore();
    stats.record({ username: "가온", direction: "up", temp: 20 });
    const result = statsSnapshotSchema.parse(stats.snapshot(7));
    assert.equal(result.ok, true, result.ok ? "" : result.error);
    if (result.ok) assert.equal(result.value.online, 7);
    stats.close();
  });

  it("꺼두면 아무것도 세지 않는다", () => {
    const stats = memoryStore({ enabled: false });
    for (let i = 0; i < 10; i++) stats.record({ username: "가온", direction: "up", temp: 20 });
    const snap = stats.snapshot(3);
    assert.deepEqual(snap.today, []);
    assert.deepEqual(snap.recent, []);
    // 접속자 수는 통계와 무관하게 계속 동작해야 한다
    assert.equal(snap.online, 3);
    stats.close();
  });

  describe("영속화", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "myaircon-stats-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("재시작해도 역대 순위가 남는다", () => {
      const file = path.join(dir, "nested", "stats.db");
      const first = new StatsStore({ file, logger: silent, flushIntervalMs: 300_000 });
      for (let i = 0; i < 7; i++) first.record({ username: "가온", direction: "up", temp: 20 });
      first.close();

      const second = new StatsStore({ file, logger: silent, flushIntervalMs: 300_000 });
      assert.deepEqual(second.snapshot(0).allTime, [{ username: "가온", count: 7 }]);
      second.close();
    });

    it("재시작하면 최근 기록은 비어 있다 (메모리 링버퍼)", () => {
      const file = path.join(dir, "stats.db");
      const first = new StatsStore({ file, logger: silent, flushIntervalMs: 300_000 });
      first.record({ username: "가온", direction: "up", temp: 20 });
      first.close();

      const second = new StatsStore({ file, logger: silent, flushIntervalMs: 300_000 });
      assert.deepEqual(second.snapshot(0).recent, []);
      second.close();
    });

    it("시간대별 롤업도 남는다", () => {
      const file = path.join(dir, "stats.db");
      const at = Date.now();
      const first = new StatsStore({ file, logger: silent, flushIntervalMs: 300_000 });
      first.record({ username: "가온", direction: "up", temp: 24, at });
      first.close();

      const second = new StatsStore({ file, logger: silent, flushIntervalMs: 300_000 });
      const current = second.snapshot(0, at).hourly.at(-1);
      assert.equal(current?.changes, 1);
      assert.equal(current?.averageTemp, 24);
      second.close();
    });

    it("DB를 열 수 없어도 서비스는 계속 돈다", () => {
      // 디렉터리를 파일 경로로 지정해 열기를 실패시킨다.
      const stats = new StatsStore({ file: dir, logger: silent, flushIntervalMs: 300_000 });
      assert.doesNotThrow(() => stats.record({ username: "가온", direction: "up", temp: 20 }));
      // 집계는 메모리에서 계속된다. 영속화만 안 될 뿐이다.
      assert.deepEqual(stats.snapshot(0).today, [{ username: "가온", count: 1 }]);
      assert.doesNotThrow(() => stats.close());
    });
  });
});

describe("통계 API와 접속자 수", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("GET /api/stats 가 스키마에 맞는 응답을 준다", async () => {
    server = await startTestServer({ stats: { file: ":memory:" } });
    const res = await server.app.inject({ method: "GET", url: "/api/stats" });
    assert.equal(res.statusCode, 200);
    const parsed = statsSnapshotSchema.parse(res.json(), "stats");
    assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
    assert.equal(res.headers["cache-control"], "no-store");
  });

  it("실제 조절이 순위와 기록에 반영된다", async () => {
    server = await startTestServer({ stats: { file: ":memory:" } });
    const { socket } = await server.connect();
    socket.emit("plus", "가온");
    await once(socket, "tempChange");

    const snap = (await server.app.inject({ method: "GET", url: "/api/stats" })).json();
    assert.deepEqual(snap.today, [{ username: "가온", count: 1 }]);
    assert.equal(snap.recent.length, 1);
    assert.equal(snap.recent[0].direction, "up");
    assert.equal(snap.recent[0].temp, 19);
  });

  it("경계값에서 눌러 값이 안 바뀌면 세지 않는다", async () => {
    // 30도에서 + 를 연타해 순위를 올리는 farming을 막는다.
    server = await startTestServer({
      // 이미 상한이라 + 를 눌러도 값이 그대로다.
      temperature: { min: 18, max: 19, initial: 19 },
      stats: { file: ":memory:" },
    });
    const { socket } = await server.connect();
    socket.emit("plus", "farmer");
    const change = await once<{ changed: boolean }>(socket, "tempChange");
    assert.equal(change.changed, false);

    const snap = (await server.app.inject({ method: "GET", url: "/api/stats" })).json();
    assert.deepEqual(snap.today, [], "값이 안 바뀌었으면 순위에 들어가면 안 된다");
    assert.deepEqual(snap.recent, []);
  });

  it("접속자 수가 접속/해제를 정확히 따라간다", async () => {
    server = await startTestServer({ stats: { file: ":memory:" } });
    const online = (): number => server?.realtime.online ?? -1;

    assert.equal(online(), 0);
    const a = await server.connect();
    assert.equal(online(), 1);
    const b = await server.connect();
    assert.equal(online(), 2);

    a.socket.close();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(online(), 1);

    b.socket.close();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(online(), 0);
  });

  it("접속자 수가 바뀌면 브로드캐스트된다", async () => {
    server = await startTestServer({
      stats: { file: ":memory:", onlineIntervalMs: 1000 },
    });
    const watcher = await server.connect();
    const received = once<{ online: number }>(watcher.socket, "onlineCount", 5000);
    const other = await server.connect();
    const message = await received;
    assert.ok(message.online >= 2, `접속자 수가 2 이상이어야 한다 (받은 값: ${message.online})`);
    other.socket.close();
  });
});
