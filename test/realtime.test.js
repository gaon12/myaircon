import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { once, race, startTestServer } from "./helpers.js";

describe("실시간 온도 조절", () => {
  let server;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("접속하면 현재 온도를 받는다", async () => {
    server = await startTestServer({ temperature: { min: 18, max: 30, initial: 22 } });
    const { init } = await server.connect();
    assert.equal(init, 22);
  });

  it("plus/minus가 온도를 움직이고 전원에게 브로드캐스트된다", async () => {
    server = await startTestServer();
    const a = await server.connect();
    const b = await server.connect();

    a.socket.emit("plus", "가온");
    const [seenByA, seenByB] = await Promise.all([
      once(a.socket, "tempChange"),
      once(b.socket, "tempChange"),
    ]);

    assert.equal(seenByA.temp, 19);
    assert.equal(seenByA.username, "가온");
    assert.equal(seenByA.changed, true);
    assert.equal(seenByA.direction, "up");
    // 누른 사람뿐 아니라 보고만 있는 사람에게도 똑같이 간다
    assert.deepEqual(seenByB, seenByA);

    a.socket.emit("minus", "가온");
    const down = await once(a.socket, "tempChange");
    assert.equal(down.temp, 18);
    assert.equal(down.direction, "down");
  });

  it("상한/하한을 넘지 않고 changed=false로 알린다", async () => {
    server = await startTestServer({ temperature: { min: 18, max: 20, initial: 20 } });
    const { socket } = await server.connect();

    socket.emit("plus", "clamp");
    const res = await once(socket, "tempChange");
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
        const [event, data] = await race(socket, ["tempChange", "blocked", "server-error"]);

        assert.equal(event, "tempChange", "rate limit이나 에러로 오해받으면 안 된다");
        assert.equal(data.username, "익명");
        assert.equal(data.temp, 19);
      });
    }
  });

  it("페이로드를 아예 안 보내도 처리한다", async () => {
    server = await startTestServer();
    const { socket } = await server.connect();
    socket.emit("plus");
    const [event, data] = await race(socket, ["tempChange", "blocked", "server-error"]);
    assert.equal(event, "tempChange");
    assert.equal(data.username, "익명");
  });

  it("이모지 닉네임이 깨지지 않고 잘린다", async () => {
    server = await startTestServer();
    const { socket } = await server.connect();
    socket.emit("plus", "👨‍👩‍👧‍👦🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉");
    const { username } = await once(socket, "tempChange");
    assert.ok(!username.includes("\uFFFD"), "surrogate pair가 반토막 나면 안 된다");
    assert.ok(username.startsWith("👨‍👩‍👧‍👦"));
  });

  it("빈 닉네임은 기본값으로 대체된다", async () => {
    server = await startTestServer();
    const { socket } = await server.connect();
    socket.emit("minus", "   ");
    const { username } = await once(socket, "tempChange");
    assert.equal(username, "익명");
  });

  describe("rate limit", () => {
    it("한도를 넘기면 blocked를 보내고 온도를 바꾸지 않는다", async () => {
      server = await startTestServer({
        rateLimit: { points: 2, durationSeconds: 60, blockSeconds: 60 },
      });
      const { socket } = await server.connect();

      for (let i = 0; i < 2; i++) {
        socket.emit("plus", "flood");
        await once(socket, "tempChange");
      }
      assert.equal(server.thermostat.value, 20);

      socket.emit("plus", "flood");
      const [event] = await race(socket, ["blocked", "tempChange"]);
      assert.equal(event, "blocked");
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
      const connectAs = async (fakeIp) => {
        const socket = createClient(server.url, {
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
      await once(first, "tempChange");

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
    await once(socket, "tempChange");

    await server.store.flush();
    const { readFile } = await import("node:fs/promises");
    const saved = JSON.parse(await readFile(`${server.stateDir}/state.json`, "utf8"));
    assert.equal(saved.temp, 19);
  });

  it("새로 접속한 사람은 바뀐 온도를 init으로 받는다", async () => {
    server = await startTestServer();
    const a = await server.connect();
    a.socket.emit("plus", "first");
    await once(a.socket, "tempChange");

    const b = await server.connect();
    assert.equal(b.init, 19);
  });
});
