import { pickCharacter } from "../shared/characters.ts";

/**
 * 브라우저가 이 앱을 돌릴 수 있는지 확인한다.
 *
 * IE와 ES 모듈을 모르는 브라우저는 여기까지 오지도 못한다. 진입점이
 * <script type="module">이라 그런 브라우저는 아예 건너뛰고, 마크업의
 * <script nomodule>이 대신 안내를 띄운다.
 *
 * 여기서 잡는 것은 "모듈은 되는데 필요한 API가 없는" 중간 세대다.
 * 목록은 실제로 코드가 쓰는 것만 담았다. 억지로 늘리면 멀쩡한 브라우저를
 * 막게 된다.
 *
 * 이 목록이 요구하는 대략의 하한: Chrome 93 / Firefox 98 / Safari 15.4.
 * <dialog>.showModal이 가장 늦게 들어온 축이라 사실상 그것이 하한을 정한다.
 */

type Check = { readonly name: string; readonly ok: () => boolean };

const CHECKS: readonly Check[] = [
  { name: "ES modules", ok: () => true }, // 여기까지 실행됐다면 통과
  {
    name: "<dialog>.showModal",
    ok: () =>
      typeof HTMLDialogElement !== "undefined" && "showModal" in HTMLDialogElement.prototype,
  },
  { name: "Element.replaceChildren", ok: () => "replaceChildren" in Element.prototype },
  { name: "Array.prototype.at", ok: () => typeof [].at === "function" },
  { name: "Object.hasOwn", ok: () => typeof Object.hasOwn === "function" },
  { name: "AbortController", ok: () => typeof AbortController === "function" },
  { name: "MutationObserver", ok: () => typeof MutationObserver === "function" },
  { name: "Intl.DateTimeFormat", ok: () => typeof Intl?.DateTimeFormat === "function" },
];

/** 없는 기능의 이름들. 비어 있으면 지원되는 브라우저다. */
export function missingFeatures(): string[] {
  return CHECKS.filter((check) => {
    try {
      return !check.ok();
    } catch {
      return true;
    }
  }).map((check) => check.name);
}

/**
 * 안내를 띄우고 본문을 숨긴다.
 *
 * 마크업에 이미 있는 요소를 드러내는 방식이라, 스크립트가 여기까지만 돌아도
 * 사용자는 무엇이 문제인지 읽을 수 있다. 실패한 기능 이름은 개발자가 볼 수
 * 있도록 콘솔에만 남긴다 -- 화면에 "Object.hasOwn"이라고 띄워봐야 소용없다.
 *
 * 캐릭터는 마크업에 이미 scan_1이 박혀 있다. 여기까지 왔다는 것은 스크립트가
 * 돌긴 한다는 뜻이므로 그때만 무작위로 바꾼다. IE처럼 이 함수에 닿지도 못하는
 * 브라우저는 마크업의 것을 그대로 본다 -- 고정 캐릭터라도 나오는 편이,
 * 스크립트로 채우려다 빈 자리를 남기는 것보다 낫다.
 */
export function showLegacyNotice(missing: readonly string[]): void {
  document.documentElement.classList.add("is-legacy");
  if (missing.length > 0) {
    console.warn(`지원되지 않는 브라우저입니다. 없는 기능: ${missing.join(", ")}`);
  }
  try {
    const image = document.querySelector("[data-legacy-image]");
    if (image instanceof HTMLImageElement) {
      image.src = `/img/scan_${pickCharacter()}.png`;
    }
  } catch {
    // 마크업의 기본 캐릭터가 그대로 남는다. 안내를 띄우는 것이 본업이므로
    // 그림 하나 때문에 여기서 멈추면 안 된다.
  }
}
