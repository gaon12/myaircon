import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import type { LightMyRequestResponse } from "fastify";
import { ChallengeIssuer, meetsDifficulty } from "../src/server/challenge.ts";
import { Guard, type GuardOptions } from "../src/server/guard.ts";
import { CHARACTER_COUNT, pickCharacter } from "../src/shared/characters.ts";
import { once, startTestServer, type TestServer } from "./helpers.ts";

const OPTIONS: GuardOptions = {
  maxConcurrentSockets: 4,
  handshakesPerMinute: 10,
  httpPerMinute: 20,
  adminFailureLimit: 3,
  adminLockSeconds: 60,
  challengeScore: 50,
  blockScore: 85,
};

describe("Guard", () => {
  describe("HTTP rate limit", () => {
    it("한도까지는 통과하고 넘으면 막는다", async () => {
      const guard = new Guard({ ...OPTIONS, httpPerMinute: 3 });
      for (let i = 0; i < 3; i++) {
        assert.equal(await guard.allowHttpRequest("1.1.1.1"), true, `${i + 1}번째`);
      }
      assert.equal(await guard.allowHttpRequest("1.1.1.1"), false);
      // 다른 주소는 영향을 받지 않는다
      assert.equal(await guard.allowHttpRequest("2.2.2.2"), true);
    });
  });

  describe("핸드셰이크 rate limit", () => {
    it("재접속 폭주를 막는다", async () => {
      const guard = new Guard({ ...OPTIONS, handshakesPerMinute: 2 });
      assert.equal(await guard.allowHandshake("1.1.1.1"), true);
      assert.equal(await guard.allowHandshake("1.1.1.1"), true);
      assert.equal(await guard.allowHandshake("1.1.1.1"), false);
    });
  });

  describe("동시 소켓 수", () => {
    it("상한을 넘으면 받지 않는다", () => {
      const guard = new Guard({ ...OPTIONS, maxConcurrentSockets: 2 });
      assert.equal(guard.openSocket("1.1.1.1"), true);
      assert.equal(guard.openSocket("1.1.1.1"), true);
      assert.equal(guard.openSocket("1.1.1.1"), false, "3번째는 거부");
      assert.equal(guard.concurrentSockets("1.1.1.1"), 2);
    });

    it("닫으면 자리가 난다", () => {
      const guard = new Guard({ ...OPTIONS, maxConcurrentSockets: 1 });
      assert.equal(guard.openSocket("1.1.1.1"), true);
      assert.equal(guard.openSocket("1.1.1.1"), false);
      guard.closeSocket("1.1.1.1");
      assert.equal(guard.concurrentSockets("1.1.1.1"), 0);
      assert.equal(guard.openSocket("1.1.1.1"), true);
    });

    it("주소마다 따로 센다", () => {
      const guard = new Guard({ ...OPTIONS, maxConcurrentSockets: 1 });
      assert.equal(guard.openSocket("1.1.1.1"), true);
      assert.equal(guard.openSocket("2.2.2.2"), true);
    });

    it("닫기를 더 많이 불러도 음수가 되지 않는다", () => {
      const guard = new Guard(OPTIONS);
      guard.closeSocket("1.1.1.1");
      guard.closeSocket("1.1.1.1");
      assert.equal(guard.concurrentSockets("1.1.1.1"), 0);
    });
  });

  describe("관리 토큰 잠금", () => {
    it("정해진 횟수를 틀리면 잠긴다", async () => {
      const guard = new Guard({ ...OPTIONS, adminFailureLimit: 3 });
      assert.equal(await guard.isAdminLocked("1.1.1.1"), false);
      for (let i = 0; i < 3; i++) await guard.noteAdminFailure("1.1.1.1");
      assert.equal(await guard.isAdminLocked("1.1.1.1"), true);
    });

    it("성공하면 카운터가 지워진다", async () => {
      const guard = new Guard({ ...OPTIONS, adminFailureLimit: 3 });
      for (let i = 0; i < 2; i++) await guard.noteAdminFailure("1.1.1.1");
      await guard.clearAdminFailures("1.1.1.1");
      for (let i = 0; i < 2; i++) await guard.noteAdminFailure("1.1.1.1");
      assert.equal(await guard.isAdminLocked("1.1.1.1"), false, "다시 처음부터 센다");
    });
  });

  describe("점수", () => {
    it("아무것도 안 한 주소는 0점이고 통과다", async () => {
      const guard = new Guard(OPTIONS);
      const score = await guard.score("1.1.1.1");
      assert.equal(score.total, 0);
      assert.equal(score.verdict, "allow");
    });

    it("동시 연결이 늘면 점수가 오른다", async () => {
      const guard = new Guard({ ...OPTIONS, maxConcurrentSockets: 4 });
      const before = (await guard.score("1.1.1.1")).concurrent;
      guard.openSocket("1.1.1.1");
      guard.openSocket("1.1.1.1");
      const after = await guard.score("1.1.1.1");
      assert.ok(after.concurrent > before);
      assert.equal(after.concurrent, 20, "4개 중 2개 = 비중 40의 절반");
    });

    it("재접속이 잦으면 점수가 오른다", async () => {
      const guard = new Guard({ ...OPTIONS, handshakesPerMinute: 10 });
      for (let i = 0; i < 5; i++) await guard.allowHandshake("1.1.1.1");
      const score = await guard.score("1.1.1.1");
      assert.equal(score.handshakes, 15, "10회 중 5회 = 비중 30의 절반");
    });

    it("의심 이력이 쌓이면 점수가 오르고 상한을 넘지 않는다", async () => {
      const guard = new Guard(OPTIONS);
      guard.noteSuspicious("1.1.1.1", 15);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal((await guard.score("1.1.1.1")).suspicion, 15);

      guard.noteSuspicious("1.1.1.1", 100);
      await new Promise((r) => setTimeout(r, 10));
      assert.ok((await guard.score("1.1.1.1")).suspicion <= 30);
    });

    it("여러 신호가 겹치면 챌린지 구간에 들어간다", async () => {
      const guard = new Guard(OPTIONS);
      // 소켓 4/4 = 40점
      for (let i = 0; i < 4; i++) guard.openSocket("1.1.1.1");
      // 핸드셰이크 5/10 = 15점  -> 합계 55
      for (let i = 0; i < 5; i++) await guard.allowHandshake("1.1.1.1");
      const score = await guard.score("1.1.1.1");
      assert.ok(score.total >= OPTIONS.challengeScore, `총점 ${score.total}`);
      assert.equal(score.verdict, "challenge");
    });

    it("한계까지 가면 차단 구간이다", async () => {
      const guard = new Guard(OPTIONS);
      for (let i = 0; i < 4; i++) guard.openSocket("1.1.1.1");
      for (let i = 0; i < 20; i++) await guard.allowHandshake("1.1.1.1");
      guard.noteSuspicious("1.1.1.1", 30);
      await new Promise((r) => setTimeout(r, 10));
      const score = await guard.score("1.1.1.1");
      assert.equal(score.verdict, "block", `총점 ${score.total}`);
    });

    it("판정 경계가 설정을 따른다", () => {
      const guard = new Guard({ ...OPTIONS, challengeScore: 30, blockScore: 60 });
      assert.equal(guard.verdictFor(29), "allow");
      assert.equal(guard.verdictFor(30), "challenge");
      assert.equal(guard.verdictFor(59), "challenge");
      assert.equal(guard.verdictFor(60), "block");
    });
  });
});

