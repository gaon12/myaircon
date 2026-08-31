import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { LightMyRequestResponse } from "fastify";
import { BanStore } from "../src/server/ban-store.ts";
import { adminOverviewSchema } from "../src/shared/admin.ts";
import { once, startTestServer, type TestServer } from "./helpers.ts";

const TOKEN = "test-admin-token-1234567890";
const auth = { authorization: `Bearer ${TOKEN}` };
const silent = { info() {}, warn() {} };

describe("BanStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "myaircon-ban-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("차단을 추가하고 조회한다", () => {
    const store = new BanStore({ file: ":memory:", logger: silent });
    assert.equal(store.isBanned("1.2.3.4"), false);
    const record = store.add("1.2.3.4", 60_000, "spam");
    assert.equal(store.isBanned("1.2.3.4"), true);
    assert.equal(record.reason, "spam");
    assert.ok(record.until > Date.now());
    store.close();
  });

  it("시간이 지나면 자동으로 풀린다", () => {
    const store = new BanStore({ file: ":memory:", logger: silent });
    const now = Date.now();
    store.add("1.2.3.4", 1000, "temp", now);
    assert.equal(store.isBanned("1.2.3.4", now + 500), true);
    assert.equal(store.isBanned("1.2.3.4", now + 1500), false);
    // 만료된 것은 목록에서도 빠진다
    assert.deepEqual(store.list(now + 1500), []);
    store.close();
  });

  it("같은 주소를 다시 차단하면 연장된다", () => {
    const store = new BanStore({ file: ":memory:", logger: silent });
    const now = Date.now();
    const first = store.add("1.2.3.4", 1000, "one", now);
    const second = store.add("1.2.3.4", 60_000, "two", now);
    assert.ok(second.until > first.until);
    assert.equal(second.createdAt, first.createdAt, "처음 차단한 시각은 유지된다");
    assert.equal(second.reason, "two");
    assert.equal(store.list(now).length, 1);
    store.close();
  });

  it("차단을 직접 풀 수 있다", () => {
    const store = new BanStore({ file: ":memory:", logger: silent });
    store.add("1.2.3.4", 60_000, "spam");
    assert.equal(store.remove("1.2.3.4"), true);
    assert.equal(store.isBanned("1.2.3.4"), false);
    assert.equal(store.remove("1.2.3.4"), false, "없는 것을 풀면 false");
    store.close();
  });

  it("재시작해도 차단이 남는다", () => {
    const file = path.join(dir, "bans.db");
    const first = new BanStore({ file, logger: silent });
    first.add("1.2.3.4", 60_000, "spam");
    first.close();

    const second = new BanStore({ file, logger: silent });
    assert.equal(second.isBanned("1.2.3.4"), true);
    second.close();
  });

  it("이미 만료된 차단은 다시 불러오지 않는다", () => {
    const file = path.join(dir, "bans.db");
    const first = new BanStore({ file, logger: silent });
    first.add("1.2.3.4", -1000, "already over");
    first.close();

    const second = new BanStore({ file, logger: silent });
    assert.equal(second.isBanned("1.2.3.4"), false);
    assert.deepEqual(second.list(), []);
    second.close();
  });

  it("DB를 못 열어도 메모리로 동작한다", () => {
    const store = new BanStore({ file: dir, logger: silent });
    assert.doesNotThrow(() => store.add("1.2.3.4", 60_000, "spam"));
    assert.equal(store.isBanned("1.2.3.4"), true);
    store.close();
  });

  it("꺼두면 아무도 차단하지 않는다", () => {
    const store = new BanStore({ file: ":memory:", enabled: false, logger: silent });
    store.add("1.2.3.4", 60_000, "spam");
    assert.equal(store.isBanned("1.2.3.4"), false);
    store.close();
  });
});

