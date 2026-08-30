import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  arrayOf,
  boolean,
  type Infer,
  integer,
  literal,
  object,
  parseOr,
  parseOrThrow,
  string,
  union,
} from "../src/shared/validate.ts";

describe("string", () => {
  it("문자열만 통과시킨다", () => {
    assert.deepEqual(string().parse("hi"), { ok: true, value: "hi" });
    for (const bad of [1, null, undefined, {}, [], true, Symbol.iterator]) {
      assert.equal(string().parse(bad).ok, false, `${String(bad)}가 통과했다`);
    }
  });

  it("길이 제한을 검사한다", () => {
    assert.equal(string({ minLength: 3 }).parse("ab").ok, false);
    assert.equal(string({ maxLength: 2 }).parse("abc").ok, false);
    assert.equal(string({ minLength: 1, maxLength: 3 }).parse("ab").ok, true);
  });
});

describe("integer", () => {
  it("정수만 통과시킨다", () => {
    assert.equal(integer().parse(3).ok, true);
    assert.equal(integer().parse(-3).ok, true);
    for (const bad of [3.5, Number.NaN, Number.POSITIVE_INFINITY, "3", null, undefined]) {
      assert.equal(integer().parse(bad).ok, false, `${String(bad)}가 통과했다`);
    }
  });

  it("범위를 검사한다", () => {
    assert.equal(integer({ min: 0 }).parse(-1).ok, false);
    assert.equal(integer({ max: 10 }).parse(11).ok, false);
    assert.equal(integer({ min: 0, max: 10 }).parse(10).ok, true);
  });
});

describe("literal", () => {
  it("허용 목록에 있는 값만 통과시킨다", () => {
    const direction = literal("up", "down");
    assert.deepEqual(direction.parse("up"), { ok: true, value: "up" });
    assert.equal(direction.parse("sideways").ok, false);
    assert.equal(direction.parse(0).ok, false);
  });

  it("타입이 리터럴 유니온으로 좁혀진다", () => {
    const direction = literal("up", "down");
    const result = direction.parse("up");
    if (result.ok) {
      // 컴파일 시점 확인: "up" | "down" 이외를 대입하면 타입 에러가 난다.
      const value: "up" | "down" = result.value;
      assert.equal(value, "up");
    }
  });
});

describe("object", () => {
  const point = object({ x: integer(), y: integer() });

  it("모든 필드를 검사한다", () => {
    assert.deepEqual(point.parse({ x: 1, y: 2 }), { ok: true, value: { x: 1, y: 2 } });
    assert.equal(point.parse({ x: 1 }).ok, false);
    assert.equal(point.parse({ x: 1, y: "2" }).ok, false);
  });

  it("객체가 아닌 것을 거부한다", () => {
    for (const bad of [null, undefined, [], "x", 1]) {
      assert.equal(point.parse(bad).ok, false, `${String(bad)}가 통과했다`);
    }
  });

  it("모르는 키는 조용히 버린다 (프로토콜이 앞으로 나가도 깨지지 않게)", () => {
    const result = point.parse({ x: 1, y: 2, futureField: "?" });
    assert.deepEqual(result, { ok: true, value: { x: 1, y: 2 } });
  });

  it("오류 메시지에 어느 필드인지 담긴다", () => {
    const nested = object({ inner: object({ n: integer() }) });
    const result = nested.parse({ inner: { n: "x" } }, "root");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /root\.inner\.n/);
  });
});

describe("arrayOf / union / boolean", () => {
  it("배열의 모든 원소를 검사한다", () => {
    const numbers = arrayOf(integer());
    assert.deepEqual(numbers.parse([1, 2, 3]), { ok: true, value: [1, 2, 3] });
    assert.equal(numbers.parse([1, "2"]).ok, false);
    assert.equal(numbers.parse("nope").ok, false);
    assert.deepEqual(numbers.parse([]), { ok: true, value: [] });
  });

  it("배열 오류에 인덱스가 담긴다", () => {
    const result = arrayOf(integer()).parse([1, 2, "x"], "list");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /list\[2]/);
  });

  it("union은 하나라도 맞으면 통과한다", () => {
    const stringOrInt = union(string(), integer());
    assert.equal(stringOrInt.parse("a").ok, true);
    assert.equal(stringOrInt.parse(1).ok, true);
    assert.equal(stringOrInt.parse(null).ok, false);
  });

  it("boolean은 참/거짓만 받는다", () => {
    assert.equal(boolean().parse(true).ok, true);
    assert.equal(boolean().parse(false).ok, true);
    for (const bad of [0, 1, "true", null]) {
      assert.equal(boolean().parse(bad).ok, false, `${String(bad)}가 통과했다`);
    }
  });
});

describe("parseOrThrow / parseOr", () => {
  const schema = object({ n: integer({ min: 0 }) });

  it("parseOrThrow는 통과한 값을 그대로 준다", () => {
    assert.deepEqual(parseOrThrow(schema, { n: 1 }, "cfg"), { n: 1 });
  });

  it("parseOrThrow는 실패 시 위치가 담긴 TypeError를 던진다", () => {
    assert.throws(
      () => parseOrThrow(schema, { n: -1 }, "cfg"),
      (err: unknown) => {
        assert.ok(err instanceof TypeError);
        assert.match(err.message, /cfg\.n/);
        return true;
      },
    );
  });

  it("parseOr는 실패 시 대체값을 쓰고 이유를 알려준다", () => {
    const seen: string[] = [];
    assert.deepEqual(
      parseOr(schema, "쓰레기", { n: 0 }, (m) => seen.push(m)),
      { n: 0 },
    );
    assert.equal(seen.length, 1);
    assert.deepEqual(parseOr(schema, { n: 5 }, { n: 0 }), { n: 5 });
  });
});

describe("Infer", () => {
  it("스키마 하나에서 런타임 검증과 타입을 함께 얻는다", () => {
    const message = object({
      kind: literal("aircon", "heater"),
      temp: integer(),
      tags: arrayOf(string()),
    });
    type Message = Infer<typeof message>;

    const result = message.parse({ kind: "heater", temp: 22, tags: ["a"] });
    assert.equal(result.ok, true);
    if (result.ok) {
      // 컴파일 시점 확인: 아래 대입이 맞아야 한다.
      const typed: Message = result.value;
      const kind: "aircon" | "heater" = typed.kind;
      const tags: string[] = typed.tags;
      assert.equal(kind, "heater");
      assert.deepEqual(tags, ["a"]);
    }
  });
});
