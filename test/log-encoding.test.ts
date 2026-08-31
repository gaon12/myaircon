import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { Thermostat } from "../src/server/thermostat.ts";
import { deviceInfoSchema } from "../src/shared/protocol.ts";
import { integer, literal, object, string } from "../src/shared/validate.ts";
import { startTestServer } from "./helpers.ts";

/**
 * 서버가 stdout/stderr로 내보내는 것은 전부 ASCII여야 한다.
 *
 * 로그 파일 자체는 UTF-8로 올바르게 쓰이지만, 그것을 읽는 쪽(터미널, pm2,
 * 호스팅 업체의 로그 뷰어, 수집기)의 인코딩까지 통제할 수 없다. 실제로
 * 윈도우 cp949 콘솔에서 한글 로그가 "?쒕쾭 濡쒖뺄" 처럼 깨졌다.
 *
 * 그래서 진단 문구는 영어로 쓴다. 사용자에게 보이는 문자열(i18n 로케일,
 * 닉네임 기본값)은 대상이 아니다 -- 그건 브라우저가 UTF-8로 잘 처리한다.
 */

const NON_ASCII = /[^\x20-\x7E\t\n\r]/;
const firstNonAscii = (text: string): string | null => {
  const match = NON_ASCII.exec(text);
  if (match === null) return null;
  const at = match.index;
  return `${JSON.stringify(match[0])} (U+${(match[0].codePointAt(0) ?? 0).toString(16).toUpperCase()}) in ${JSON.stringify(text.slice(Math.max(0, at - 30), at + 30))}`;
};

const assertAscii = (text: string, label: string): void => {
  const found = firstNonAscii(text);
  assert.equal(found, null, `${label}에 ASCII 밖 문자가 있다: ${found}`);
};