describe("관리 API", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  const start = (): Promise<TestServer> =>
    startTestServer({
      admin: { token: TOKEN, banFile: ":memory:" },
      stats: { file: ":memory:" },
    });

  describe("인증", () => {
    it("토큰이 없으면 401", async () => {
      server = await start();
      const res = await server.app.inject({ method: "GET", url: "/api/admin/overview" });
      assert.equal(res.statusCode, 401);
    });

    it("틀린 토큰이면 401", async () => {
      server = await start();
      const res = await server.app.inject({
        method: "GET",
        url: "/api/admin/overview",
        headers: { authorization: "Bearer wrong-token-that-is-long-enough" },
      });
      assert.equal(res.statusCode, 401);
    });

    it("Bearer 접두사가 없으면 401", async () => {
      server = await start();
      const res = await server.app.inject({
        method: "GET",
        url: "/api/admin/overview",
        headers: { authorization: TOKEN },
      });
      assert.equal(res.statusCode, 401);
    });

    it("맞는 토큰이면 통과", async () => {
      server = await start();
      const res = await server.app.inject({
        method: "GET",
        url: "/api/admin/overview",
        headers: auth,
      });
      assert.equal(res.statusCode, 200);
    });

    it("ADMIN_TOKEN이 없으면 라우트 자체가 없다", async () => {
      // 빈 토큰으로 열려 있는 것보다 아예 없는 편이 안전하다.
      server = await startTestServer({
        admin: { token: null, banFile: ":memory:" },
        stats: { file: ":memory:" },
      });
      const res = await server.app.inject({
        method: "GET",
        url: "/api/admin/overview",
        headers: auth,
      });
      assert.equal(res.statusCode, 404);
    });

    it("일반 API는 토큰 없이도 계속 된다", async () => {
      server = await start();
      for (const url of ["/healthz", "/api/stats", "/"]) {
        const res: LightMyRequestResponse = await server.app.inject({ method: "GET", url });
        assert.equal(res.statusCode, 200, url);
      }
    });
  });

  describe("overview", () => {
    it("스키마에 맞는 응답을 준다", async () => {
      server = await start();
      const res = await server.app.inject({
        method: "GET",
        url: "/api/admin/overview",
        headers: auth,
      });
      const parsed = adminOverviewSchema.parse(res.json(), "overview");
      assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
    });

    it("접속 중인 연결이 목록에 나온다", async () => {
      server = await start();
      const { socket } = await server.connect();
      socket.emit("plus", "가온");
      await once(socket, "tempChange");

      const overview = (
        await server.app.inject({ method: "GET", url: "/api/admin/overview", headers: auth })
      ).json();
      assert.equal(overview.sessions.length, 1);
      const session = overview.sessions[0];
      assert.equal(session.nickname, "가온", "마지막으로 쓴 이름이 보여야 한다");
      assert.match(session.tag, /^[0-9a-f]{3}$/);
      assert.ok(session.ip.length > 0);
      assert.ok(session.connectedAt <= Date.now());
    });

    it("연결이 끊기면 목록에서 빠진다", async () => {
      server = await start();
      const { socket } = await server.connect();
      socket.close();
      await new Promise((r) => setTimeout(r, 300));

      const overview = (
        await server.app.inject({ method: "GET", url: "/api/admin/overview", headers: auth })
      ).json();
      assert.deepEqual(overview.sessions, []);
    });
  });

  describe("kick", () => {
    it("태그로 지목해 끊고 차단한다", async () => {
      server = await start();
      const { socket } = await server.connect();
      socket.emit("plus", "말썽");
      await once(socket, "tempChange");

      const before = (
        await server.app.inject({ method: "GET", url: "/api/admin/overview", headers: auth })
      ).json();
      const tag = before.sessions[0].tag;

      const res = await server.app.inject({
        method: "POST",
        url: "/api/admin/kick",
        headers: auth,
        payload: { target: { tag }, minutes: 10, reason: "spam" },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().disconnected, 1);
      assert.ok(res.json().bannedUntil > Date.now());

      await new Promise((r) => setTimeout(r, 300));
      const after = (
        await server.app.inject({ method: "GET", url: "/api/admin/overview", headers: auth })
      ).json();
      assert.deepEqual(after.sessions, [], "연결이 끊겨야 한다");
      assert.equal(after.bans.length, 1);
      assert.equal(after.bans[0].tag, tag);
    });

    it("차단된 주소는 다시 접속하지 못한다", async () => {
      // kick만으로는 새로고침 한 번에 돌아온다. 차단이 붙어야 의미가 있다.
      server = await start();
      const { socket } = await server.connect();
      socket.emit("plus", "말썽");
      await once(socket, "tempChange");
      const overview = (
        await server.app.inject({ method: "GET", url: "/api/admin/overview", headers: auth })
      ).json();

      await server.app.inject({
        method: "POST",
        url: "/api/admin/kick",
        headers: auth,
        payload: { target: { ip: overview.sessions[0].ip }, minutes: 10, reason: "spam" },
      });
      await new Promise((r) => setTimeout(r, 200));

      await assert.rejects(
        () => server?.connect() ?? Promise.reject(new Error("no server")),
        /banned|이벤트를/,
        "재접속이 거부돼야 한다",
      );
    });

    it("minutes가 0이면 끊기만 하고 차단하지 않는다", async () => {
      server = await start();
      const { socket } = await server.connect();
      socket.emit("plus", "경고");
      await once(socket, "tempChange");
      const overview = (
        await server.app.inject({ method: "GET", url: "/api/admin/overview", headers: auth })
      ).json();

      const res = await server.app.inject({
        method: "POST",
        url: "/api/admin/kick",
        headers: auth,
        payload: { target: { ip: overview.sessions[0].ip }, minutes: 0, reason: "warning" },
      });
      assert.equal(res.json().bannedUntil, 0);
      await new Promise((r) => setTimeout(r, 200));

      // 차단이 없으므로 바로 다시 붙을 수 있다
      const again = await server.connect();
      assert.ok(again.init.temp >= 18);
    });

    it("붙어 있지 않은 태그를 지목하면 404", async () => {
      server = await start();
      const res = await server.app.inject({
        method: "POST",
        url: "/api/admin/kick",
        headers: auth,
        payload: { target: { tag: "zzz" }, minutes: 10, reason: "spam" },
      });
      assert.equal(res.statusCode, 404);
    });

    it("잘못된 본문은 400", async () => {
      server = await start();
      for (const payload of [
        {},
        { target: {}, minutes: 10, reason: "x" },
        { target: { ip: "1.2.3.4" }, minutes: -1, reason: "x" },
        { target: { ip: "1.2.3.4" }, minutes: "10", reason: "x" },
        { target: "nope", minutes: 1, reason: "x" },
        { target: { ip: "1.2.3.4" }, reason: "x" },
      ]) {
        const res: LightMyRequestResponse = await server.app.inject({
          method: "POST",
          url: "/api/admin/kick",
          headers: auth,
          payload,
        });
        assert.equal(res.statusCode, 400, JSON.stringify(payload));
      }
    });

    it("JSON이 아닌 본문은 핸들러에 닿기 전에 거부된다", async () => {
      // Fastify가 content-type에 따라 400 또는 415로 막는다. 정확한 코드보다
      // "본문 파싱 단계에서 걸린다"가 검증할 내용이다.
      server = await start();
      for (const contentType of ["text/plain", "application/octet-stream"]) {
        const res: LightMyRequestResponse = await server.app.inject({
          method: "POST",
          url: "/api/admin/kick",
          headers: { ...auth, "content-type": contentType },
          payload: "not json",
        });
        assert.ok(
          res.statusCode >= 400 && res.statusCode < 500,
          `${contentType} -> ${res.statusCode}`,
        );
      }
    });
  });

  describe("unban", () => {
    it("차단을 풀면 다시 접속할 수 있다", async () => {
      server = await start();
      const { socket } = await server.connect();
      socket.emit("plus", "말썽");
      await once(socket, "tempChange");
      const overview = (
        await server.app.inject({ method: "GET", url: "/api/admin/overview", headers: auth })
      ).json();
      const ip = overview.sessions[0].ip;

      await server.app.inject({
        method: "POST",
        url: "/api/admin/kick",
        headers: auth,
        payload: { target: { ip }, minutes: 10, reason: "spam" },
      });
      const lifted = await server.app.inject({
        method: "POST",
        url: "/api/admin/unban",
        headers: auth,
        payload: { ip },
      });
      assert.equal(lifted.json().removed, true);

      const again = await server.connect();
      assert.ok(again.init.temp >= 18);
    });

    it("잘못된 본문은 400", async () => {
      server = await start();
      const res = await server.app.inject({
        method: "POST",
        url: "/api/admin/unban",
        headers: auth,
        payload: { ip: "" },
      });
      assert.equal(res.statusCode, 400);
    });
  });
});
