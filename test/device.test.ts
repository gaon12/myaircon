import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DEVICE_KINDS,
  DEVICE_MODES,
  describeDevice,
  isValidTimeZone,
  monthIn,
  resolveAssets,
  resolveDeviceKind,
} from "../src/server/device.ts";

const WINTER = [11, 12, 1, 2, 3];
const at = (month: number): Date => new Date(2026, month - 1, 15, 12, 0, 0);

describe("resolveDeviceKind", () => {
  describe("auto: 월로 계절을 판단한다", () => {
    for (const month of [1, 2, 3, 11, 12]) {
      it(`${month}월 -> 온풍기`, () => {
        assert.equal(
          resolveDeviceKind({ mode: "auto", winterMonths: WINTER, now: at(month) }),
          "heater",
        );
      });
    }
    for (const month of [4, 5, 6, 7, 8, 9, 10]) {
      it(`${month}월 -> 에어컨`, () => {
        assert.equal(
          resolveDeviceKind({ mode: "auto", winterMonths: WINTER, now: at(month) }),
          "aircon",
        );
      });
    }
  });

  it("겨울 범위를 설정으로 바꿀 수 있다 (남반구 등)", () => {
    const southern = [5, 6, 7, 8];
    assert.equal(resolveDeviceKind({ mode: "auto", winterMonths: southern, now: at(7) }), "heater");
    assert.equal(resolveDeviceKind({ mode: "auto", winterMonths: southern, now: at(1) }), "aircon");
  });

  it("빈 겨울 목록이면 언제나 에어컨이다", () => {
    for (let month = 1; month <= 12; month++) {
      assert.equal(resolveDeviceKind({ mode: "auto", winterMonths: [], now: at(month) }), "aircon");
    }
  });

  it("명시적으로 고정하면 월과 무관하다", () => {
    // 한겨울에도 aircon으로 고정할 수 있어야 한다
    assert.equal(resolveDeviceKind({ mode: "aircon", winterMonths: WINTER, now: at(1) }), "aircon");
    assert.equal(resolveDeviceKind({ mode: "heater", winterMonths: WINTER, now: at(7) }), "heater");
  });

  it("모르는 모드는 auto처럼 동작한다", () => {
    assert.equal(resolveDeviceKind({ mode: "wat", winterMonths: WINTER, now: at(1) }), "heater");
    assert.equal(resolveDeviceKind({ mode: "wat", winterMonths: WINTER, now: at(7) }), "aircon");
  });

  it("now를 생략하면 현재 시각을 쓴다", () => {
    const kind = resolveDeviceKind({ mode: "auto", winterMonths: WINTER });
    assert.ok(DEVICE_KINDS.includes(kind));
  });

  it("월 경계에서 정확히 갈린다", () => {
    const lastOfOctober = new Date(2026, 9, 31, 23, 59, 59);
    const firstOfNovember = new Date(2026, 10, 1, 0, 0, 0);
    assert.equal(
      resolveDeviceKind({ mode: "auto", winterMonths: WINTER, now: lastOfOctober }),
      "aircon",
    );
    assert.equal(
      resolveDeviceKind({ mode: "auto", winterMonths: WINTER, now: firstOfNovember }),
      "heater",
    );
  });
});

describe("계절 판정의 시간대 (서버 시간 기준)", () => {
  // 계절은 접속자가 아니라 서버 시간으로 정한다. 다만 "서버의 프로세스 TZ"에
  // 암묵적으로 기대면 배포 환경(대부분의 컨테이너가 UTC)에 따라 결과가
  // 달라지므로, 시간대를 명시할 수 있어야 한다.

  it("UTC 자정 근처에서 시간대에 따라 월이 갈린다", () => {
    // 2026-11-01 00:30 KST = 2026-10-31 15:30 UTC
    const instant = new Date(Date.UTC(2026, 9, 31, 15, 30));
    assert.equal(monthIn(instant, "UTC"), 10);
    assert.equal(monthIn(instant, "Asia/Seoul"), 11);
  });

  it("같은 순간이라도 설정한 시간대에 따라 기기가 달라진다", () => {
    const instant = new Date(Date.UTC(2026, 9, 31, 15, 30));
    const common = { mode: "auto", winterMonths: WINTER, now: instant } as const;
    assert.equal(resolveDeviceKind({ ...common, timeZone: "UTC" }), "aircon");
    assert.equal(resolveDeviceKind({ ...common, timeZone: "Asia/Seoul" }), "heater");
  });

  it("시간대를 지정하지 않으면 서버 프로세스의 로컬 시간을 쓴다", () => {
    const instant = new Date(2026, 6, 15, 12);
    assert.equal(monthIn(instant, null), 7);
    assert.equal(monthIn(instant, ""), 7);
  });

  it("여러 시간대를 넘나들며 월을 정확히 읽는다", () => {
    const instant = new Date(Date.UTC(2026, 0, 1, 5, 0));
    assert.equal(monthIn(instant, "UTC"), 1);
    assert.equal(monthIn(instant, "Asia/Seoul"), 1);
    assert.equal(monthIn(instant, "America/New_York"), 1);
    // 2026-01-01 05:00 UTC = 2025-12-31 21:00 America/Los_Angeles
    assert.equal(monthIn(instant, "America/Los_Angeles"), 12);
  });

  it("유효한 시간대만 통과시킨다", () => {
    assert.equal(isValidTimeZone("Asia/Seoul"), true);
    assert.equal(isValidTimeZone("UTC"), true);
    assert.equal(isValidTimeZone("Asia/Seuol"), false);
    assert.equal(isValidTimeZone("nope"), false);
    assert.equal(isValidTimeZone(""), false);
  });
});

