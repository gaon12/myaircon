import { arrayOf, type Infer, literal, object } from "./validate.ts";

/**
 * 자동화 도구의 흔적.
 *
 * 대부분은 **클라이언트가 보고하는 값**이라 위조할 수 있다. 애초에
 * puppeteer-extra-stealth 같은 도구의 존재 이유가 아래 흔적을 지우는 것이다.
 * 그러니 이걸로 차단하면 안 된다. 무성의한 자동화의 비용을 올리는 정도가
 * 정직한 쓰임새다.
 *
 * 오탐도 고려해야 한다. 접근성 도구, 자체 모니터링, CI, 링크 미리보기가
 * 여기 걸릴 수 있다. 기본값이 "점수 가산"인 이유이고, 점수를 0으로 두면
 * 아예 끌 수 있다.
 */
export const AUTOMATION_SIGNALS = [
  /** navigator.webdriver === true. WebDriver 표준이 켜는 값. */
  "webdriver",
  /** ChromeDriver가 document에 남기는 $cdc_ 계열 프로퍼티 등. */
  "selenium",
  /** window.__playwright / __pw_ 계열. */
  "playwright",
  /** window.__puppeteer_evaluation_script__ 등. */
  "puppeteer",
  /** PhantomJS, Nightmare, domAutomationController 같은 구형·기타 하네스. */
  "legacy-harness",
  /** User-Agent에 Headless가 들어 있다. */
  "headless-ua",
  /** User-Agent가 스스로 도구임을 밝힌다(curl, python-requests, scrapy 등). */
  "tool-ua",
] as const;
export type AutomationSignal = (typeof AUTOMATION_SIGNALS)[number];

/**
 * 소켓 핸드셰이크에 실려 오는 보고.
 *
 * 종류가 유한하므로 길이를 종류 수로 묶어 둔다. 검증기가 긴 배열을 붙들고
 * 있게 만드는 것 자체가 공격이 될 수 있다.
 */
export const automationReportSchema = object({
  signals: arrayOf(literal(...AUTOMATION_SIGNALS), { maxItems: AUTOMATION_SIGNALS.length }),
});
export type AutomationReport = Infer<typeof automationReportSchema>;

// ---------------------------------------------------------------- User-Agent

/**
 * 헤드리스임을 스스로 밝히는 User-Agent.
 *
 * Chrome은 --headless로 띄우면 UA에 HeadlessChrome을 넣는다. 새 헤드리스
 * 모드에서는 넣지 않으므로 이건 아주 낮은 난이도의 검사다. 그래도 비용이
 * 정규식 하나이므로 뺄 이유가 없다.
 */
const HEADLESS_UA = /headless(chrome|_chrome)?|phantomjs|slimerjs|htmlunit/i;

/**
 * 스스로 도구임을 밝히는 User-Agent.
 *
 * 검색엔진 크롤러(Googlebot 등)는 일부러 넣지 않았다. 정직하게 밝히고
 * robots.txt를 지키는 쪽을 벌하면 신고할 이유를 없애는 셈이다.
 */
const TOOL_UA =
  /\b(puppeteer|playwright|selenium|webdriver|chromedriver|geckodriver|cypress|scrapy|python-requests|aiohttp|httpx|go-http-client|okhttp|node-fetch|axios|libwww-perl|curl|wget|java|apache-httpclient)\b/i;

export function headlessUserAgent(userAgent: string): boolean {
  return HEADLESS_UA.test(userAgent);
}

export function toolUserAgent(userAgent: string): boolean {
  return TOOL_UA.test(userAgent);
}

/** User-Agent 하나에서 나오는 흔적. 서버는 이것만 위조 없이 볼 수 있다. */
export function signalsFromUserAgent(userAgent: string | undefined): AutomationSignal[] {
  if (userAgent === undefined || userAgent === "") return [];
  const found: AutomationSignal[] = [];
  if (headlessUserAgent(userAgent)) found.push("headless-ua");
  if (toolUserAgent(userAgent)) found.push("tool-ua");
  return found;
}
