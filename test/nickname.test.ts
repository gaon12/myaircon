import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeNickname } from "../src/server/nickname.ts";

const OPTS = { maxLength: 9, fallback: "익명" };
const n = (raw: unknown, opts = OPTS): string => normalizeNickname(raw, opts);

/** grapheme(사용자가 인지하는 글자) 개수 */
const graphemes = (s: string): number =>
  [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(s)].length;

describe("normalizeNickname", () => {
  describe("문자열이 아닌 입력 (기존 코드는 여기서 TypeError를 던졌다)", () => {
    for (const bad of [123, 0, null, undefined, {}, [], true, Symbol.iterator, 1n, () => {}]) {
      it(`${String(bad)} -> fallback`, () => {
        assert.equal(n(bad), "익명");
      });
    }
  });

  it("멀쩡한 닉네임은 그대로 통과시킨다", () => {
    assert.equal(n("가온"), "가온");
    assert.equal(n("codingapple"), "codingapp");
    assert.equal(n("abc"), "abc");
  });

  it("앞뒤 공백을 제거하고 연속 공백을 하나로 줄인다", () => {
    assert.equal(n("  가온  "), "가온");
    assert.equal(n("a\t\t\tb"), "a b");
    assert.equal(n("a\n\nb"), "a b");
  });

  it("빈 값과 공백뿐인 값은 fallback으로 바꾼다", () => {
    assert.equal(n(""), "익명");
    assert.equal(n("   "), "익명");
    assert.equal(n("\t\n "), "익명");
  });

  it("surrogate pair를 반토막 내지 않는다 (기존 substring의 버그)", () => {
    // 확장 한자(U+20000~)는 허용 문자이면서 UTF-16에서 두 코드 유닛이다.
    // 코드 유닛 기준으로 자르면 여기서 U+FFFD가 나온다.
    const han = "\u{2000B}";
    const out = n(han.repeat(20));
    assert.equal(graphemes(out), 9);
    assert.ok(!out.includes("\uFFFD"), "치환 문자가 섞이면 안 된다");
    assert.equal(out, han.repeat(9));
  });

  it("한글 조합형(NFD)을 NFC로 정규화한다", () => {
    const nfd = "가온".normalize("NFD");
    assert.notEqual(nfd, "가온");
    assert.equal(n(nfd), "가온");
  });

  it("제어문자를 제거한다", () => {
    assert.equal(n("a\u0000b"), "ab");
    assert.equal(n("a\u0007b\u001Bc"), "abc");
  });

  it("bidi override와 폭 없는 문자를 제거한다", () => {
    assert.equal(n("a\u202Eb"), "ab");
    assert.equal(n("\u200Bhi\u200B"), "hi");
    assert.equal(n("\uFEFFhi"), "hi");
    assert.equal(n("a\u2066b\u2069c"), "abc");
  });

  it("보이지 않는 문자만으로 된 닉네임은 fallback이 된다", () => {
    assert.equal(n("\u200B\u200B\u200B"), "익명");
    assert.equal(n("\u0000\u0001"), "익명");
  });

  describe("허용 문자만 남긴다", () => {
    it("이모지를 지운다", () => {
      // 예전에는 통과했다. 폭이 제각각이라 순위표 정렬이 무너지고,
      // 도배에 가장 많이 쓰이던 것도 이모지였다.
      assert.equal(n("가온🎉"), "가온");
      assert.equal(n("🎉".repeat(20)), "익명");
    });

    it("기호와 구두점을 지운다", () => {
      assert.equal(n("a!@#b"), "ab");
      assert.equal(n("<script>"), "script");
      assert.equal(n("─━┃█"), "익명");
    });

    it("결합 문자를 쌓는 장난(Zalgo)을 막는다", () => {
      // NFC가 첫 악센트 하나를 á로 합치고, 남은 49개는 Script=Inherited라
      // 허용 목록에 없어서 지워진다. á 하나는 멀쩡한 라틴 문자이므로 남는
      // 것이 맞다 -- 막으려는 것은 글자를 화면 밖으로 흘리는 쌓기다.
      assert.equal(n(`a${"́".repeat(50)}b`), "áb");
    });

    it("앱이 지원하는 언어의 문자는 남긴다", () => {
      // 한국어만 남기면 일본어·중국어 UI로 들어온 사람이 자기 이름을 못 쓴다.
      assert.equal(n("가온"), "가온");
      assert.equal(n("Gaon"), "Gaon");
      assert.equal(n("Café"), "Café");
      assert.equal(n("2026"), "2026");
      assert.equal(n("ガオン"), "ガオン");
      assert.equal(n("がおん"), "がおん");
      assert.equal(n("加温"), "加温");
      assert.equal(n("コーヒー"), "コーヒー");
    });

    it("문자를 지우고 남은 공백도 접는다", () => {
      // 지우기가 먼저, 공백 접기가 나중이어야 한다. 순서가 반대면
      // "a @@ b"가 "a  b"로 남는다.
      assert.equal(n("a @@ b"), "a b");
      assert.equal(n("  🎉  가온  🎉  "), "가온");
    });

    it("쓸 수 있는 문자가 하나도 없으면 fallback이다", () => {
      assert.equal(n("!!!"), "익명");
      assert.equal(n("...."), "익명");
    });
  });

  it("maxLength와 fallback 설정을 따른다", () => {
    assert.equal(n("abcdef", { maxLength: 3, fallback: "x" }), "abc");
    assert.equal(n("", { maxLength: 3, fallback: "손님" }), "손님");
  });

  it("어떤 입력에도 예외를 던지지 않는다", () => {
    const hostile = [
      "a".repeat(100_000),
      "🎉".repeat(50_000),
      "\u202E".repeat(1000),
      {
        toString: () => {
          throw new Error("boom");
        },
      },
    ];
    for (const input of hostile) {
      assert.doesNotThrow(() => n(input));
    }
  });
});
