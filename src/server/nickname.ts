import { stripDisallowed } from "../shared/nickname-charset.ts";

// 닉네임에서 걸러낼 문자들.
//   \p{Cc}          제어문자
//   U+200B          zero-width space
//   U+200E, U+200F  LRM / RLM
//   U+202A-U+202E   bidi embedding / override (표시 방향을 뒤집는 장난)
//   U+2066-U+2069   bidi isolate
//   U+FEFF          BOM
//   U+2028, U+2029  line / paragraph separator
// ZWJ(U+200D)와 variation selector는 이모지 조합에 필요하므로 일부러 남겨둔다.
const INVISIBLE = /[\p{Cc}\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u2028\u2029]/gu;

// 탭/개행도 제어문자(\p{Cc})에 속한다. INVISIBLE로 그냥 지워버리면 "a<TAB>b"가
// "ab"로 붙어 단어 경계가 사라지므로, 지우기 전에 공백으로 바꿔둔다.
const WHITESPACE_CONTROL = /[\t\n\v\f\r]/g;
const WHITESPACE_RUN = /\s+/g;

// 코드 유닛이 아니라 grapheme 단위로 잘라야 한글 조합이 깨지지 않는다.
// 기존 코드의 `arg.substring(0, 9)`는 UTF-16 코드 유닛 기준이라 문자를
// 반토막 내서 U+FFFD로 깨진 닉네임을 브로드캐스트했다.
const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

export type NicknameOptions = {
  /** grapheme(사용자가 인지하는 글자) 기준 최대 길이 */
  maxLength: number;
  /** 비었거나 쓸 수 없는 입력일 때 대신 쓸 이름 */
  fallback: string;
};

function truncateGraphemes(text: string, maxLength: number): string {
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
 * 순서가 중요하다. 보이지 않는 문자를 먼저 지우고, 그 다음 허용 문자만
 * 남긴다. 반대로 하면 "a<ZWSP>b" 같은 입력에서 ZWSP가 허용 목록에 걸려
 * 지워지는 것은 같지만, 제어문자를 공백으로 바꾸는 단계를 놓친다.
 * 마지막에 공백을 접는 것도 이 뒤여야 한다 -- 문자를 지우고 나면 공백이
 * 두 칸씩 남기 때문이다("a@@b" -> "a  b" 가 아니라 "ab").
 *
 * 기존 코드는 `arg.substring(0, 9)` 한 줄이 전부여서
 *   - 문자열이 아닌 값(숫자/null/객체)이 오면 TypeError가 나고, 그 예외가
 *     rate limit용 catch에 삼켜져 사용자에게 "너무 잦은 요청"이라는 거짓
 *     안내가 나갔다.
 *   - 이모지가 코드 유닛 경계에서 잘렸다.
 *   - 빈 문자열/공백만 있는 닉네임이 그대로 통과했다.
 * 이 함수는 어떤 입력이 와도 예외를 던지지 않고 항상 유효한 문자열을 준다.
 *
 */
export function normalizeNickname(raw: unknown, { maxLength, fallback }: NicknameOptions): string {
  if (typeof raw !== "string") return fallback;

  const cleaned = stripDisallowed(
    raw.normalize("NFC").replace(WHITESPACE_CONTROL, " ").replace(INVISIBLE, ""),
  )
    .replace(WHITESPACE_RUN, " ")
    .trim();

  if (cleaned === "") return fallback;

  const truncated = truncateGraphemes(cleaned, maxLength).trim();
  return truncated === "" ? fallback : truncated;
}
