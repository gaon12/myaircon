import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BlockedMessage, TempChangeMessage } from "../src/shared/protocol.ts";
import { once, race, startTestServer } from "./helpers.ts";

describe("일반 방어 비활성화의 보안 경계", () => {
  it("소켓 수, 접속 빈도, 행동 점수, 자동화 판정을 함께 끈다", async (t) => {
    const server = await startTestServer({
      guard: {
        enabled: false,
        maxConcurrentSockets: 1,
        handshakesPerMinute: 1,
        automationAction: "block",
      },
    });
    t.after(() => server.stop());
    server.guard.noteSuspicious("127.0.0.1", 100);
    const auth = { automation: { signals: ["webdriver"] } };
    for (let i = 0; i < 3; i++) {
      const { socket } = await server.connect(auth);
      assert.equal(socket.connected, true);
    }
    assert.equal(server.realtime.sessions().length, 3);
    assert.equal(server.guard.concurrentSockets("127.0.0.1"), 0);
  });

  it("관리자가 내린 IP 차단은 계속 적용한다", async (t) => {
    const server = await startTestServer({
      guard: { enabled: false },
      admin: { token: "test-admin-token-long-enough" },
    });
    t.after(() => server.stop());
    server.bans.add("127.0.0.1", 60_000, "test");
    const client = server.dial();
    const error = await once<Error>(client, "connect_error");
    assert.equal(error.message, "blocked");
    assert.equal(server.realtime.sessions().length, 0);
  });

  it("관리자 인증과 인증 실패 잠금은 계속 적용한다", async (t) => {
    const token = "test-admin-token-long-enough";
    const server = await startTestServer({
      guard: { enabled: false, adminFailureLimit: 2 },
      admin: { token },
    });
    t.after(() => server.stop());
    for (let i = 0; i < 2; i++) {
      const denied = await server.app.inject({ url: "/api/admin/overview" });
      assert.equal(denied.statusCode, 401);
    }
    const locked = await server.app.inject({
      url: "/api/admin/overview",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(locked.statusCode, 429);
  });

  it("온도 조절 속도 제한과 입력 정규화를 계속 적용한다", async (t) => {
    const server = await startTestServer({
      guard: { enabled: false },
      rateLimit: { points: 1, durationSeconds: 60, blockSeconds: 60 },
    });
    t.after(() => server.stop());
    const { socket } = await server.connect();
    socket.emit("plus", { invalid: true });
    const changed = await once<TempChangeMessage>(socket, "tempChange");
    assert.ok(changed.username.startsWith(server.config.nickname.fallback));
    socket.emit("plus", "연타");
    const [event, blocked] = await race<BlockedMessage>(socket, ["blocked", "tempChange"]);
    assert.equal(event, "blocked");
    assert.equal(blocked.reason, "rate_limited");
    assert.equal(server.thermostat.value, changed.temp);
  });
});