describe("작업증명 챌린지", () => {
  const issuer = new ChallengeIssuer({
    secret: "challenge-secret-long-enough",
    difficulty: 10,
    ttlSeconds: 120,
    tokenTtlSeconds: 600,
  });

  /** 서버가 낸 문제를 실제로 푼다. */
  const solve = (nonce: string, difficulty: number): string => {
    for (let attempt = 1; ; attempt++) {
      const hash = createHash("sha256")
        .update(nonce + attempt)
        .digest();
      if (meetsDifficulty(hash, difficulty)) return String(attempt);
    }
  };

  it("meetsDifficulty가 앞 비트를 정확히 센다", () => {
    assert.equal(meetsDifficulty(Buffer.from([0x00, 0x00, 0xff]), 16), true);
    assert.equal(meetsDifficulty(Buffer.from([0x00, 0x01, 0x00]), 16), false);
    assert.equal(meetsDifficulty(Buffer.from([0x00, 0x0f]), 12), true);
    assert.equal(meetsDifficulty(Buffer.from([0x00, 0x1f]), 12), false);
    assert.equal(meetsDifficulty(Buffer.from([0xff]), 0), true);
  });

  it("바르게 푼 답에 토큰을 준다", () => {
    const challenge = issuer.issue();
    const answer = solve(challenge.nonce, challenge.difficulty);
    const token = issuer.verify({ ...challenge, answer });
    assert.ok(token !== null);
    assert.equal(issuer.isTokenValid(token), true);
  });

  it("틀린 답은 거부한다", () => {
    const challenge = issuer.issue();
    assert.equal(issuer.verify({ ...challenge, answer: "definitely-wrong" }), null);
  });

  it("서명을 위조한 챌린지는 거부한다", () => {
    const challenge = issuer.issue();
    const answer = solve(challenge.nonce, challenge.difficulty);
    assert.equal(issuer.verify({ ...challenge, signature: "0".repeat(64), answer }), null);
  });

  it("난이도를 낮춰서 보내도 거부한다", () => {
    // 서명이 난이도까지 포함하므로 값만 바꾸면 서명이 깨진다.
    const challenge = issuer.issue();
    assert.equal(issuer.verify({ ...challenge, difficulty: 1, answer: "1" }), null);
  });

  it("만료된 챌린지는 거부한다", () => {
    const now = Date.now();
    const challenge = issuer.issue(now);
    const answer = solve(challenge.nonce, challenge.difficulty);
    assert.equal(issuer.verify({ ...challenge, answer }, now + 121_000), null);
  });

  it("토큰은 유효 기간이 지나면 무효다", () => {
    const now = Date.now();
    const challenge = issuer.issue(now);
    const answer = solve(challenge.nonce, challenge.difficulty);
    const token = issuer.verify({ ...challenge, answer }, now);
    assert.equal(issuer.isTokenValid(token, now + 599_000), true);
    assert.equal(issuer.isTokenValid(token, now + 601_000), false);
  });

  it("위조 토큰과 이상한 값을 거부한다", () => {
    for (const bad of ["", "abc", "9999999999999.deadbeef", null, undefined, 42, {}]) {
      assert.equal(issuer.isTokenValid(bad), false, String(bad));
    }
  });

  it("비밀키가 다르면 서로의 토큰을 인정하지 않는다", () => {
    const other = new ChallengeIssuer({
      secret: "a-completely-different-secret",
      difficulty: 10,
      ttlSeconds: 120,
      tokenTtlSeconds: 600,
    });
    const challenge = issuer.issue();
    const answer = solve(challenge.nonce, challenge.difficulty);
    const token = issuer.verify({ ...challenge, answer });
    assert.equal(other.isTokenValid(token), false);
  });
});

