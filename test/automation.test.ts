import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type BrowserScope, detectFrom } from "../src/client/automation.ts";
import { collectSignals, decide, reportedSignals } from "../src/server/automation.ts";
import {
  AUTOMATION_SIGNALS,
  automationReportSchema,
  signalsFromUserAgent,
} from "../src/shared/automation.ts";
import { CHALLENGE_REQUIRED, CONNECTION_BLOCKED } from "../src/shared/challenge.ts";
import { once, startTestServer } from "./helpers.ts";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function scope(overrides: Partial<BrowserScope> = {}): BrowserScope {
  return {
    webdriver: false,
    userAgent: CHROME_UA,
    windowKeys: ["document", "location", "navigator", "chrome", "fetch"],
    documentKeys: ["location", "title", "body"],
    webdriverAttribute: false,
    ...overrides,
  };
}

describe("브라우저에서 보는 자동화 흔적", () => {
  it("평범한 크롬에서는 아무것도 잡지 않는다", () => {
    assert.deepEqual(detectFrom(scope()), []);
  });

  it("사파리와 모바일 파이어폭스를 자동화로 몰지 않는다", () => {
    // 고전적인 판별법(plugins가 비었다, window.chrome이 없다)을 그대로 쓰면
    // 여기서 오탐이 난다. 그래서 그 검사들은 일부러 넣지 않았다.
    const safari = scope({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      windowKeys: ["document", "location", "navigator", "webkit"],
    });
    assert.deepEqual(detectFrom(safari), []);
  });

  it("navigator.webdriver가 켜져 있으면 잡는다", () => {
    assert.deepEqual(detectFrom(scope({ webdriver: true })), ["webdriver"]);
  });

  it("webdriver가 true가 아닌 값이면 잡지 않는다", () => {
    // 정확히 true일 때만이다. undefined도, 문자열 "false"도 아니다.
    for (const value of [undefined, false, 0, "", "false", null]) {
      assert.deepEqual(detectFrom(scope({ webdriver: value })), [], `webdriver=${String(value)}`);
    }
  });

  it("ChromeDriver가 document에 심는 $cdc_ 프로퍼티를 잡는다", () => {
    const found = detectFrom(
      scope({ documentKeys: ["location", "$cdc_asdjflasutopfhvcZLmcfl_", "body"] }),
    );
    assert.deepEqual(found, ["selenium"]);
  });

  it("요즘 ChromeDriver가 window에 심는 cdc_ 프로퍼티를 잡는다", () => {
    // msedgedriver 152를 실제로 붙여서 받아 적은 이름들이다. `$`가 없고
    // document가 아니라 window에 붙는다.
    const windowKeys = [
      "document",
      "cdc_adoQpoasnfa76pfcZLmcfl_Array",
      "cdc_adoQpoasnfa76pfcZLmcfl_Promise",
      "cdc_adoQpoasnfa76pfcZLmcfl_Window",
    ];
    assert.deepEqual(detectFrom(scope({ windowKeys })), ["selenium"]);
  });

  it("cdc_로 시작하지 않는 이름은 잡지 않는다", () => {
    // 접두사가 짧으므로 걸리는 범위를 못 박아 둔다.
    for (const key of ["cdcPlayer", "mycdc_x", "wdcount", "cd", "$cd"]) {
      assert.deepEqual(detectFrom(scope({ windowKeys: [key] })), [], key);
    }
  });

  it("<html webdriver> 속성을 잡는다", () => {
    assert.deepEqual(detectFrom(scope({ webdriverAttribute: true })), ["selenium"]);
  });

  it("playwright / puppeteer / 구형 하네스의 window 프로퍼티를 각각 잡는다", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["__playwright_target__", "playwright"],
      ["__pw_manual", "playwright"],
      ["__puppeteer_evaluation_script__", "puppeteer"],
      ["_phantom", "legacy-harness"],
      ["callPhantom", "legacy-harness"],
      ["__nightmare", "legacy-harness"],
      ["domAutomationController", "legacy-harness"],
      ["__selenium_unwrapped", "selenium"],
      ["__webdriver_evaluate", "selenium"],
    ];
    for (const [key, expected] of cases) {
      const found = detectFrom(scope({ windowKeys: ["document", key] }));
      assert.deepEqual(found, [expected], key);
    }
  });

  it("헤드리스 크롬 UA를 잡는다", () => {
    const ua = CHROME_UA.replace("Chrome/", "HeadlessChrome/");
    assert.deepEqual(detectFrom(scope({ userAgent: ua })), ["headless-ua"]);
  });

  it("흔적이 여럿이면 중복 없이 모두 돌려준다", () => {
    const found = detectFrom(
      scope({
        webdriver: true,
        webdriverAttribute: true, // selenium 이 두 경로로 잡힌다
        userAgent: CHROME_UA.replace("Chrome/", "HeadlessChrome/"),
        windowKeys: ["__playwright_target__", "__pw_manual"],
        documentKeys: ["$cdc_x"],
      }),
    );
    assert.deepEqual(
      new Set(found),
      new Set(["webdriver", "selenium", "headless-ua", "playwright"]),
    );
    assert.equal(found.length, new Set(found).size, "중복이 없어야 한다");
  });

  it("선언한 이름만 나온다", () => {
    const found = detectFrom(scope({ webdriver: true, windowKeys: ["_phantom", "__puppeteer_x"] }));
    for (const signal of found) assert.ok(AUTOMATION_SIGNALS.includes(signal), signal);
  });
});

