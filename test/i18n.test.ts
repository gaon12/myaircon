import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FALLBACK_LOCALE,
  isSupportedLocale,
  localeCodes,
  localeOptions,
  locales,
  pickLocale,
} from "../src/client/i18n/index.ts";
import type { PlainStringKey } from "../src/client/i18n/locale.ts";
import { negotiateLocale, parseTag } from "../src/shared/negotiate.ts";

const pick = (requested: unknown): string =>
  negotiateLocale(requested, localeCodes, FALLBACK_LOCALE);

describe("parseTag", () => {
  it("언어/자형/지역을 분리한다", () => {
    assert.deepEqual(parseTag("ko"), { language: "ko", script: null, region: null });
    assert.deepEqual(parseTag("en-US"), { language: "en", script: null, region: "us" });
    assert.deepEqual(parseTag("zh-Hant-TW"), { language: "zh", script: "Hant", region: "tw" });
    assert.deepEqual(parseTag("zh-TW"), { language: "zh", script: null, region: "tw" });
  });

  it("대소문자와 구분자 표기를 흡수한다", () => {
    assert.deepEqual(parseTag("ZH-HANT-tw"), { language: "zh", script: "Hant", region: "tw" });
    assert.deepEqual(parseTag("ja_JP"), { language: "ja", script: null, region: "jp" });
    assert.deepEqual(parseTag("  ko-KR  "), { language: "ko", script: null, region: "kr" });
  });

  it("숫자 지역 코드(UN M.49)를 처리한다", () => {
    assert.deepEqual(parseTag("es-419"), { language: "es", script: null, region: "419" });
  });

  it("쓸 수 없는 값은 null", () => {
    for (const bad of ["", "   ", "-", "x", "123", null, undefined, 42, {}, []]) {
      assert.equal(parseTag(bad), null, `${String(bad)} -> null`);
    }
  });
});

describe("로케일 협상", () => {
  it("정확히 일치하는 코드를 고른다", () => {
    assert.equal(pick(["ko"]), "ko");
    assert.equal(pick(["ja"]), "ja");
    assert.equal(pick(["zh-Hant"]), "zh-Hant");
  });

  it("지역 코드는 떼고 언어로 맞춘다", () => {
    assert.equal(pick(["ko-KR"]), "ko");
    assert.equal(pick(["en-GB"]), "en");
    assert.equal(pick(["ja-JP"]), "ja");
  });

  describe("중국어 자형 판별", () => {
    // 지역 코드만으로는 간체인지 번체인지 알 수 없어서 별도 매핑이 필요하다.
    for (const [tag, expected] of [
      ["zh-CN", "zh-Hans"],
      ["zh-SG", "zh-Hans"],
      ["zh-Hans-CN", "zh-Hans"],
      ["zh-TW", "zh-Hant"],
      ["zh-HK", "zh-Hant"],
      ["zh-MO", "zh-Hant"],
      ["zh-Hant-HK", "zh-Hant"],
    ]) {
      it(`${tag} -> ${expected}`, () => assert.equal(pick([tag]), expected));
    }

    it("자형도 지역도 없는 zh는 간체로 본다", () => {
      assert.equal(pick(["zh"]), "zh-Hans");
    });

    it("모르는 지역의 중국어도 중국어 안에서 해결한다", () => {
      assert.ok(pick(["zh-XX"]).startsWith("zh-"));
    });
  });

  it("선호 순서를 지킨다", () => {
    assert.equal(pick(["fr", "de", "ja", "ko"]), "ja");
    assert.equal(pick(["xx-YY", "zh-TW", "ko"]), "zh-Hant");
  });

  it("지원하지 않는 언어뿐이면 fallback", () => {
    assert.equal(pick(["fr", "de", "ru"]), FALLBACK_LOCALE);
    assert.equal(pick([]), FALLBACK_LOCALE);
    assert.equal(pick(["", null, undefined, 42]), FALLBACK_LOCALE);
  });

  it("문자열 하나만 줘도 동작한다", () => {
    assert.equal(negotiateLocale("ko-KR", localeCodes, FALLBACK_LOCALE), "ko");
  });
});

