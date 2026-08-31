/**
 * 닉네임에 쓸 수 있는 문자.
 *
 * 예전에는 보이지 않는 문자(제어문자, bidi 뒤집기, BOM)만 걸러내고 나머지는
 * 전부 통과시켰다. 그래서 이모지 도배, 결합 문자를 쌓아 글자를 화면 밖으로
 * 흘리는 장난(Zalgo), 罫線 문자로 그림 그리기가 전부 가능했다. 순위표에
 * 그런 이름이 올라오면 표가 무너진다.
 *
 * 이제는 반대로 **허용 목록**이다. 통과시킬 것만 적고 나머지는 지운다.
 * 새로운 유니코드 장난이 나와도 기본값이 "거절"이라 저절로 막힌다.
 *
 * ## 무엇을 허용하는가
 *
 * 한글, 영문, 숫자 -- 그리고 **가나와 한자도 넣었다**. 앱이 일본어와
 * 중국어 UI를 지원하기 때문이다. 그 언어로 들어온 사람이 자기 이름을 못
 * 쓰게 만들 수는 없다. 반대로 말하면 여기 있는 것은 전부 "이 앱이 이미
 * 화면에 쓰고 있는 문자"다.
 *
 * 이모지는 빠졌다. 아쉽지만 폭이 제각각이라 순위표 정렬이 깨지고, 도배에
 * 가장 많이 쓰이던 것이 이모지였다.
 */

/**
 * 허용 문자의 **여집합**. 여기 걸리는 것은 지운다.
 *
 * - `\p{Script=Hangul}` 완성형 한글과 자모
 * - `\p{Script=Latin}` 영문(악센트 포함). 유럽 이름을 막을 이유는 없다
 * - `\p{Script=Hiragana}` / `\p{Script=Katakana}` 일본어
 * - `\p{Script=Han}` 한자 (중국어·일본어·한국어 공용)
 * - `\p{Nd}` 십진 숫자
 * - `U+30FC` 장음 부호(ー). Script=Common이라 위에 안 걸리는데,
 *   일본어 이름에 사실상 필수다
 * - 공백. normalizeNickname이 이미 한 칸으로 접어 두었다
 */
const DISALLOWED =
  /[^\p{Script=Hangul}\p{Script=Latin}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Nd}\u30FC ]/gu;

/**
 * 쓸 수 없는 문자를 지운다.
 *
 * 거절하지 않고 지우는 쪽을 골랐다. 클라이언트에서는 입력하는 동안 조용히
 * 걸러 주는 편이 "이 글자는 안 됩니다"를 띄우는 것보다 손이 덜 가고,
 * 서버에서는 어차피 무엇이 와도 유효한 이름 하나를 만들어 내야 한다.
 * 전부 지워져 빈 문자열이 되는 경우는 부르는 쪽에서 처리한다.
 */
export function stripDisallowed(text: string): string {
  return text.replace(DISALLOWED, "");
}

/** 이 문자열이 통째로 쓸 수 있는 문자로만 되어 있는가. 화면 안내용. */
export function isAllowedNickname(text: string): boolean {
  return text !== "" && stripDisallowed(text) === text;
}