describe("User-Agent에서 보는 흔적", () => {
  it("평범한 브라우저는 통과시킨다", () => {
    assert.deepEqual(signalsFromUserAgent(CHROME_UA), []);
  });

  it("UA가 없거나 비어 있으면 아무것도 잡지 않는다", () => {
    // 헤더가 없는 것 자체를 흔적으로 삼지 않는다. 정상 클라이언트도 프록시
    // 설정에 따라 UA가 지워져 올 수 있다.
    assert.deepEqual(signalsFromUserAgent(undefined), []);
    assert.deepEqual(signalsFromUserAgent(""), []);
  });

  it("도구 이름을 밝히는 UA를 잡는다", () => {
    for (const ua of [
      "curl/8.4.0",
      "python-requests/2.32.3",
      "Scrapy/2.11 (+https://scrapy.org)",
      "Go-http-client/2.0",
      "node-fetch/1.0",
      "Selenium/4.0",
    ]) {
      assert.deepEqual(signalsFromUserAgent(ua), ["tool-ua"], ua);
    }
  });

  it("헤드리스와 도구 이름이 함께 있으면 둘 다 잡는다", () => {
    const found = signalsFromUserAgent("HeadlessChrome/131.0 puppeteer/23.0");
    assert.deepEqual(new Set(found), new Set(["headless-ua", "tool-ua"]));
  });

  it("정직한 검색엔진 크롤러는 벌하지 않는다", () => {
    // robots.txt를 지키고 스스로를 밝히는 쪽을 막으면 밝힐 이유가 없어진다.
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    ]) {
      assert.deepEqual(signalsFromUserAgent(ua), [], ua);
    }
  });
});

describe("클라이언트 보고 해석", () => {
  it("정상 보고를 읽는다", () => {
    assert.deepEqual(reportedSignals({ automation: { signals: ["webdriver"] } }), ["webdriver"]);
  });

  it("없거나 형태가 틀리면 빈 목록으로 친다", () => {
    for (const auth of [
      undefined,
      null,
      "nope",
      42,
      {},
      { automation: null },
      { automation: { signals: "webdriver" } },
      { automation: { signals: [123] } },
      { automation: { signals: ["made-up-signal"] } },
    ]) {
      assert.deepEqual(reportedSignals(auth), [], JSON.stringify(auth) ?? "undefined");
    }
  });

  it("프로퍼티를 읽는 것만으로 던지는 auth에도 예외를 내보내지 않는다", () => {
    const hostile = Object.defineProperty({}, "automation", {
      get() {
        throw new Error("boom");
      },
    });
    assert.deepEqual(reportedSignals(hostile), []);
  });

  it("종류 수보다 긴 배열은 거절한다", () => {
    // 검증기가 긴 배열을 붙들고 있게 만드는 것 자체가 공격이 될 수 있다.
    const tooMany = Array.from({ length: 10_000 }, () => "webdriver");
    assert.equal(automationReportSchema.parse({ signals: tooMany }, "x").ok, false);
    assert.deepEqual(reportedSignals({ automation: { signals: tooMany } }), []);
  });

  it("보고와 UA를 합치되 중복은 없앤다", () => {
    const found = collectSignals({
      auth: { automation: { signals: ["webdriver", "headless-ua"] } },
      userAgent: "HeadlessChrome/131.0",
    });
    assert.deepEqual(new Set(found), new Set(["webdriver", "headless-ua"]));
    assert.equal(found.length, 2);
  });
});

