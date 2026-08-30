/**
 * 브라우저가 알려준 선호 언어 목록에서 우리가 가진 로케일 하나를 고른다.
 *
 * 순수 함수라 브라우저 없이 Node에서 그대로 테스트할 수 있다.
 */

// 중국어는 지역 코드만으로는 자형(간체/번체)을 알 수 없다. zh-CN은 간체,
// zh-TW는 번체이므로 지역 -> 자형 매핑이 필요하다.
const CHINESE_SCRIPT_BY_REGION = {
  cn: "Hans",
  sg: "Hans",
  my: "Hans",
  tw: "Hant",
  hk: "Hant",
  mo: "Hant",
};
const DEFAULT_CHINESE_SCRIPT = "Hans";

/**
 * BCP-47 태그를 { language, script, region }으로 쪼갠다.
 * 서브태그 길이로 종류를 구분한다(script는 4글자, region은 2글자 또는 3자리 숫자).
 */
export function parseTag(tag) {
  if (typeof tag !== "string") return null;
  const parts = tag.trim().replace(/_/g, "-").split("-").filter(Boolean);
  if (parts.length === 0) return null;

  const language = parts[0].toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return null;

  let script = null;
  let region = null;
  for (const part of parts.slice(1)) {
    if (script === null && /^[a-z]{4}$/i.test(part)) {
      script = part[0].toUpperCase() + part.slice(1).toLowerCase();
    } else if (region === null && /^([a-z]{2}|\d{3})$/i.test(part)) {
      region = part.toLowerCase();
    }
  }
  return { language, script, region };
}

/**
 * 요청 태그 하나를 우리가 가진 로케일 코드로 정규화한다.
 * @returns {string|null} 우리가 가진 코드, 매칭 실패 시 null
 */
function resolveTag(tag, availableCodes) {
  const parsed = parseTag(tag);
  if (parsed === null) return null;

  const lower = new Map(availableCodes.map((code) => [code.toLowerCase(), code]));
  const pick = (candidate) => lower.get(candidate.toLowerCase()) ?? null;

  // 1) 태그 전체가 그대로 있는 경우 (zh-Hant 등)
  const exact = pick([parsed.language, parsed.script, parsed.region].filter(Boolean).join("-"));
  if (exact !== null) return exact;

  // 2) 중국어는 자형까지 결정해야 한다
  if (parsed.language === "zh") {
    const script =
      parsed.script ??
      (parsed.region ? CHINESE_SCRIPT_BY_REGION[parsed.region] : null) ??
      DEFAULT_CHINESE_SCRIPT;
    const byScript = pick(`zh-${script}`);
    if (byScript !== null) return byScript;
  }

  // 3) 언어 + 자형
  if (parsed.script !== null) {
    const withScript = pick(`${parsed.language}-${parsed.script}`);
    if (withScript !== null) return withScript;
  }

  // 4) 언어만 (en-GB -> en)
  const byLanguage = pick(parsed.language);
  if (byLanguage !== null) return byLanguage;

  // 5) 같은 언어의 아무 변형이라도 (zh-XX -> zh-Hans)
  const sameLanguage = availableCodes.find((code) => {
    const other = parseTag(code);
    return other !== null && other.language === parsed.language;
  });
  return sameLanguage ?? null;
}

/**
 * @param {string[]} requested 선호 순서대로 정렬된 BCP-47 태그 (navigator.languages)
 * @param {string[]} availableCodes 우리가 가진 로케일 코드
 * @param {string} fallback 아무것도 맞지 않을 때 쓸 코드
 * @returns {string}
 */
export function negotiateLocale(requested, availableCodes, fallback) {
  const tags = Array.isArray(requested) ? requested : [requested];
  for (const tag of tags) {
    const resolved = resolveTag(tag, availableCodes);
    if (resolved !== null) return resolved;
  }
  return fallback;
}
