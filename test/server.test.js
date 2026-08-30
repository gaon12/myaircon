import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { buildApp, closeApp } from "../src/app.js";
import { config as baseConfig } from "../src/config.js";

describe("HTTP 서버", () => {
  let context;
  let app;

  before(async () => {
    context = await buildApp({
      config: { ...baseConfig, persistenceEnabled: false },
      logger: false,
    });
    app = context.app;
    await app.ready();
  });

  after(async () => {
    await closeApp(context);
  });

  it("GET / 이 index.html을 준다", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.body, /<title>/i);
  });

  it("정적 파일을 서빙한다", async () => {
    const res = await app.inject({ method: "GET", url: "/aircon0.png" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/png");
  });

  it("GET /healthz 가 현재 온도와 범위를 보고한다", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.status, "ok");
    assert.equal(body.temp, context.thermostat.value);
    assert.equal(body.min, 18);
    assert.equal(body.max, 30);
    assert.equal(typeof body.uptimeSeconds, "number");
  });

  it("없는 경로는 404", async () => {
    const res = await app.inject({ method: "GET", url: "/nope" });
    assert.equal(res.statusCode, 404);
  });

  describe("보안 헤더", () => {
    it("모든 응답에 붙는다 (404 포함)", async () => {
      for (const url of ["/", "/aircon0.png", "/healthz", "/nope"]) {
        const res = await app.inject({ method: "GET", url });
        assert.ok(res.headers["content-security-policy"], `${url}: CSP 누락`);
        assert.equal(res.headers["x-content-type-options"], "nosniff", `${url}`);
        assert.equal(res.headers["x-frame-options"], "DENY", `${url}`);
        assert.equal(res.headers["referrer-policy"], "no-referrer", `${url}`);
        assert.equal(res.headers["cross-origin-opener-policy"], "same-origin", `${url}`);
      }
    });

    it("CSP가 외부 출처를 허용하지 않는다", async () => {
      const csp = (await app.inject({ method: "GET", url: "/" })).headers[
        "content-security-policy"
      ];
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /object-src 'none'/);
      assert.doesNotMatch(csp, /unsafe-eval/);
      assert.doesNotMatch(csp, /https?:\/\//, "외부 출처를 허용하면 안 된다");
    });

    // 인라인 <script>/<style>을 외부 파일로 분리하는 UI 커밋에서 통과하게 된다.
    it("'unsafe-inline'이 없다", {
      todo: "마크업에서 인라인 스크립트/스타일 제거 후 활성화",
    }, async () => {
      const csp = (await app.inject({ method: "GET", url: "/" })).headers[
        "content-security-policy"
      ];
      assert.doesNotMatch(csp, /unsafe-inline/);
    });

    it("HSTS는 기본으로 꺼져 있다 (로컬 http 개발을 망가뜨리지 않도록)", async () => {
      const res = await app.inject({ method: "GET", url: "/" });
      assert.equal(res.headers["strict-transport-security"], undefined);
    });
  });

  // CDN을 걷어내고 클라이언트 번들을 직접 서빙하는 커밋에서 통과하게 된다.
  it("HTML에 CDN 스크립트가 남아 있지 않다", { todo: "CDN 제거 커밋에서 활성화" }, async () => {
    // CSP가 외부 출처를 막고 있으므로 CDN 태그가 남으면 페이지가 조용히 깨진다.
    const html = await readFile(path.join(baseConfig.publicDir, "index.html"), "utf8");
    const externalSrc = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi)];
    assert.deepEqual(
      externalSrc.map((m) => m[0]),
      [],
      "외부 출처 참조가 남아 있으면 CSP에 막힌다",
    );
  });
});

describe("HSTS 설정", () => {
  it("HSTS_MAX_AGE를 켜면 헤더가 붙는다", async () => {
    const context = await buildApp({
      config: {
        ...baseConfig,
        persistenceEnabled: false,
        security: { ...baseConfig.security, hstsMaxAge: 31_536_000 },
      },
      logger: false,
    });
    await context.app.ready();
    const res = await context.app.inject({ method: "GET", url: "/" });
    assert.equal(res.headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
    await closeApp(context);
  });
});

describe("저장된 상태 복원", () => {
  it("state.json의 온도로 시작한다", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "myaircon-boot-"));
    const stateFile = path.join(dir, "state.json");
    await writeFile(stateFile, JSON.stringify({ temp: 26 }), "utf8");

    const context = await buildApp({ config: { ...baseConfig, stateFile }, logger: false });
    assert.equal(context.thermostat.value, 26, "재시작해도 온도가 18로 리셋되면 안 된다");
    await closeApp(context);
    await rm(dir, { recursive: true, force: true });
  });

  it("범위를 벗어난 저장값은 클램프한다", async () => {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(path.join(tmpdir(), "myaircon-boot-"));
    const stateFile = path.join(dir, "state.json");
    await writeFile(stateFile, JSON.stringify({ temp: 9999 }), "utf8");

    const context = await buildApp({ config: { ...baseConfig, stateFile }, logger: false });
    assert.equal(context.thermostat.value, 30);
    await closeApp(context);
    await rm(dir, { recursive: true, force: true });
  });
});
