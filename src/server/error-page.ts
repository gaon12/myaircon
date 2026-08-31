import { pickCharacter } from "../shared/characters.ts";
import { negotiateLocale } from "../shared/negotiate.ts";

/**
 * 오류를 사람이 읽는 화면으로 내놓는다.
 *
 * 원래는 전부 Fastify 기본값인 JSON이었다. 주소를 잘못 친 방문자에게
 * `{"message":"Route GET:/nope not found","error":"Not Found",...}`를 보여주는
 * 것은 아무 도움이 안 된다.
 *
 * 그렇다고 전부 HTML로 바꿀 수도 없다. `/api/*`는 앱 자신이 fetch로 부르고,
 * 가동 감시나 curl도 JSON을 기대한다. 그래서 **요청이 무엇을 원하는지 보고**
 * 고른다 -- 아래 wantsHtml()이 그 판단이다.
 */

// ------------------------------------------------------------------ 문구

/**
 * 오류 화면에 쓰는 문구.
 *
 * 클라이언트 로케일(`src/client/i18n/locales/`)을 가져다 쓰지 않았다. 그쪽은
 * 100개가 넘는 키에 함수까지 들어 있는 브라우저용 모듈이라, 서버가 그걸
 * import 하는 순간 빌드가 뒤엉킨다(서버는 src/server + src/shared만 컴파일한다).
 * 언어당 문장 서너 개를 여기 적어 두는 편이 훨씬 싸다.
 *
 * 대신 **언어 목록과 협상 규칙은 공유한다**. 같은 방문자가 앱에서는 한국어를,
 * 오류 화면에서는 영어를 보게 되면 그게 더 이상하다.
 */
type ErrorStrings = {
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly serverTitle: string;
  readonly serverBody: string;
  readonly rateTitle: string;
  readonly rateBody: string;
  readonly genericTitle: string;
  readonly genericBody: string;
  readonly home: string;
};

const STRINGS = {
  ko: {
    notFoundTitle: "여기엔 아무것도 없어요",
    notFoundBody: "주소가 잘못됐거나, 페이지가 사라졌습니다.",
    serverTitle: "서버가 잠깐 문제를 일으켰어요",
    serverBody: "잠시 뒤에 다시 시도해 주세요.",
    rateTitle: "너무 빨라요",
    rateBody: "잠시 뒤에 다시 시도해 주세요.",
    genericTitle: "요청을 처리하지 못했어요",
    genericBody: "주소를 다시 확인해 주세요.",
    home: "에어컨으로 돌아가기",
  },
  en: {
    notFoundTitle: "Nothing here",
    notFoundBody: "The address is wrong, or the page is gone.",
    serverTitle: "The server tripped over something",
    serverBody: "Please try again in a moment.",
    rateTitle: "Too fast",
    rateBody: "Please try again in a moment.",
    genericTitle: "That request did not go through",
    genericBody: "Please check the address.",
    home: "Back to the aircon",
  },
  ja: {
    notFoundTitle: "ここには何もありません",
    notFoundBody: "アドレスが違うか、ページがなくなりました。",
    serverTitle: "サーバーで問題が起きました",
    serverBody: "しばらくしてからもう一度お試しください。",
    rateTitle: "速すぎます",
    rateBody: "しばらくしてからもう一度お試しください。",
    genericTitle: "リクエストを処理できませんでした",
    genericBody: "アドレスをご確認ください。",
    home: "エアコンに戻る",
  },
  "zh-Hans": {
    notFoundTitle: "这里什么都没有",
    notFoundBody: "地址有误，或者页面已经不在了。",
    serverTitle: "服务器出了点问题",
    serverBody: "请稍后再试。",
    rateTitle: "太快了",
    rateBody: "请稍后再试。",
    genericTitle: "请求没有成功",
    genericBody: "请检查地址。",
    home: "回到空调",
  },
  "zh-Hant": {
    notFoundTitle: "這裡什麼都沒有",
    notFoundBody: "網址有誤，或者頁面已經不在了。",
    serverTitle: "伺服器出了點問題",
    serverBody: "請稍後再試。",
    rateTitle: "太快了",
    rateBody: "請稍後再試。",
    genericTitle: "請求沒有成功",
    genericBody: "請檢查網址。",
    home: "回到冷氣",
  },
} as const satisfies Record<string, ErrorStrings>;

type ErrorLocaleCode = keyof typeof STRINGS;

const LOCALE_CODES = Object.keys(STRINGS) as ErrorLocaleCode[];
const FALLBACK = "en" satisfies ErrorLocaleCode;

function isErrorLocale(code: string): code is ErrorLocaleCode {
  return Object.hasOwn(STRINGS, code);
}

// ------------------------------------------------- Accept-Language 해석

/**
 * `Accept-Language`를 선호 순서대로 정렬한 태그 목록으로 바꾼다.
 *
 * `ko-KR,ko;q=0.9,en;q=0.8` 처럼 q값이 섞여 온다. q가 없으면 1.0이고,
 * `q=0`은 "이 언어는 싫다"는 뜻이라 빼야 한다.
 *
 * 헤더는 아무나 보낼 수 있으므로 길이를 자른다. 태그 수천 개짜리 헤더로
 * 정렬을 시키는 것 자체가 공격이 될 수 있다.
 */
