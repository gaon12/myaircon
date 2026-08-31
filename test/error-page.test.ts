import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { type AppContext, buildApp, closeApp } from "../src/server/app.ts";
import { config as baseConfig } from "../src/server/config.ts";
import {
  escapeHtml,
  parseAcceptLanguage,
  pickErrorLocale,
  renderErrorPage,
  wantsHtml,
} from "../src/server/error-page.ts";
import { CHARACTER_COUNT } from "../src/shared/characters.ts";
import { startTestServer, type TestServer } from "./helpers.ts";

const HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

describe("parseAcceptLanguage", () => {
  it("q값 순서대로 정렬한다", () => {
    assert.deepEqual(parseAcceptLanguage("ko;q=0.1,en;q=0.9,ja;q=0.5"), ["en", "ja", "ko"]);
  });

  it("q가 없으면 1.0으로 보고, 같으면 적힌 순서를 지킨다", () => {
    assert.deepEqual(parseAcceptLanguage("ko-KR,ko;q=0.9,en-US,en;q=0.8"), [
      "ko-KR",
      "en-US",
      "ko",
      "en",
    ]);
  });

  it("q=0은 거부이므로 뺀다", () => {
    assert.deepEqual(parseAcceptLanguage("ko;q=0,en"), ["en"]);
  });

  it("와일드카드와 빈 값은 무시한다", () => {
    assert.deepEqual(parseAcceptLanguage("*,  ,en"), ["en"]);
  });

  it("헤더가 없거나 비었으면 빈 목록이다", () => {
    assert.deepEqual(parseAcceptLanguage(undefined), []);
    assert.deepEqual(parseAcceptLanguage(""), []);
  });

  it("아무 문자열이 와도 던지지 않는다", () => {
    // 헤더는 누구나 보낼 수 있다. 여기서 던지면 오류 화면을 만들다 또 터진다.
    for (const bad of [";;;", "q=1", "en;q=abc", "en;q=", ",,,", "🙂"]) {
      assert.doesNotThrow(() => parseAcceptLanguage(bad), bad);
    }
  });

  it("태그 수를 제한한다", () => {
    // 태그 수천 개짜리 헤더로 정렬을 시키는 것 자체가 공격이 될 수 있다.
    const header = Array.from({ length: 500 }, (_, i) => `x${i}`).join(",");
    assert.ok(parseAcceptLanguage(header).length <= 20);
  });
});

describe("pickErrorLocale", () => {
  it("앱과 같은 규칙으로 협상한다", () => {
    assert.equal(pickErrorLocale("ko-KR,ko;q=0.9"), "ko");
    assert.equal(pickErrorLocale("ja"), "ja");
    assert.equal(pickErrorLocale("zh-TW"), "zh-Hant");
    assert.equal(pickErrorLocale("zh-CN"), "zh-Hans");
  });

  it("q값이 앞뒤 순서를 뒤집는다", () => {
    assert.equal(pickErrorLocale("ko;q=0.1,en;q=0.9"), "en");
  });

  it("가진 언어가 없으면 영어로 떨어진다", () => {
    assert.equal(pickErrorLocale("fr-FR,de;q=0.9"), "en");
    assert.equal(pickErrorLocale(undefined), "en");
  });
});

describe("wantsHtml", () => {
  it("브라우저에게만 HTML을 준다", () => {
    assert.equal(wantsHtml({ url: "/nope", accept: HTML_ACCEPT }), true);
  });

  it("Accept가 없거나 와일드카드뿐이면 JSON이다", () => {
    // curl의 기본값이 */* 이다. 여기를 HTML로 치면 스크립트와 가동 감시가
    // 전부 HTML을 받게 된다.
    assert.equal(wantsHtml({ url: "/nope", accept: undefined }), false);
    assert.equal(wantsHtml({ url: "/nope", accept: "*/*" }), false);
    assert.equal(wantsHtml({ url: "/nope", accept: "application/json" }), false);
  });

  it("/api/* 는 브라우저가 물어도 JSON이다", () => {
    // 앱 자신이 fetch로 부르는 경로다. HTML을 돌려주면 조용히 깨진다.
    assert.equal(wantsHtml({ url: "/api/nope", accept: HTML_ACCEPT }), false);
    assert.equal(wantsHtml({ url: "/api/stats", accept: HTML_ACCEPT }), false);
  });

  it("경로에 api가 들어 있을 뿐이면 HTML이다", () => {
    assert.equal(wantsHtml({ url: "/apiary", accept: HTML_ACCEPT }), true);
    assert.equal(wantsHtml({ url: "/x/api/y", accept: HTML_ACCEPT }), true);
  });
});