describe("서버에 붙은 방어", () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it("HTTP 한도를 넘으면 429", async () => {
    server = await startTestServer({ guard: { httpPerMinute: 5 } });
    let last = 200;
    for (let i = 0; i < 8; i++) {
      last = (await server.app.inject({ method: "GET", url: "/healthz" })).statusCode;
    }
    assert.equal(last, 429);
  });

  it("429 응답에 Retry-After가 붙는다", async () => {
    server = await startTestServer({ guard: { httpPerMinute: 1 } });
    await server.app.inject({ method: "GET", url: "/healthz" });
    const res = await server.app.inject({ method: "GET", url: "/healthz" });
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers["retry-after"], "60");
  });

  it("GUARD_ENABLED=false면 HTTP 제한이 없다", async () => {
    server = await startTestServer({ guard: { enabled: false, httpPerMinute: 1 } });
    for (let i = 0; i < 10; i++) {
      const res: LightMyRequestResponse = await server.app.inject({
        method: "GET",
        url: "/healthz",
      });
      assert.equal(res.statusCode, 200);
    }
  });

  it("한 주소가 소켓을 무한정 열 수 없다", async () => {
    server = await startTestServer({ guard: { maxConcurrentSockets: 2 } });
    await server.connect();
    await server.connect();
    await assert.rejects(
      () => server?.connect() ?? Promise.reject(new Error("no server")),
      /blocked|이벤트를/,
      "3번째 연결은 거부돼야 한다",
    );
  });

  it("소켓을 닫으면 다시 열 수 있다", async () => {
    server = await startTestServer({ guard: { maxConcurrentSockets: 1 } });
    const first = await server.connect();
    first.socket.close();
    await new Promise((r) => setTimeout(r, 300));
    const second = await server.connect();
    assert.ok(second.init.temp >= 18);
  });

  it("챌린지를 발급하고 검증한다", async () => {
    server = await startTestServer({ challenge: { difficulty: 8 } });
    const issued = (await server.app.inject({ method: "GET", url: "/api/challenge" })).json();
    assert.equal(issued.difficulty, 8);

    let answer = "";
    for (let attempt = 1; ; attempt++) {
      const hash = createHash("sha256")
        .update(issued.nonce + attempt)
        .digest();
      if (meetsDifficulty(hash, issued.difficulty)) {
        answer = String(attempt);
        break;
      }
    }

    const verified = await server.app.inject({
      method: "POST",
      url: "/api/verify",
      payload: { ...issued, answer },
    });
    assert.equal(verified.statusCode, 200);
    assert.ok(typeof verified.json().token === "string");
  });

  it("틀린 답은 400", async () => {
    server = await startTestServer({ challenge: { difficulty: 8 } });
    const issued = (await server.app.inject({ method: "GET", url: "/api/challenge" })).json();
    const res = await server.app.inject({
      method: "POST",
      url: "/api/verify",
      payload: { ...issued, answer: "nope" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("관리 토큰을 반복해서 틀리면 429로 잠긴다", async () => {
    server = await startTestServer({
      admin: { token: "admin-token-long-enough-1234" },
      guard: { adminFailureLimit: 3 },
    });
    const wrong = { authorization: "Bearer wrong-token-long-enough-x" };
    for (let i = 0; i < 3; i++) {
      const res: LightMyRequestResponse = await server.app.inject({
        method: "GET",
        url: "/api/admin/overview",
        headers: wrong,
      });
      assert.equal(res.statusCode, 401, `${i + 1}번째는 401`);
    }
    const locked = await server.app.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: wrong,
    });
    assert.equal(locked.statusCode, 429);

    // 잠긴 동안에는 올바른 토큰도 막힌다(무차별 대입 중이라는 뜻이므로)
    const correct = await server.app.inject({
      method: "GET",
      url: "/api/admin/overview",
      headers: { authorization: "Bearer admin-token-long-enough-1234" },
    });
    assert.equal(correct.statusCode, 429);
  });

  it("정상 조절은 방어에 걸리지 않는다", async () => {
    // 평범한 사용자가 버튼 몇 번 누르는 것으로 챌린지가 뜨면 안 된다.
    server = await startTestServer();
    const { socket } = await server.connect();
    for (let i = 0; i < 3; i++) {
      socket.emit("plus", "가온");
      await once(socket, "tempChange");
      await new Promise((r) => setTimeout(r, 220));
    }
    const score = await server.guard.score("127.0.0.1");
    assert.equal(score.verdict, "allow", `총점 ${score.total}`);
  });
});

describe("확인 화면 캐릭터", () => {
  it("1~3 사이의 번호를 고른다", () => {
    for (let i = 0; i < 200; i++) {
      const picked = pickCharacter();
      assert.ok(
        Number.isInteger(picked) && picked >= 1 && picked <= CHARACTER_COUNT,
        String(picked),
      );
    }
  });

  it("난수 경계를 정확히 나눈다", () => {
    assert.equal(
      pickCharacter(() => 0),
      1,
    );
    assert.equal(
      pickCharacter(() => 0.33),
      1,
    );
    assert.equal(
      pickCharacter(() => 0.34),
      2,
    );
    assert.equal(
      pickCharacter(() => 0.67),
      3,
    );
    // Math.random()은 1을 돌려주지 않지만, 1에 아주 가까운 값에서도 범위를 넘지 않아야 한다
    assert.equal(
      pickCharacter(() => 0.999999),
      CHARACTER_COUNT,
    );
  });

  it("여러 번 고르면 세 캐릭터가 모두 나온다", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(pickCharacter());
    assert.equal(seen.size, CHARACTER_COUNT, `나온 캐릭터: ${[...seen].sort().join(", ")}`);
  });

  it("캐릭터마다 scan/catch 이미지가 실제로 있다", async () => {
    const { access } = await import("node:fs/promises");
    const path = await import("node:path");
    const root = path.join(import.meta.dirname, "..", "public", "img");
    for (let n = 1; n <= CHARACTER_COUNT; n++) {
      for (const pose of ["scan", "catch"]) {
        await access(path.join(root, `${pose}_${n}.png`));
      }
    }
  });
});