describe("서버 진단 출력은 ASCII만 쓴다", () => {
  describe("소스에 한글 진단 문자열이 남아 있지 않다", () => {
    /** 사용자에게 보이는 값이라 한글이 정당한 곳. */
    const USER_FACING = new Set(["NICKNAME_FALLBACK 기본값", "error-page.ts 오류 화면 문구"]);

    /**
     * 통째로 예외인 파일.
     *
     * error-page.ts는 브라우저에 내보낼 HTML을 만드는 곳이라 문구가 다섯 개
     * 언어로 들어 있다. 이건 로그가 아니라 화면이고, UTF-8로 선언한 HTML을
     * 브라우저가 읽으므로 콘솔 인코딩과 아무 상관이 없다. 클라이언트
     * 로케일이 이 검사 대상이 아닌 것과 같은 이유다.
     *
     * 대신 아래에서 "이 파일은 로그를 찍지 않는다"를 함께 확인한다. 그
     * 조건이 깨지면 예외가 몰래 넓어진 것이므로 다시 들여다봐야 한다.
     */
    const EXEMPT_FILES = new Set(["src/server/error-page.ts"]);

    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith(".ts")) out.push(full);
      }
      return out;
    };

    const root = path.join(import.meta.dirname, "..");
    const files = [
      ...walk(path.join(root, "src", "server")),
      ...walk(path.join(root, "src", "shared")),
      path.join(root, "src", "client", "dom.ts"),
    ];

    for (const file of files) {
      const relative = path.relative(root, file).replaceAll("\\", "/");
      if (EXEMPT_FILES.has(relative)) continue;
      it(relative, () => {
        const offenders: string[] = [];
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, index) => {
            // 주석은 대상이 아니다. 한글 주석은 얼마든지 좋다.
            const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");
            for (const literalText of code.match(/"[^"]*"|`[^`]*`/g) ?? []) {
              if (!NON_ASCII.test(literalText)) continue;
              // 닉네임 기본값만 예외
              if (literalText === '"익명"') continue;
              offenders.push(`${index + 1}: ${literalText}`);
            }
          });
        assert.deepEqual(offenders, [], `진단 문자열은 영어로 써야 한다:\n${offenders.join("\n")}`);
      });
    }

    it("예외 목록이 의도한 것만 담고 있다", () => {
      assert.equal(USER_FACING.size, 2);
      assert.deepEqual([...EXEMPT_FILES], ["src/server/error-page.ts"]);
    });

    it("통째로 예외인 파일은 로그를 찍지 않는다", () => {
      // 화면 문구라서 봐준 것이지, 그 파일 안에서 한글로 로그를 남겨도 된다는
      // 뜻이 아니다. 로깅이 들어오는 순간 예외의 근거가 사라진다.
      for (const relative of EXEMPT_FILES) {
        const source = readFileSync(path.join(root, relative), "utf8");
        assert.doesNotMatch(source, /\b(log|logger|console)\s*\.\s*\w/, relative);
      }
    });
  });

  describe("실행 중 만들어지는 메시지도 ASCII다", () => {
    it("검증기 오류 메시지", () => {
      const schema = object({
        name: string({ minLength: 2, maxLength: 3 }),
        age: integer({ min: 0, max: 10 }),
        kind: literal("a", "b"),
      });
      for (const bad of [null, 1, {}, { name: 1 }, { name: "x" }, { name: "abcd" }]) {
        const result = schema.parse(bad, "cfg");
        if (!result.ok) assertAscii(result.error, "검증기 오류");
      }
      for (const bad of [
        { name: "ab", age: -1 },
        { name: "ab", age: 1, kind: "z" },
      ]) {
        const result = schema.parse(bad, "cfg");
        if (!result.ok) assertAscii(result.error, "검증기 오류");
      }
    });

    it("프로토콜 스키마 오류 메시지", () => {
      const result = deviceInfoSchema.parse(
        {
          kind: "aircon",
          assets: { body: "https://x/y.png", fan: "/a.png", air: "/b.png" },
          usingFallback: false,
        },
        "init.device",
      );
      assert.equal(result.ok, false);
      if (!result.ok) assertAscii(result.error, "프로토콜 오류");
    });

    it("Thermostat이 던지는 오류 메시지", () => {
      for (const build of [
        () => new Thermostat({ min: 1.5, max: 10 }),
        () => new Thermostat({ min: 30, max: 18 }),
        () => new Thermostat({ min: 18, max: 30 }).step("sideways" as never),
      ]) {
        assert.throws(build, (err: unknown) => {
          assert.ok(err instanceof Error);
          assertAscii(err.message, "Thermostat 오류");
          return true;
        });
      }
    });

    it("설정 검증 오류 메시지", async () => {
      // config.ts는 import 시점에 process.env를 읽으므로 별도 프로세스로 확인한다.
      const { execFileSync } = await import("node:child_process");
      const root = path.join(import.meta.dirname, "..");
      for (const [key, value] of [
        ["PORT", "-1"],
        ["DEVICE_MODE", "toaster"],
        ["WINTER_MONTHS", "13"],
        ["SEASON_TIMEZONE", "Asia/Seuol"],
      ] as const) {
        let stderr = "";
        try {
          execFileSync(
            process.execPath,
            ["--input-type=module", "-e", 'await import("./src/server/config.ts");'],
            { cwd: root, env: { ...process.env, [key]: value }, stdio: "pipe" },
          );
          assert.fail(`${key}=${value} 가 통과했다`);
        } catch (err) {
          stderr = String((err as { stderr?: Buffer }).stderr ?? "");
        }
        assert.match(stderr, new RegExp(key), `${key} 오류가 나야 한다`);
        assertAscii(stderr, `${key} 설정 오류 출력`);
      }
    });
  });

  it("실제 서버 로그 출력이 ASCII다", async () => {
    const lines: string[] = [];
    const server = await startTestServer({ logLevel: "trace" });
    try {
      // startTestServer는 로그를 끄므로, 같은 설정으로 로거를 켠 인스턴스를 따로 만든다.
      const { buildApp, closeApp } = await import("../src/server/app.ts");
      const context = await buildApp({
        config: { ...server.config, persistenceEnabled: false },
        logger: {
          level: "trace",
          // pino의 출력 스트림을 가로챈다.
          stream: {
            write(chunk: string) {
              lines.push(chunk);
            },
          },
        },
      });
      await context.app.inject({ method: "GET", url: "/healthz" });
      await closeApp(context);
    } finally {
      await server.stop();
    }

    assert.ok(lines.length > 0, "로그가 하나도 안 나왔다");
    const joined = lines.join("");
    assertAscii(joined, "서버 로그");
    // 기기 종류를 결정했다는 로그가 실제로 포함돼 있는지 (샘플이 비지 않았음을 확인)
    assert.match(joined, /resolved device kind/);
  });
});