describe("pickLocale", () => {
  it("저장된 선택이 브라우저 선호보다 우선한다", () => {
    assert.equal(pickLocale("ja", ["ko-KR"]), "ja");
  });

  it("저장값이 없거나 지원하지 않으면 브라우저 선호로 협상한다", () => {
    assert.equal(pickLocale(null, ["ko-KR"]), "ko");
    assert.equal(pickLocale("klingon", ["zh-TW"]), "zh-Hant");
    assert.equal(pickLocale(123, ["ja"]), "ja");
  });
});

describe("로케일 파일", () => {
  const requiredStrings: PlainStringKey[] = [
    "nicknameLabel",
    "nicknamePlaceholder",
    "start",
    "onlineOn",
    "onlineOff",
    "connecting",
    "soundOn",
    "soundOff",
    "warmer",
    "cooler",
    "atMax",
    "atMin",
    "audioFailed",
    "connectionLost",
    "connectionFailed",
    "serverError",
    "stats",
    "about",
    "close",
    "plusCount",
    "minusCount",
    "language",
    "theme",
    "themeSystem",
    "themeLight",
    "themeDark",
  ];
  const requiredFunctions = ["appName", "adjustedBy", "rateLimited", "aboutLines"] as const;

  for (const code of localeCodes) {
    describe(code, () => {
      const locale = locales[code];

      it("code가 키와 일치하고 표기명이 있다", () => {
        assert.equal(locale.code, code);
        assert.ok(locale.name.length > 0);
      });

      it("기기 이름 두 종류를 모두 갖는다", () => {
        assert.ok(locale.device.aircon.length > 0);
        assert.ok(locale.device.heater.length > 0);
      });

      it("모든 문자열 키가 비어 있지 않다", () => {
        for (const key of requiredStrings) {
          assert.equal(typeof locale[key], "string", `${code}.${key}가 문자열이 아니다`);
          assert.ok(locale[key].trim().length > 0, `${code}.${key}가 비었다`);
        }
      });

      it("보간 함수가 인자를 실제로 반영한다", () => {
        for (const key of requiredFunctions) {
          assert.equal(typeof locale[key], "function", `${code}.${key}가 함수가 아니다`);
        }
        assert.match(locale.adjustedBy("가온"), /가온/);
        assert.match(locale.rateLimited(7), /7/);
        // 로케일에 따라 제목에서 첫 글자를 대문자로 올릴 수 있으므로 대소문자는 무시한다.
        assert.match(locale.appName(locale.device.aircon), new RegExp(locale.device.aircon, "i"));
        assert.match(locale.appName(locale.device.heater), new RegExp(locale.device.heater, "i"));

        const lines = locale.aboutLines(locale.device.heater);
        assert.ok(Array.isArray(lines) && lines.length > 0);
        assert.ok(lines.every((line) => typeof line === "string" && line.length > 0));
        assert.ok(
          lines.some((line) => line.toLowerCase().includes(locale.device.heater.toLowerCase())),
        );
      });
    });
  }

  it("모든 로케일이 완전히 같은 키 집합을 갖는다", () => {
    // 언어를 추가할 때 키를 빠뜨리면 화면에 undefined가 뜬다.
    const reference = Object.keys(locales[FALLBACK_LOCALE]).sort();
    for (const code of localeCodes) {
      assert.deepEqual(Object.keys(locales[code]).sort(), reference, `${code}의 키가 다르다`);
    }
  });

  it("fallback 로케일이 실제로 존재한다", () => {
    assert.ok(isSupportedLocale(FALLBACK_LOCALE));
  });

  it("선택 목록이 모든 로케일을 표기명과 함께 담는다", () => {
    assert.equal(localeOptions.length, localeCodes.length);
    for (const [code, name] of localeOptions) {
      assert.ok(isSupportedLocale(code));
      assert.equal(name, locales[code].name);
    }
  });
});