const MAX_TAGS = 20;

export function parseAcceptLanguage(header: string | undefined): string[] {
  if (header === undefined || header === "") return [];
  const scored: { tag: string; q: number; order: number }[] = [];
  const parts = header.split(",", MAX_TAGS);
  for (const [order, raw] of parts.entries()) {
    const [tagPart, ...params] = raw.split(";");
    const tag = tagPart?.trim() ?? "";
    if (tag === "" || tag === "*") continue;

    let q = 1;
    for (const param of params) {
      const match = /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(param);
      if (match?.[1] !== undefined) {
        const parsed = Number.parseFloat(match[1]);
        if (Number.isFinite(parsed)) q = parsed;
      }
    }
    if (q <= 0) continue;
    scored.push({ tag, q, order });
  }
  // q가 같으면 헤더에 적힌 순서를 지킨다. sort는 안정 정렬이지만 명시해 둔다.
  scored.sort((a, b) => b.q - a.q || a.order - b.order);
  return scored.map((entry) => entry.tag);
}

/** 이 요청에 어떤 언어로 답할지. 앱과 같은 협상 규칙을 쓴다. */
export function pickErrorLocale(acceptLanguage: string | undefined): ErrorLocaleCode {
  const code = negotiateLocale(parseAcceptLanguage(acceptLanguage), LOCALE_CODES, FALLBACK);
  return isErrorLocale(code) ? code : FALLBACK;
}

// ------------------------------------------------------------ 형식 선택

/**
 * 이 요청에 HTML을 돌려줘야 하는가.
 *
 * 두 가지를 본다.
 *
 * 1. `/api/*` 는 무조건 JSON이다. 브라우저 주소창에 직접 쳐 넣어도 그렇다.
 *    이쪽을 HTML로 바꾸면 앱의 fetch와 가동 감시가 조용히 깨진다.
 * 2. 나머지는 Accept 헤더를 본다. `text/html`을 명시적으로 원할 때만 HTML이다.
 *
 * 와일드카드만 있는 Accept(curl의 기본값)를 HTML로 치지 않는 것이 중요하다.
 * 그렇게 하면 스크립트와 감시 도구가 전부 HTML을 받게 된다. 브라우저는 실제로
 * `text/html`을 앞에 적어 보내므로 이 구분으로 충분하다.
 */
export function wantsHtml(request: { url: string; accept: string | undefined }): boolean {
  if (request.url.startsWith("/api/")) return false;
  const accept = request.accept;
  if (accept === undefined) return false;
  return accept.split(",").some((part) => part.trim().toLowerCase().startsWith("text/html"));
}

// ------------------------------------------------------------ 렌더링

/**
 * HTML 특수문자를 막는다.
 *
 * 지금 넣는 값은 전부 우리가 쓴 상수라 필요 없어 보이지만, 그건 오늘의
 * 사실일 뿐이다. 나중에 누군가 경로나 오류 메시지를 화면에 넣고 싶어질 때
 * 이 함수가 없으면 그대로 XSS가 된다. Fastify 기본 404 메시지가 이미
 * 요청 경로를 그대로 담고 있다.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function headingFor(status: number, strings: ErrorStrings): { title: string; body: string } {
  if (status === 404) return { title: strings.notFoundTitle, body: strings.notFoundBody };
  if (status === 429) return { title: strings.rateTitle, body: strings.rateBody };
  if (status >= 500) return { title: strings.serverTitle, body: strings.serverBody };
  return { title: strings.genericTitle, body: strings.genericBody };
}

export type ErrorPageOptions = {
  status: number;
  acceptLanguage?: string | undefined;
  /** 시험에서 캐릭터를 고정하기 위한 구멍. 실제로는 매번 무작위다. */
  random?: (() => number) | undefined;
};

/**
 * 오류 화면 한 장.
 *
 * 스크립트가 없다. CSP가 `script-src 'self'`라 인라인 스크립트를 쓸 수 없고,
 * 애초에 이 화면에 동작이 필요 없다. 스타일도 앱과 같은 `/styles.css`를
 * 그대로 쓴다 -- 이미 받아 둔 파일이라 대개 캐시에서 나오고, 색 토큰이 같아서
 * 다크 모드가 저절로 따라온다.
 *
 * 상태 코드 말고는 아무것도 밝히지 않는다. 어떤 라우트가 왜 터졌는지는
 * 로그에 남고, 화면에는 남기지 않는다.
 */
export function renderErrorPage(options: ErrorPageOptions): string {
  const { status, acceptLanguage, random } = options;
  const code = pickErrorLocale(acceptLanguage);
  const strings = STRINGS[code];
  const { title, body } = headingFor(status, strings);
  const character = pickCharacter(random);

  return `<!DOCTYPE html>
<html lang="${escapeHtml(code)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="noindex" />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="error-body">
    <main class="error-page">
      <img
        class="error-character"
        src="/img/catch_${character}.png"
        alt=""
        width="640"
        height="640"
      />
      <p class="error-status">${status}</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(body)}</p>
      <p><a class="error-home" href="/">${escapeHtml(strings.home)}</a></p>
    </main>
  </body>
</html>
`;
}
