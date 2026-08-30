import en from "./locales/en.js";
import ja from "./locales/ja.js";
import ko from "./locales/ko.js";
import zhHans from "./locales/zh-Hans.js";
import zhHant from "./locales/zh-Hant.js";
import { negotiateLocale } from "./negotiate.js";

/**
 * 언어를 추가하려면 locales/ 아래에 파일 하나를 만들고 여기 한 줄을 더하면 된다.
 * 순서가 곧 언어 선택 목록의 순서다.
 */
export const locales = {
  ko,
  en,
  ja,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

export const FALLBACK_LOCALE = "en";
export const localeCodes = Object.keys(locales);

/** 언어 선택 UI에 쓸 [코드, 표기명] 목록. 표기명은 해당 언어 자신의 이름이다. */
export const localeOptions = localeCodes.map((code) => [code, locales[code].name]);

export function isSupportedLocale(code) {
  return Object.hasOwn(locales, code);
}

/**
 * 저장된 선택이 있으면 그것을, 없으면 브라우저 선호 언어에서 협상한다.
 * @param {string|null} saved 사용자가 이전에 고른 코드
 * @param {string[]} preferred navigator.languages
 */
export function pickLocale(saved, preferred) {
  if (typeof saved === "string" && isSupportedLocale(saved)) return saved;
  return negotiateLocale(preferred, localeCodes, FALLBACK_LOCALE);
}

export { negotiateLocale };