describe("escapeHtml", () => {
  it("태그와 따옴표를 막는다", () => {
    assert.equal(
      escapeHtml(`<script>alert("x")</script>&'`),
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;",
    );
  });

  it("& 를 먼저 바꾼다", () => {
    // 순서가 틀리면 &lt; 가 &amp;lt; 로 두 번 이스케이프된다.
    assert.equal(escapeHtml("<"), "&lt;");
  });
});

describe("renderErrorPage", () => {
  it("상태 코드마다 다른 제목을 쓴다", () => {
    const titles = [404, 429, 500, 400].map((status) => {
      const match = /<h1>([^<]*)<\/h1>/.exec(renderErrorPage({ status, acceptLanguage: "en" }));
      return match?.[1] ?? "";
    });
    assert.equal(new Set(titles).size, 4, titles.join(" / "));
  });

  it("5xx는 전부 같은 문구다", () => {
    const page = (status: number) => renderErrorPage({ status, acceptLanguage: "en" });
    assert.equal(
      /<h1>([^<]*)<\/h1>/.exec(page(500))?.[1],
      /<h1>([^<]*)<\/h1>/.exec(page(503))?.[1],
    );
  });

  it("lang 속성이 협상 결과와 맞는다", () => {
    assert.match(renderErrorPage({ status: 404, acceptLanguage: "ja" }), /<html lang="ja">/);
    assert.match(
      renderErrorPage({ status: 404, acceptLanguage: "zh-HK" }),
      /<html lang="zh-Hant">/,
    );
  });

  it("캐릭터를 무작위로 고르고 catch 포즈를 쓴다", () => {
    for (let n = 1; n <= CHARACTER_COUNT; n++) {
      const page = renderErrorPage({ status: 404, random: () => (n - 1) / CHARACTER_COUNT });
      assert.match(page, new RegExp(`/img/catch_${n}\\.png`));
    }
  });

  it("검색엔진에 색인되지 않게 한다", () => {
    assert.match(renderErrorPage({ status: 404 }), /<meta name="robots" content="noindex" \/>/);
  });

  it("인라인 스크립트가 없다", () => {
    // CSP가 script-src 'self' 라 인라인은 실행되지 않는다. 넣어 두면 조용히
    // 죽는 코드가 되므로 아예 없어야 한다.
    assert.doesNotMatch(renderErrorPage({ status: 500 }), /<script/i);
    assert.doesNotMatch(renderErrorPage({ status: 500 }), /\son[a-z]+=/i);
  });

  it("모든 언어에서 문구가 비어 있지 않다", () => {
    for (const lang of ["ko", "en", "ja", "zh-Hans", "zh-Hant"]) {
      const page = renderErrorPage({ status: 404, acceptLanguage: lang });
      assert.match(page, new RegExp(`<html lang="${lang}">`));
      const title = /<h1>([^<]*)<\/h1>/.exec(page)?.[1] ?? "";
      assert.ok(title.trim().length > 0, `${lang}: 제목이 비었다`);
      assert.doesNotMatch(page, /undefined/, lang);
    }
  });
});

