import { negotiateLocale } from "../../shared/negotiate.ts";
import type { Locale } from "./locale.ts";
import en from "./locales/en.ts";
import ja from "./locales/ja.ts";
import ko from "./locales/ko.ts";
import zhHans from "./locales/zh-Hans.ts";
import zhHant from "./locales/zh-Hant.ts";

/**
 * 언어를 추가하려면 locales/ 아래에 파일 하나를 만들고 여기 한 줄을 더하면 된다.
 * 나열 순서가 곧 언어 선택 목록의 순서다.
 *
 * 각 로케일 파일은 `satisfies Locale`로 계약을 검사받으므로, 키를 빠뜨리면
 * 화면에 undefined가 뜨는 대신 컴파일이 실패한다.
 */
export const locales = {
  ko,
  en,
  ja,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
} as const satisfies Record<string, Locale>;

export type LocaleCode = keyof typeof locales;

export const FALLBACK_LOCALE = "en" satisfies LocaleCode;
export const localeCodes = Object.keys(locales) as LocaleCode[];

/** 언어 선택 UI에 쓸 [코드, 표기명] 목록. 표기명은 해당 언어 자신의 이름이다. */
export const localeOptions: readonly (readonly [LocaleCode, string])[] = localeCodes.map(
  (code) => [code, locales[code].name] as const,
);

export function isSupportedLocale(code: unknown): code is LocaleCode {
  return typeof code === "string" && Object.hasOwn(locales, code);
}

/**
 * 저장된 선택이 있으면 그것을, 없으면 브라우저 선호 언어에서 협상한다.
 *
 * saved는 localStorage에서 온 값이라 무엇이든 될 수 있고, preferred는
 * navigator.languages라 브라우저마다 형태가 다르다. 둘 다 검증한다.
 *
 * @param saved 사용자가 이전에 고른 코드
 * @param preferred navigator.languages
 */
export function pickLocale(saved: unknown, preferred: unknown): LocaleCode {
  if (isSupportedLocale(saved)) return saved;
  const negotiated = negotiateLocale(preferred, localeCodes, FALLBACK_LOCALE);
  return isSupportedLocale(negotiated) ? negotiated : FALLBACK_LOCALE;
}

export type { Locale, PlainStringKey } from "./locale.ts";
export { negotiateLocale };