describe("자동화 정책", () => {
  it("흔적이 없으면 아무 일도 없다", () => {
    assert.deepEqual(decide([], { points: 20, action: "block" }), { points: 0, action: "none" });
  });

  it("점수를 0으로 두면 정책과 무관하게 꺼진다", () => {
    // 스위치가 둘인데 하나만 끄고 왜 계속 막히냐고 헤매는 일이 없도록.
    assert.deepEqual(decide(["webdriver"], { points: 0, action: "block" }), {
      points: 0,
      action: "none",
    });
  });

  it("기본 정책에서는 점수만 올린다", () => {
    assert.deepEqual(decide(["webdriver"], { points: 20, action: "score" }), {
      points: 20,
      action: "score",
    });
  });

  it("정책을 올리면 챌린지와 차단으로 간다", () => {
    assert.equal(decide(["webdriver"], { points: 20, action: "challenge" }).action, "challenge");
    assert.equal(decide(["webdriver"], { points: 20, action: "block" }).action, "block");
  });
});

describe("자동화 감지 – 서버 통합", () => {
  const reporting = { automation: { signals: ["webdriver"] } };

  it("기본 설정에서는 흔적이 있어도 연결을 막지 않는다", async () => {
    // 이게 기본값인 이유: 흔적 하나로 사람을 막는 것보다, 점수를 올려 두고
    // 다른 행동과 합쳐질 때 판정하는 편이 오탐 비용이 훨씬 싸다.
    const server = await startTestServer({ guard: { enabled: true } });
    try {
      const { init } = await server.connect(reporting);
      assert.equal(typeof init.temp, "number");
    } finally {
      await server.stop();
    }
  });

  it("흔적을 남기면 의심 점수가 올라간다", async () => {
    const server = await startTestServer({
      guard: { enabled: true, automationPoints: 30 },
    });
    try {
      const clean = await startTestServer({ guard: { enabled: true } });
      try {
        await server.connect(reporting);
        await clean.connect();
        // 같은 행동을 했는데 흔적을 보고한 쪽의 점수가 더 높아야 한다.
        const flagged = await server.guard.score("127.0.0.1");
        const plain = await clean.guard.score("127.0.0.1");
        assert.ok(
          flagged.suspicion > plain.suspicion,
          `흔적 있음 ${flagged.suspicion} > 흔적 없음 ${plain.suspicion}`,
        );
      } finally {
        await clean.stop();
      }
    } finally {
      await server.stop();
    }
  });

  it("정책을 block으로 올리면 핸드셰이크에서 거부한다", async () => {
    const server = await startTestServer({
      guard: { enabled: true, automationAction: "block" },
    });
    try {
      const socket = server.dial(reporting);
      const error = await once<Error>(socket, "connect_error", 5000);
      assert.equal(error.message, CONNECTION_BLOCKED);
    } finally {
      await server.stop();
    }
  });

  it("정책을 challenge로 올리면 확인을 요구한다", async () => {
    const server = await startTestServer({
      guard: { enabled: true, automationAction: "challenge" },
    });
    try {
      const socket = server.dial(reporting);
      const error = await once<Error>(socket, "connect_error", 5000);
      assert.equal(error.message, CHALLENGE_REQUIRED);
    } finally {
      await server.stop();
    }
  });

  it("점수를 0으로 두면 정책이 block이어도 통과한다", async () => {
    const server = await startTestServer({
      guard: { enabled: true, automationPoints: 0, automationAction: "block" },
    });
    try {
      const { init } = await server.connect(reporting);
      assert.equal(typeof init.temp, "number");
    } finally {
      await server.stop();
    }
  });

  it("흔적이 없으면 block 정책에서도 통과한다", async () => {
    const server = await startTestServer({
      guard: { enabled: true, automationAction: "block" },
    });
    try {
      const { init } = await server.connect();
      assert.equal(typeof init.temp, "number");
    } finally {
      await server.stop();
    }
  });

  it("위조된 보고는 형태가 틀리면 조용히 무시된다", async () => {
    // 서버가 클라이언트 보고를 그대로 믿고 파싱하다 죽으면 안 된다.
    const server = await startTestServer({
      guard: { enabled: true, automationAction: "block" },
    });
    try {
      const { init } = await server.connect({ automation: { signals: ["nope", 1, null] } });
      assert.equal(typeof init.temp, "number");
    } finally {
      await server.stop();
    }
  });
});