describe("오류 응답 (서버)", () => {
  let server: TestServer | undefined;
  let bare: AppContext | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    if (bare !== undefined) await closeApp(bare);
    bare = undefined;
  });

  const start = async () => {
    server = await startTestServer();
    return server;
  };

  /**
   * listen 하지 않은 앱. inject만 쓸 것이고, 무엇보다 **라우트를 더 붙일 수
   * 있다** -- startTestServer는 이미 listen한 뒤라 라우트 추가가 거부된다.
   * 500 경로를 시험하려면 일부러 터지는 라우트가 하나 필요하다.
   */
  const startBare = async (): Promise<AppContext> => {
    bare = await buildApp({
      logger: false,
      config: {
        ...baseConfig,
        persistenceEnabled: false,
        stats: { ...baseConfig.stats, file: ":memory:" },
        admin: { ...baseConfig.admin, banFile: ":memory:" },
      },
    });
    return bare;
  };

  it("브라우저에게는 404 화면을 준다", async () => {
    const s = await start();
    const res = await s.app.inject({
      method: "GET",
      url: "/nope",
      headers: { accept: "text/html" },
    });
    assert.equal(res.statusCode, 404);
    assert.match(res.headers["content-type"] as string, /text\/html/);
    assert.match(res.body, /class="error-page"/);
    assert.match(res.body, /404/);
  });

  it("그 외에는 JSON을 유지한다", async () => {
    const s = await start();
    const res = await s.app.inject({ method: "GET", url: "/nope" });
    assert.equal(res.statusCode, 404);
    assert.match(res.headers["content-type"] as string, /application\/json/);
    assert.deepEqual(res.json(), { error: "not_found", statusCode: 404 });
  });

  it("/api/* 는 브라우저가 물어도 JSON이다", async () => {
    const s = await start();
    const res = await s.app.inject({
      method: "GET",
      url: "/api/nope",
      headers: { accept: "text/html" },
    });
    assert.equal(res.statusCode, 404);
    assert.match(res.headers["content-type"] as string, /application\/json/);
  });

  it("없는 정적 파일도 같은 화면으로 간다", async () => {
    const s = await start();
    const res = await s.app.inject({
      method: "GET",
      url: "/img/없는파일.png",
      headers: { accept: "text/html" },
    });
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /class="error-page"/);
  });

  it("요청 경로를 화면에 되비추지 않는다", async () => {
    // Fastify 기본 404 메시지는 경로를 그대로 담는다. 그걸 HTML에 넣으면
    // 그 자체로 XSS다.
    const s = await start();
    const res = await s.app.inject({
      method: "GET",
      url: "/%3Cscript%3Ealert(1)%3C/script%3E",
      headers: { accept: "text/html" },
    });
    assert.equal(res.statusCode, 404);
    assert.doesNotMatch(res.body, /<script/i);
    assert.doesNotMatch(res.body, /alert\(1\)/);
  });

  it("500이 나도 내부 사정을 밝히지 않는다", async () => {
    const s = await startBare();
    s.app.get("/boom", async () => {
      throw new Error("데이터베이스 비밀번호가 틀렸습니다");
    });

    const html = await s.app.inject({
      method: "GET",
      url: "/boom",
      headers: { accept: "text/html" },
    });
    assert.equal(html.statusCode, 500);
    assert.doesNotMatch(html.body, /비밀번호/);
    assert.doesNotMatch(html.body, /Error:/);

    const json = await s.app.inject({ method: "GET", url: "/boom" });
    assert.equal(json.statusCode, 500);
    assert.deepEqual(json.json(), { error: "internal_error", statusCode: 500 });
  });

  it("던져진 4xx는 그 코드를 그대로 살린다", async () => {
    const s = await startBare();
    s.app.get("/nope4", async () => {
      throw Object.assign(new Error("nope"), { statusCode: 403 });
    });

    const res = await s.app.inject({ method: "GET", url: "/nope4" });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.json(), { error: "bad_request", statusCode: 403 });
  });

  it("이상한 statusCode가 달려 오면 500으로 본다", async () => {
    const s = await startBare();
    s.app.get("/weird", async () => {
      throw Object.assign(new Error("x"), { statusCode: 42 });
    });

    const res = await s.app.inject({ method: "GET", url: "/weird" });
    assert.equal(res.statusCode, 500);
  });

  it("rate limit에 걸린 브라우저도 화면을 본다", async () => {
    server = await startTestServer({ guard: { enabled: true, httpPerMinute: 3 } });
    const s = server;
    for (let i = 0; i < 3; i++) await s.app.inject({ method: "GET", url: "/healthz" });

    const res = await s.app.inject({
      method: "GET",
      url: "/healthz",
      headers: { accept: "text/html" },
    });
    assert.equal(res.statusCode, 429);
    assert.equal(res.headers["retry-after"], "60");
    assert.match(res.body, /class="error-page"/);
    assert.match(res.body, /429/);
  });

  it("오류 화면에도 보안 헤더가 그대로 붙는다", async () => {
    const s = await start();
    const res = await s.app.inject({
      method: "GET",
      url: "/nope",
      headers: { accept: "text/html" },
    });
    assert.ok(res.headers["content-security-policy"]);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
  });

  it("화면이 참조하는 자원은 CSP가 허용하는 같은 출처뿐이다", async () => {
    const s = await start();
    const res = await s.app.inject({
      method: "GET",
      url: "/nope",
      headers: { accept: "text/html" },
    });
    for (const [, url] of res.body.matchAll(/(?:href|src)="([^"]+)"/g)) {
      assert.ok(url?.startsWith("/"), `외부 출처: ${url}`);
    }
  });
});
