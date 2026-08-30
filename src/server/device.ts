import { existsSync } from "node:fs";
import path from "node:path";
import {
  ASSET_SLOTS,
  type AssetSlot,
  DEVICE_KINDS,
  type DeviceInfo,
  type DeviceKind,
  type DeviceMode,
} from "../shared/protocol.ts";

export { DEVICE_KINDS, DEVICE_MODES } from "../shared/protocol.ts";

type AssetSet = Record<AssetSlot, string>;

/**
 * 기기 종류별 이미지 경로.
 *
 * 온풍기 전용 에셋은 아직 없다. public/ 아래에 아래 이름으로 파일을 떨어뜨리면
 * 자동으로 그걸 쓰고, 없으면 파일 단위로 에어컨 이미지로 폴백한다. 본체만
 * 먼저 넣고 팬/바람은 에어컨 것을 그대로 쓰는 식도 가능하다.
 */
const ASSET_SETS: Record<DeviceKind, AssetSet> = {
  aircon: { body: "/aircon0.png", fan: "/aircon-fan2.png", air: "/air2.png" },
  heater: { body: "/heater0.png", fan: "/heater-fan.png", air: "/heater-air.png" },
};

const isDeviceKind = (value: unknown): value is DeviceKind =>
  DEVICE_KINDS.includes(value as DeviceKind);

/**
 * 시간대 이름이 이 런타임에서 실제로 쓸 수 있는지 확인한다.
 * 오타난 시간대를 조용히 무시하면 계절이 엉뚱하게 판정된다.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 지정한 시간대 기준의 월(1~12)을 구한다.
 *
 * 계절 판정은 접속자가 아니라 **서버 시간** 기준이다. 공유 기기이므로 보는
 * 사람마다 계절이 달라지면 안 된다. 다만 "서버의 프로세스 TZ"에 암묵적으로
 * 기대면 배포 환경(대부분의 컨테이너가 UTC)에 따라 결과가 달라지므로,
 * 시간대를 명시적으로 설정할 수 있게 했다.
 */
export function monthIn(date: Date, timeZone: string | null): number {
  if (timeZone === null || timeZone === "") return date.getMonth() + 1;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    // 달력 체계가 지역 설정에 휘둘리지 않도록 고정한다.
    calendar: "gregory",
  }).format(date);
  return Number.parseInt(formatted, 10);
}

export type DeviceOptions = {
  mode: DeviceMode | string;
  winterMonths: readonly number[];
  /** null이면 서버 프로세스의 로컬 시간대를 쓴다. */
  timeZone?: string | null | undefined;
  now?: Date | undefined;
};

/**
 * 지금 어떤 기기를 보여줄지 정한다.
 *
 * 공유 온도계이므로 사용자마다 다른 기기를 보면 안 된다. 서버가 정해서
 * 모두에게 같은 값을 내려준다.
 */
export function resolveDeviceKind({
  mode,
  winterMonths,
  timeZone = null,
  now = new Date(),
}: DeviceOptions): DeviceKind {
  if (isDeviceKind(mode)) return mode;
  return winterMonths.includes(monthIn(now, timeZone)) ? "heater" : "aircon";
}

export type ResolvedAssets = {
  assets: AssetSet;
  usingFallback: boolean;
};

/**
 * 기기 종류에 맞는 이미지 경로를 만든다. 없는 파일은 에어컨 것으로 대체한다.
 *
 * @param exists 테스트용 주입 지점
 */
export function resolveAssets(
  publicDir: string,
  kind: string,
  exists?: (relativeUrl: string) => boolean,
): ResolvedAssets {
  const has = exists ?? ((url: string) => existsSync(path.join(publicDir, url.replace(/^\//, ""))));

  const fallback = ASSET_SETS.aircon;
  const wanted = isDeviceKind(kind) ? ASSET_SETS[kind] : fallback;

  const assets = { ...fallback };
  let usingFallback = false;
  for (const slot of ASSET_SLOTS) {
    if (has(wanted[slot])) {
      assets[slot] = wanted[slot];
    } else if (wanted[slot] !== fallback[slot]) {
      usingFallback = true;
    }
  }
  return { assets, usingFallback };
}

export type DescribeDeviceOptions = DeviceOptions & {
  publicDir: string;
  exists?: ((relativeUrl: string) => boolean) | undefined;
};

/** 클라이언트로 내려보낼 기기 정보. */
export function describeDevice({
  publicDir,
  exists,
  ...options
}: DescribeDeviceOptions): DeviceInfo {
  const kind = resolveDeviceKind(options);
  return { kind, ...resolveAssets(publicDir, kind, exists) };
}