describe("resolveAssets", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "myaircon-assets-"));
    for (const name of ["aircon0.png", "aircon-fan2.png", "air2.png"]) {
      await writeFile(path.join(dir, name), "x");
    }
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("에어컨은 자기 에셋을 그대로 쓴다", () => {
    const { assets, usingFallback } = resolveAssets(dir, "aircon");
    assert.deepEqual(assets, {
      body: "/aircon0.png",
      fan: "/aircon-fan2.png",
      air: "/air2.png",
    });
    assert.equal(usingFallback, false);
  });

  it("온풍기 에셋이 없으면 에어컨 것으로 폴백한다", () => {
    const { assets, usingFallback } = resolveAssets(dir, "heater");
    assert.deepEqual(assets, {
      body: "/aircon0.png",
      fan: "/aircon-fan2.png",
      air: "/air2.png",
    });
    assert.equal(usingFallback, true, "폴백 중임을 알려야 한다");
  });

  it("온풍기 에셋을 넣으면 그걸 쓴다", async () => {
    for (const name of ["heater0.png", "heater-fan.png", "heater-air.png"]) {
      await writeFile(path.join(dir, name), "x");
    }
    const { assets, usingFallback } = resolveAssets(dir, "heater");
    assert.deepEqual(assets, {
      body: "/heater0.png",
      fan: "/heater-fan.png",
      air: "/heater-air.png",
    });
    assert.equal(usingFallback, false);
  });

  it("일부만 넣어도 파일 단위로 섞인다", async () => {
    // 본체만 먼저 그리고 팬/바람은 에어컨 것을 그대로 쓰는 경우
    await writeFile(path.join(dir, "heater0.png"), "x");
    const { assets, usingFallback } = resolveAssets(dir, "heater");
    assert.equal(assets.body, "/heater0.png");
    assert.equal(assets.fan, "/aircon-fan2.png");
    assert.equal(assets.air, "/air2.png");
    assert.equal(usingFallback, true);
  });

  it("모르는 종류는 에어컨 에셋으로 처리한다", () => {
    const { assets } = resolveAssets(dir, "toaster");
    assert.equal(assets.body, "/aircon0.png");
  });

  it("경로는 항상 슬래시로 시작하는 URL이다", () => {
    for (const kind of DEVICE_KINDS) {
      for (const url of Object.values(resolveAssets(dir, kind).assets)) {
        assert.match(url, /^\/[\w.-]+\.png$/, `${url}는 URL 형태가 아니다`);
      }
    }
  });
});

describe("describeDevice", () => {
  it("종류와 에셋을 함께 돌려준다", () => {
    const device = describeDevice({
      mode: "auto",
      winterMonths: WINTER,
      publicDir: "/nonexistent",
      now: at(12),
      exists: () => false,
    });
    assert.equal(device.kind, "heater");
    assert.equal(device.usingFallback, true);
    assert.deepEqual(Object.keys(device.assets).sort(), ["air", "body", "fan"]);
  });

  it("여름에는 폴백이 아니다 (에어컨 에셋이 존재하므로)", () => {
    const device = describeDevice({
      mode: "auto",
      winterMonths: WINTER,
      publicDir: "/whatever",
      now: at(7),
      exists: () => true,
    });
    assert.equal(device.kind, "aircon");
    assert.equal(device.usingFallback, false);
  });
});

describe("상수", () => {
  it("DEVICE_MODES는 auto와 모든 기기 종류를 담는다", () => {
    assert.deepEqual(DEVICE_MODES, ["auto", "aircon", "heater"]);
    for (const kind of DEVICE_KINDS) assert.ok(DEVICE_MODES.includes(kind));
  });
});
