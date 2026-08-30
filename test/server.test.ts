import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { type AppContext, buildApp, closeApp } from "../src/server/app.ts";
import { config as baseConfig } from "../src/server/config.ts";

/** 헤더 값은 string | string[] | undefined 다. 단언에 쓰기 좋게 문자열로 만든다. */
const header = (res: LightMyRequestResponse, name: string): string => String(res.headers[name]);

describe("HTTP 서버", () => {
  let context: AppContext;
  let app: FastifyInstance;

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
    assert.match(header(res, "content-type"), /text\/html/);
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
        assert.equal(header(res, "x-content-type-options"), "nosniff", `${url}`);
        assert.equal(header(res, "x-frame-options"), "DENY", `${url}`);
        assert.equal(header(res, "referrer-policy"), "no-referrer", `${url}`);
        assert.equal(header(res, "cross-origin-opener-policy"), "same-origin", `${url}`);
      }
    });

    it("CSP가 외부 출처를 허용하지 않는다", async () => {
      const csp = header(await app.inject({ method: "GET", url: "/" }), "content-security-policy");
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'/);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /object-src 'none'/);
      assert.doesNotMatch(csp, /unsafe-eval/);
      assert.doesNotMatch(csp, /https?:\/\//, "외부 출처를 허용하면 안 된다");
    });

    it("'unsafe-inline'이 없다", async () => {
      const csp = header(await app.inject({ method: "GET", url: "/" }), "content-security-policy");
      assert.doesNotMatch(csp, /unsafe-inline/);
    });

    it("HSTS는 기본으로 꺼져 있다 (로컬 http 개발을 망가뜨리지 않도록)", async () => {
      const res = await app.inject({ method: "GET", url: "/" });
      assert.equal(res.headers["strict-transport-security"], undefined);
    });
  });

  it("HTML에 CDN 스크립트가 남아 있지 않다", async () => {
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

describe("socket.io 클라이언트 자체 서빙 (CDN 제거)", () => {
  let context: AppContext;

  before(async () => {
    context = await buildApp({
      config: { ...baseConfig, persistenceEnabled: false },
      logger: false,
    });
    await context.app.ready();
  });

  after(async () => {
    await closeApp(context);
  });

  it("/vendor/socket.io/ 에서 ESM 번들을 내려준다", async () => {
    const res = await context.app.inject({
      method: "GET",
      url: "/vendor/socket.io/socket.io.esm.min.js",
    });
    assert.equal(res.statusCode, 200);
    assert.match(header(res, "content-type"), /javascript/);
    assert.ok(res.body.length > 10_000, "번들이 비어 있으면 안 된다");
    assert.match(res.body, /as io\b/, "io export가 있어야 한다");
  });

  it("클라이언트가 그 경로를 그대로 import 한다", async () => {
    // 빌드 산출물이 아니라 TypeScript 소스를 읽는다. 테스트는 빌드 없이도
    // 돌아야 하고(Node가 .ts를 직접 실행한다), tsc는 이 지정자를 상대 경로가
    // 아니라서 그대로 내보내므로 소스와 산출물이 같다.
    const source = await readFile(
      path.join(import.meta.dirname, "..", "src", "client", "socket.ts"),
      "utf8",
    );
    const specifier = /from\s+["'](?<path>[^"']+socket\.io[^"']*)["']/.exec(source)?.groups?.path;
    assert.ok(specifier, "socket.io import를 찾지 못했다");

    // 실제로 서버가 그 경로를 서빙하는지 확인한다. 오타가 나면 CSP에 막혀
    // 조용히 죽기 때문에 경로를 문자열로만 두면 안 된다.
    const res = await context.app.inject({ method: "GET", url: specifier });
    assert.equal(res.statusCode, 200, `${specifier} 를 서빙하지 못한다`);
  });

  it("서버와 클라이언트가 같은 socket.io 메이저 버전을 쓴다", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const server = require("socket.io/package.json").version;
    const client = require("socket.io-client/package.json").version;
    assert.equal(
      server.split(".")[0],
      client.split(".")[0],
      "CDN을 쓰던 시절에는 서버만 캐럿 범위로 떠내려가 버전이 어긋날 수 있었다",
    );
  });
});
