import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockedMessageSchema,
  deviceChangeMessageSchema,
  deviceInfoSchema,
  initMessageSchema,
  persistedStateSchema,
  tempChangeMessageSchema,
} from "../src/shared/protocol.ts";

const validDevice = {
  kind: "aircon",
  assets: { body: "/aircon0.png", fan: "/aircon-fan2.png", air: "/air2.png" },
  usingFallback: false,
};

const validInit = { temp: 22, min: 18, max: 30, device: validDevice };

const validTempChange = {
  temp: 22,
  changed: true,
  direction: "up",
  username: "가온",
  at: 1_700_000_000_000,
};

describe("와이어 메시지 검증", () => {
  /**
   * 타입 선언은 컴파일 시점에 전부 지워진다. 배포 중 서버와 클라이언트의
   * 버전이 잠깐 어긋나거나, 중간 장비가 페이로드를 건드리거나, 프로토콜을
   * 바꾸다 한쪽만 고치면 형태가 달라진다. 검증하지 않으면 그때 화면이
   * 조용히 깨진다(NaN℃, undefined 표시 등).
   */

  describe("init", () => {
    it("올바른 메시지를 통과시킨다", () => {
      const result = initMessageSchema.parse(validInit);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.value.device.kind, "aircon");
    });

    for (const [label, broken] of [
      ["temp 누락", { ...validInit, temp: undefined }],
      ["temp가 문자열", { ...validInit, temp: "22" }],
      ["temp가 소수", { ...validInit, temp: 22.5 }],
      ["temp가 NaN", { ...validInit, temp: Number.NaN }],
      ["device 누락", { ...validInit, device: undefined }],
      ["device가 null", { ...validInit, device: null }],
      ["메시지 자체가 숫자", 42],
      ["메시지가 null", null],
      ["메시지가 배열", [validInit]],
    ] as const) {
      it(`${label} -> 거부`, () => {
        assert.equal(initMessageSchema.parse(broken).ok, false);
      });
    }

    it("모르는 필드가 추가돼도 통과한다 (앞으로 나간 서버와의 호환)", () => {
      const result = initMessageSchema.parse({ ...validInit, futureField: 1 });
      assert.equal(result.ok, true);
      if (result.ok)
        assert.deepEqual(Object.keys(result.value).sort(), ["device", "max", "min", "temp"]);
    });
  });

  describe("기기 정보의 이미지 경로", () => {
    it("우리 서버의 절대 경로만 받는다", () => {
      const withUrl = (body: unknown) => ({
        ...validDevice,
        assets: { ...validDevice.assets, body },
      });
      assert.equal(deviceInfoSchema.parse(withUrl("/heater0.png")).ok, true);
      assert.equal(deviceInfoSchema.parse(withUrl("/img/a-b.webp")).ok, true);

      // 외부 URL이 섞여 들어오면 CSP에 막히거나 엉뚱한 것을 불러온다.
      for (const bad of [
        "https://evil.example/x.png",
        "//evil.example/x.png",
        "aircon0.png",
        "../aircon0.png",
        "/script.js",
        "/x.png?a=1",
        "",
        null,
        42,
      ]) {
        assert.equal(deviceInfoSchema.parse(withUrl(bad)).ok, false, `${String(bad)}가 통과했다`);
      }
    });

    it("모르는 기기 종류를 거부한다", () => {
      assert.equal(deviceInfoSchema.parse({ ...validDevice, kind: "toaster" }).ok, false);
      assert.equal(deviceChangeMessageSchema.parse({ ...validDevice, kind: "heater" }).ok, true);
    });
  });

  describe("tempChange", () => {
    it("올바른 메시지를 통과시킨다", () => {
      assert.equal(tempChangeMessageSchema.parse(validTempChange).ok, true);
    });

    for (const [label, broken] of [
      ["direction이 엉뚱한 값", { ...validTempChange, direction: "sideways" }],
      ["changed가 문자열", { ...validTempChange, changed: "true" }],
      ["username이 숫자", { ...validTempChange, username: 1 }],
      ["at이 음수", { ...validTempChange, at: -1 }],
    ] as const) {
      it(`${label} -> 거부`, () => {
        assert.equal(tempChangeMessageSchema.parse(broken).ok, false);
      });
    }
  });

  describe("blocked", () => {
    it("재시도 시간이 있어야 한다", () => {
      assert.equal(
        blockedMessageSchema.parse({ reason: "rate_limited", retryAfterMs: 5000 }).ok,
        true,
      );
      assert.equal(blockedMessageSchema.parse({ reason: "rate_limited" }).ok, false);
      assert.equal(
        blockedMessageSchema.parse({ reason: "rate_limited", retryAfterMs: -1 }).ok,
        false,
      );
      // 예전 프로토콜(문자열 하나)은 이제 거부된다
      assert.equal(blockedMessageSchema.parse("너무 잦은 요청").ok, false);
    });
  });

  describe("디스크에 저장하는 상태", () => {
    it("우리가 쓴 파일이라도 형태를 확인한다", () => {
      assert.equal(persistedStateSchema.parse({ temp: 22 }).ok, true);
      // 손상, 손편집, 예전 버전의 형식
      for (const bad of [{ temp: "22" }, { temp: null }, {}, 42, null, "{}", []]) {
        assert.equal(
          persistedStateSchema.parse(bad).ok,
          false,
          `${JSON.stringify(bad)}가 통과했다`,
        );
      }
    });
  });

  it("어떤 입력에도 예외를 던지지 않는다", () => {
    const hostile: unknown[] = [
      undefined,
      null,
      0,
      "",
      [],
      {},
      Symbol.iterator,
      () => {},
      new Map(),
      {
        get temp() {
          throw new Error("boom");
        },
      },
    ];
    for (const schema of [
      initMessageSchema,
      tempChangeMessageSchema,
      blockedMessageSchema,
      deviceInfoSchema,
      persistedStateSchema,
    ]) {
      for (const input of hostile) {
        assert.doesNotThrow(() => schema.parse(input));
      }
    }
  });
});
