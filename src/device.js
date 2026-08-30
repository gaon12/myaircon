import { existsSync } from "node:fs";
import path from "node:path";

export const DEVICE_KINDS = ["aircon", "heater"];
export const DEVICE_MODES = ["auto", ...DEVICE_KINDS];

/**
 * 기기 종류별 이미지 경로.
 *
 * 온풍기 전용 에셋은 아직 없다. public/ 아래에 아래 이름으로 파일을 떨어뜨리면
 * 자동으로 그걸 쓰고, 없으면 파일 단위로 에어컨 이미지로 폴백한다. 본체만
 * 먼저 넣고 팬/바람은 에어컨 것을 그대로 쓰는 식도 가능하다.
 */
const ASSET_SETS = {
  aircon: { body: "/aircon0.png", fan: "/aircon-fan2.png", air: "/air2.png" },
  heater: { body: "/heater0.png", fan: "/heater-fan.png", air: "/heater-air.png" },
};

/**
 * 지금 어떤 기기를 보여줄지 정한다.
 *
 * 공유 온도계이므로 사용자마다 다른 기기를 보면 안 된다. 서버가 정해서
 * 모두에게 같은 값을 내려준다.
 *
 * @param {{ mode: string, winterMonths: number[], now?: Date }} options
 * @returns {"aircon"|"heater"}
 */
export function resolveDeviceKind({ mode, winterMonths, now = new Date() }) {
  if (DEVICE_KINDS.includes(mode)) return mode;
  // 서버의 로컬 시간대를 기준으로 한다. 배포 환경의 TZ를 맞춰 둘 것.
  const month = now.getMonth() + 1;
  return winterMonths.includes(month) ? "heater" : "aircon";
}

/**
 * 기기 종류에 맞는 이미지 경로를 만든다. 없는 파일은 에어컨 것으로 대체한다.
 *
 * @param {string} publicDir 정적 파일 루트
 * @param {"aircon"|"heater"} kind
 * @param {(relativeUrl: string) => boolean} [exists] 테스트용 주입 지점
 */
export function resolveAssets(publicDir, kind, exists) {
  const has = exists ?? ((url) => existsSync(path.join(publicDir, url.replace(/^\//, ""))));

  const wanted = ASSET_SETS[kind] ?? ASSET_SETS.aircon;
  const fallback = ASSET_SETS.aircon;

  const assets = {};
  let usingFallback = false;
  for (const slot of ["body", "fan", "air"]) {
    if (has(wanted[slot])) {
      assets[slot] = wanted[slot];
    } else {
      assets[slot] = fallback[slot];
      if (wanted[slot] !== fallback[slot]) usingFallback = true;
    }
  }
  return { assets, usingFallback };
}

/**
 * 클라이언트로 내려보낼 기기 정보.
 * @returns {{ kind: string, assets: { body: string, fan: string, air: string },
 *             usingFallback: boolean }}
 */
export function describeDevice({ mode, winterMonths, publicDir, now, exists }) {
  const kind = resolveDeviceKind({ mode, winterMonths, now });
  return { kind, ...resolveAssets(publicDir, kind, exists) };
}
