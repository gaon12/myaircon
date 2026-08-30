// 제어문자와 눈에 보이지 않는 서식 문자들. 닉네임에 들어가면 표시가 깨지거나
// 텍스트 방향을 뒤집는 장난(bidi override)이 가능하다.
// ZWJ(U+200D)와 variation selector는 이모지 조합에 필요하므로 일부러 남겨둔다.
const INVISIBLE = /[\p{Cc}\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u2028\u2029]/gu;
const WHITESPACE_RUN = /\s+/g;

// 코드 유닛이 아니라 grapheme 단위로 잘라야 이모지/한글 조합이 깨지지 않는다.
// 기존 코드의 `arg.substring(0, 9)`는 UTF-16 코드 유닛 기준이라 이모지의
// surrogate pair를 반토막 내서 U+FFFD로 깨진 닉네임을 브로드캐스트했다.
const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

function truncateGraphemes(text, maxLength) {
  let count = 0;
  let end = 0;
  for (const { segment, index } of segmenter.segment(text)) {
    if (count >= maxLength) break;
    count += 1;
    end = index + segment.length;
  }
  return text.slice(0, end);
}

/**
 * 클라이언트가 보낸 닉네임을 신뢰할 수 없는 입력으로 취급해 정규화한다.
 *
 * 기존 코드는 `arg.substring(0, 9)` 한 줄이 전부여서
 *   - 문자열이 아닌 값(숫자/null/객체)이 오면 TypeError가 나고, 그 예외가
 *     rate limit용 catch에 삼켜져 사용자에게 "너무 잦은 요청"이라고 거짓
 *     안내가 나갔다.
 *   - 이모지가 코드 유닛 경계에서 잘렸다.
 *   - 빈 문자열/공백만 있는 닉네임이 그대로 통과했다.
 * 이 함수는 어떤 입력이 와도 예외를 던지지 않고 항상 유효한 문자열을 준다.
 *
 * @param {unknown} raw
 * @param {{ maxLength: number, fallback: string }} options
 * @returns {string}
 */
export function normalizeNickname(raw, { maxLength, fallback }) {
  if (typeof raw !== "string") return fallback;

  const cleaned = raw.normalize("NFC").replace(INVISIBLE, "").replace(WHITESPACE_RUN, " ").trim();

  if (cleaned === "") return fallback;

  const truncated = truncateGraphemes(cleaned, maxLength).trim();
  return truncated === "" ? fallback : truncated;
}
