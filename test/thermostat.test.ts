import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Thermostat } from "../src/server/thermostat.ts";
import type { Direction } from "../src/shared/protocol.ts";

const RANGE = { min: 18, max: 30, initial: 18 };

describe("Thermostat", () => {
  it("초기값을 범위 안으로 클램프한다", () => {
    assert.equal(new Thermostat({ ...RANGE, initial: 5 }).value, 18);
    assert.equal(new Thermostat({ ...RANGE, initial: 99 }).value, 30);
    assert.equal(new Thermostat({ ...RANGE, initial: 24 }).value, 24);
  });

  it("잘못된 범위 설정은 생성 시점에 거부한다", () => {
    assert.throws(() => new Thermostat({ min: 30, max: 18 }), RangeError);
    assert.throws(() => new Thermostat({ min: 1.5, max: 10 }), TypeError);
  });

  it("up/down으로 한 칸씩 움직인다", () => {
    const t = new Thermostat(RANGE);
    assert.deepEqual(t.step("up"), { temp: 19, changed: true });
    assert.deepEqual(t.step("up"), { temp: 20, changed: true });
    assert.deepEqual(t.step("down"), { temp: 19, changed: true });
  });

  it("상한에서 더 올려도 넘어가지 않고 changed=false를 알린다", () => {
    const t = new Thermostat({ ...RANGE, initial: 30 });
    assert.deepEqual(t.step("up"), { temp: 30, changed: false });
    assert.deepEqual(t.step("up"), { temp: 30, changed: false });
    assert.equal(t.value, 30);
  });

  it("하한에서 더 내려도 넘어가지 않고 changed=false를 알린다", () => {
    const t = new Thermostat({ ...RANGE, initial: 18 });
    assert.deepEqual(t.step("down"), { temp: 18, changed: false });
    assert.equal(t.value, 18);
  });

  it("알 수 없는 방향은 거부한다", () => {
    const t = new Thermostat(RANGE);
    // TypeScript가 컴파일 시점에 이미 막지만, 타입은 런타임에 전부 지워진다.
    // 컴파일되지 않은 호출자(순수 JS, 소켓 페이로드 등)를 위해 런타임 검사도
    // 살아 있어야 한다. 그것을 확인하려고 일부러 타입을 벗겨서 넘긴다.
    assert.throws(() => t.step("sideways" as unknown as Direction), TypeError);
    assert.throws(() => t.step(undefined as unknown as Direction), TypeError);
  });

  it("restore는 저장된 값을 범위 안으로 클램프해 복원한다", () => {
    const t = new Thermostat(RANGE);
    assert.equal(t.restore(25), 25);
    assert.equal(t.restore(999), 30);
    assert.equal(t.restore(-999), 18);
    // 손상된 상태 파일에서 온 값도 서버를 죽이지 않아야 한다
    assert.equal(t.restore(Number.NaN), 18);
    assert.equal(t.restore("abc"), 18);
  });

  it("min/max를 읽을 수 있고 외부에서 값을 직접 바꿀 수 없다", () => {
    const t = new Thermostat(RANGE);
    assert.equal(t.min, 18);
    assert.equal(t.max, 30);
    // #value는 private field라 getter만 노출된다. TypeScript는 읽기 전용
    // 프로퍼티로 보고 컴파일 시점에 막고, 런타임에도 strict mode(ESM)에서
    // 대입 자체가 TypeError가 된다 -- 예전 `var temp` 전역과의 차이.
    assert.throws(() => {
      (t as unknown as { value: number }).value = 100;
    }, TypeError);
    assert.equal(t.value, 18);
  });
});
