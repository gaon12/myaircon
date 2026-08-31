import { type AutomationSignal, headlessUserAgent } from "../shared/automation.ts";

/**
 * 브라우저에서 볼 수 있는 것만 추린 것. 실제 DOM 대신 이 구조를 받게 해서
 * 순수 함수로 만들었다 -- 그래야 Node에서 시험할 수 있다.
 */
export type BrowserScope = {
  /** navigator.webdriver 의 원본 값. */
  readonly webdriver: unknown;
  readonly userAgent: string;
  /** window 의 자체 프로퍼티 이름들. */
  readonly windowKeys: readonly string[];
  /** document 의 자체 프로퍼티 이름들. */
  readonly documentKeys: readonly string[];
  /** <html webdriver> 속성이 붙어 있는지. ChromeDriver가 붙일 때가 있다. */
  readonly webdriverAttribute: boolean;
};

/**
 * 각 흔적을 알아보는 규칙.
 *
 * 여기 있는 것은 전부 "정상 브라우저에는 없어야 정상인" 이름들이다.
 * navigator.plugins.length === 0 이나 window.chrome 부재 같은 고전적인
 * 헤드리스 판별법은 일부러 뺐다. 모바일 사파리와 파이어폭스가 그대로
 * 걸린다 -- 진짜 사용자를 자동화로 모는 검사는 없느니만 못하다.
 */
const WINDOW_PATTERNS: ReadonlyArray<readonly [AutomationSignal, RegExp]> = [
  ["selenium", /^(_Selenium_IDE_Recorder|__selenium|__webdriver|__driver|__fxdriver)/],
  ["playwright", /^(__playwright|__pw_|__PW_)/],
  ["puppeteer", /^__puppeteer/],
  ["legacy-harness", /^(_phantom|callPhantom|__nightmare|domAutomation)/],
];

const DOCUMENT_PATTERNS: ReadonlyArray<readonly [AutomationSignal, RegExp]> = [
  // ChromeDriver가 document에 심는 $cdc_asdjflasutopfhvcZLmcfl_ 계열.
  ["selenium", /^(\$cdc_|\$wdc_|__selenium|__webdriver|__driver|__fxdriver)/],
];

/** 주어진 관찰값에서 흔적을 뽑는다. 중복 없이, 선언 순서대로. */
export function detectFrom(scope: BrowserScope): AutomationSignal[] {
  const found = new Set<AutomationSignal>();

  if (scope.webdriver === true) found.add("webdriver");
  if (scope.webdriverAttribute) found.add("selenium");
  if (headlessUserAgent(scope.userAgent)) found.add("headless-ua");

  for (const [signal, pattern] of WINDOW_PATTERNS) {
    if (scope.windowKeys.some((key) => pattern.test(key))) found.add(signal);
  }
  for (const [signal, pattern] of DOCUMENT_PATTERNS) {
    if (scope.documentKeys.some((key) => pattern.test(key))) found.add(signal);
  }

  return [...found];
}

/** 예외를 밖으로 내보내지 않는 프로퍼티 나열. 적대적인 Proxy가 던질 수 있다. */
function ownKeys(target: object | undefined): string[] {
  if (target === undefined) return [];
  try {
    return Object.getOwnPropertyNames(target);
  } catch {
    return [];
  }
}

/**
 * 실제 브라우저 전역에서 흔적을 읽는다.
 *
 * 감지에 실패해도 앱이 멈추면 안 된다. 어떤 단계에서 던지든 빈 배열이다.
 * 자동화를 놓치는 것보다 사용자 화면을 깨뜨리는 쪽이 훨씬 나쁘다.
 */
export function detectAutomation(): AutomationSignal[] {
  try {
    return detectFrom({
      webdriver: navigator.webdriver,
      userAgent: navigator.userAgent,
      windowKeys: ownKeys(window),
      documentKeys: ownKeys(document),
      webdriverAttribute: document.documentElement.hasAttribute("webdriver"),
    });
  } catch {
    return [];
  }
}
