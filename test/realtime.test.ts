import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { LightMyRequestResponse } from "fastify";
import type { BlockedMessage, TempChangeMessage } from "../src/shared/protocol.ts";
import { once, race, startTestServer, type TestServer } from "./helpers.ts";

/**
 * 표시 이름은 "이름#태그" 형태다. 태그는 접속 주소에서 유도되므로 테스트가
 * 특정 값에 기대면 안 된다. 이름 부분만 비교한다.
 */
const nameOf = (display: string): string => display.split("#")[0] ?? display;
const TAG = /#[0-9a-f]{3}$/;

describe("실시간 온도 조절", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("접속하면 현재 온도와 함께 허용 범위를 받는다", async () => {
    // 클라이언트가 18/30을 하드코딩하지 않도록 서버가 범위를 알려준다.
    server = await startTestServer({ temperature: { min: 18, max: 30, initial: 22 } });
    const { init } = await server.connect();
    assert.equal(init.temp, 22);
    assert.equal(init.min, 18);
    assert.equal(init.max, 30);
  });

  it("범위를 바꾸면 init에 그대로 반영된다", async () => {
    server = await startTestServer({ temperature: { min: 10, max: 12, initial: 11 } });
    const { init } = await server.connect();
    assert.equal(init.temp, 11);
    assert.equal(init.min, 10);
    assert.equal(init.max, 12);
  });

  describe("기기 종류", () => {
    it("init에 기기 종류와 이미지 경로가 실려 온다", async () => {
      server = await startTestServer();
      const { init } = await server.connect();
      assert.ok(["aircon", "heater"].includes(init.device.kind));
      assert.deepEqual(Object.keys(init.device.assets).sort(), ["air", "body", "fan"]);
      for (const url of Object.values(init.device.assets)) {
        assert.match(url, /^\/.+\.png$/);
      }
    });

    it("DEVICE_MODE로 고정하면 계절과 무관하게 그것이 내려온다", async () => {
      server = await startTestServer({ device: { mode: "heater" } });
      const { init } = await server.connect();
      assert.equal(init.device.kind, "heater");
      // 온풍기 에셋이 아직 없으므로 에어컨 이미지로 폴백해야 한다
      assert.equal(init.device.usingFallback, true);
      assert.equal(init.device.assets.body, "/aircon0.png");
    });

    it("에어컨으로 고정하면 폴백이 아니다", async () => {
      server = await startTestServer({ device: { mode: "aircon" } });
      const { init } = await server.connect();
      assert.equal(init.device.kind, "aircon");
      assert.equal(init.device.usingFallback, false);
    });

    it("서버가 내려준 이미지 경로를 실제로 서빙한다", async () => {
      server = await startTestServer({ device: { mode: "heater" } });
      const { init } = await server.connect();
      for (const url of Object.values(init.device.assets)) {
        const res: LightMyRequestResponse = await server.app.inject({ method: "GET", url });
        assert.equal(res.statusCode, 200, `${url}를 서빙하지 못한다`);
      }
    });

    it("healthz가 현재 기기를 보고한다", async () => {
      server = await startTestServer({ device: { mode: "heater" } });
      const res = await server.app.inject({ method: "GET", url: "/healthz" });
      assert.equal(res.json().device, "heater");
    });
  });

  it("plus/minus가 온도를 움직이고 전원에게 브로드캐스트된다", async () => {
    server = await startTestServer();
    const a = await server.connect();
    const b = await server.connect();

    a.socket.emit("plus", "가온");
    const [seenByA, seenByB] = await Promise.all([
      once<TempChangeMessage>(a.socket, "tempChange"),
      once<TempChangeMessage>(b.socket, "tempChange"),
    ]);

    assert.equal(seenByA.temp, 19);
    assert.equal(nameOf(seenByA.username), "가온");
    assert.match(seenByA.username, TAG, "동명이인 구분용 태그가 붙어야 한다");
    assert.equal(seenByA.changed, true);
    assert.equal(seenByA.direction, "up");
    // 누른 사람뿐 아니라 보고만 있는 사람에게도 똑같이 간다
    assert.deepEqual(seenByB, seenByA);

    a.socket.emit("minus", "가온");
    const down = await once<TempChangeMessage>(a.socket, "tempChange");
    assert.equal(down.temp, 18);
    assert.equal(down.direction, "down");
  });

  it("상한/하한을 넘지 않고 changed=false로 알린다", async () => {
    server = await startTestServer({ temperature: { min: 18, max: 20, initial: 20 } });
    const { socket } = await server.connect();

    socket.emit("plus", "clamp");
    const res = await once<TempChangeMessage>(socket, "tempChange");
    assert.equal(res.temp, 20);
    assert.equal(res.changed, false, "경계에서는 값이 그대로여야 한다");
  });

  describe("문자열이 아닌 페이로드 (기존에는 '너무 잦은 요청'이라고 거짓 안내했다)", () => {
    for (const [label, payload] of [
      ["숫자", 123],
      ["null", null],
      ["객체", { nick: "x" }],
      ["배열", ["x"]],
      ["불리언", true],
    ]) {
      it(`${label} -> 서버가 죽지 않고 기본 닉네임으로 처리한다`, async () => {
        server = await startTestServer();
        const { socket } = await server.connect();

        socket.emit("plus", payload);
        const [event, data] = await race<TempChangeMessage>(socket, [
          "tempChange",
          "blocked",
          "server-error",
        ]);

        assert.equal(event, "tempChange", "rate limit이나 에러로 오해받으면 안 된다");
        assert.equal(nameOf(data.username), "익명");
        assert.equal(data.temp, 19);
      });
    }
  });

  it("페이로드를 아예 안 보내도 처리한다", async () => {
    server = await startTestServer();
    const { socket } = await server.connect();
    socket.emit("plus");
    const [event, data] = await race<TempChangeMessage>(socket, [
      "tempChange",
      "blocked",
      "server-error",
    ]);
    assert.equal(event, "tempChange");
    assert.equal(nameOf(data.username), "익명");
  });

  it("이모지 닉네임은 서버가 걸러낸다", async () => {
    // 클라이언트에서도 입력 단계에서 막지만, 서버는 우리 클라이언트를
    // 쓰지 않는 쪽도 상대해야 한다.
    server = await startTestServer();
    const { socket } = await server.connect();
    socket.emit("plus", "가온🎉🎉🎉");
    const { username } = await once<TempChangeMessage>(socket, "tempChange");
    assert.equal(nameOf(username), "가온");
  });

  it("빈 닉네임은 기본값으로 대체된다", async () => {
    server = await startTestServer();
    const { socket } = await server.connect();
    socket.emit("minus", "   ");
    const { username } = await once<TempChangeMessage>(socket, "tempChange");
    assert.equal(nameOf(username), "익명");
  });

  describe("rate limit", () => {
    it("한도를 넘기면 blocked를 보내고 온도를 바꾸지 않는다", async () => {
      server = await startTestServer({
        rateLimit: { points: 2, durationSeconds: 60, blockSeconds: 60 },
      });
      const { socket } = await server.connect();

      for (let i = 0; i < 2; i++) {
        socket.emit("plus", "flood");
        await once<TempChangeMessage>(socket, "tempChange");
      }
      assert.equal(server.thermostat.value, 20);

      socket.emit("plus", "flood");
      const [event, payload] = await race<BlockedMessage>(socket, ["blocked", "tempChange"]);
      assert.equal(event, "blocked");
      assert.equal(payload.reason, "rate_limited");
      // 언제 다시 시도할 수 있는지 알려줘야 "잠시 후 다시" 대신 남은 시간을
      // 보여줄 수 있다. 예전 페이로드는 문자열 하나뿐이었다.
      assert.equal(typeof payload.retryAfterMs, "number");
      assert.ok(payload.retryAfterMs > 0);
      assert.equal(server.thermostat.value, 20, "차단된 요청은 온도를 바꾸면 안 된다");
    });

    it("X-Forwarded-For를 위조해도 한도를 우회할 수 없다", async () => {
      // 기본 설정(trustProxyHops=0)에서는 XFF를 무시하고 소켓 주소만 본다.
      // 기존 코드는 이 헤더가 곧 rate limit 키였기 때문에, 매 접속마다 다른
      // 값을 넣는 것만으로 제한이 통째로 무력화됐다.
      server = await startTestServer({
        rateLimit: { points: 1, durationSeconds: 60, blockSeconds: 60 },
      });

      const { io: createClient } = await import("socket.io-client");
      const { url } = server;
      const connectAs = async (fakeIp: string) => {
        const socket = createClient(url, {
          transports: ["websocket"],
          forceNew: true,
          reconnection: false,
          extraHeaders: { "X-Forwarded-For": fakeIp },
        });
        await once(socket, "init", 5000);
        return socket;
      };

      const first = await connectAs("1.1.1.1");
      first.emit("plus", "spoof");
      await once<TempChangeMessage>(first, "tempChange");

      const second = await connectAs("2.2.2.2");
      second.emit("plus", "spoof");
      const [event] = await race(second, ["blocked", "tempChange"]);
      assert.equal(event, "blocked", "IP를 바꿔 보내도 같은 버킷이어야 한다");

      first.close();
      second.close();
    });
  });

  it("변경된 온도가 상태 파일에 저장된다", async () => {
    server = await startTestServer({ persistDebounceMs: 5 });
    const { socket } = await server.connect();
    socket.emit("plus", "persist");
    await once<TempChangeMessage>(socket, "tempChange");

    await server.store.flush();
    const { readFile } = await import("node:fs/promises");
    const saved = JSON.parse(await readFile(`${server.stateDir}/state.json`, "utf8"));
    assert.equal(saved.temp, 19);
  });

  it("새로 접속한 사람은 바뀐 온도를 init으로 받는다", async () => {
    server = await startTestServer();
    const a = await server.connect();
    a.socket.emit("plus", "first");
    await once<TempChangeMessage>(a.socket, "tempChange");

    const b = await server.connect();
    assert.equal(b.init.temp, 19);
  });
});
