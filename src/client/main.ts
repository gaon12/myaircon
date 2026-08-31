import { pickCharacter } from "../shared/characters.ts";
import { stripDisallowed } from "../shared/nickname-charset.ts";
import type {
  BlockedMessage,
  DeviceInfo,
  DeviceKind,
  Direction,
  InitMessage,
  TempChangeMessage,
} from "../shared/protocol.ts";
import type { RankPeriod } from "../shared/stats.ts";
import { BrownNoise, gainForTemperature } from "./audio.ts";
import { runChallenge } from "./challenge.ts";
import { requireElement } from "./dom.ts";
import { type Locale, type LocaleCode, localeOptions, locales, pickLocale } from "./i18n/index.ts";
import type { PlainStringKey } from "./i18n/locale.ts";
import { type ConnectionStatus, createConnection } from "./socket.ts";
import { fetchStats, renderStats, type StatsElements } from "./stats.ts";
import { incrementCount, readCount, readValue, writeValue } from "./storage.ts";
import { createTheme, THEMES, type Theme } from "./theme.ts";

const NOTICE_DURATION_MS = 3000;

const els = {
  temp: requireElement("[data-temp]", HTMLParagraphElement),
  who: requireElement("[data-who]", HTMLParagraphElement),
  notice: requireElement("[data-notice]", HTMLParagraphElement),
  body: requireElement("[data-body]", HTMLImageElement),
  fan: requireElement("[data-fan]", HTMLImageElement),
  air: requireElement("[data-air]", HTMLImageElement),
  plus: requireElement("[data-plus]", HTMLButtonElement),
  minus: requireElement("[data-minus]", HTMLButtonElement),
  sound: requireElement("[data-sound]", HTMLButtonElement),
  online: requireElement("[data-online]", HTMLButtonElement),
  nicknameDialog: requireElement("[data-nickname-dialog]", HTMLDialogElement),
  nicknameForm: requireElement("[data-nickname-form]", HTMLFormElement),
  nicknameInput: requireElement("[data-nickname-input]", HTMLInputElement),
  nicknameError: requireElement("[data-nickname-error]", HTMLParagraphElement),
  nicknameSubmit: requireElement("[data-nickname-submit]", HTMLButtonElement),
  nicknameCancel: requireElement("[data-nickname-cancel]", HTMLButtonElement),
  rename: requireElement("[data-rename]", HTMLButtonElement),
  statsDialog: requireElement("[data-stats-dialog]", HTMLDialogElement),
  plusCount: requireElement("[data-plus-count]", HTMLSpanElement),
  minusCount: requireElement("[data-minus-count]", HTMLSpanElement),
  aboutDialog: requireElement("[data-about-dialog]", HTMLDialogElement),
  aboutLines: requireElement("[data-about-lines]", HTMLDivElement),
  languageSelect: requireElement("[data-language]", HTMLSelectElement),
  themeSelect: requireElement("[data-theme-select]", HTMLSelectElement),
  showStats: requireElement("[data-show-stats]", HTMLButtonElement),
  showAbout: requireElement("[data-show-about]", HTMLButtonElement),
  footerOnline: requireElement("[data-footer-online]", HTMLSpanElement),
  statsOnline: requireElement("[data-online-count]", HTMLParagraphElement),
  rankList: requireElement("[data-rank-list]", HTMLOListElement),
  recentList: requireElement("[data-recent-list]", HTMLOListElement),
  chart: requireElement("[data-hourly-chart]", SVGSVGElement),
  chartCaption: requireElement("[data-hourly-caption]", HTMLParagraphElement),
  verifyDialog: requireElement("[data-verify-dialog]", HTMLDialogElement),
  verifyImage: requireElement("[data-verify-image]", HTMLImageElement),
  verifyTitle: requireElement("[data-verify-title]", HTMLHeadingElement),
  verifyBody: requireElement("[data-verify-body]", HTMLParagraphElement),
  verifyProgress: requireElement("[data-verify-progress]", HTMLParagraphElement),
  verifyRetry: requireElement("[data-verify-retry]", HTMLButtonElement),
};

/**
 * 확인 화면에 나오는 캐릭터. 방문마다 하나를 골라 그 캐릭터로 끝까지 간다.
 * 탐색 중에는 scan, 막혔을 때는 catch 포즈라 같은 캐릭터여야 이야기가 이어진다.
 */
const character = pickCharacter();

/**
 * 확인 다이얼로그를 상태에 맞게 그린다.
 *   scanning - 사람인지 확인하는 중
 *   caught   - 접속이 거부됨
 */
function showVerifyDialog(mode: "scanning" | "caught"): void {
  const scanning = mode === "scanning";
  els.verifyImage.src = `/img/${scanning ? "scan" : "catch"}_${character}.png`;
  els.verifyTitle.textContent = scanning ? strings.verifyTitle : strings.blockedTitle;
  els.verifyBody.textContent = scanning ? strings.verifyBody : strings.connectionBlocked;
  els.verifyProgress.textContent = "";
  els.verifyRetry.hidden = true;
  els.verifyDialog.classList.toggle("is-caught", !scanning);
  if (!els.verifyDialog.open) els.verifyDialog.showModal();
}

const rankTabs = [...document.querySelectorAll<HTMLButtonElement>("[data-rank-period]")];

const statsElements: StatsElements = {
  online: els.statsOnline,
  rankTabs,
  rankList: els.rankList,
  recentList: els.recentList,
  chart: els.chart,
  chartCaption: els.chartCaption,
};

type AppState = {
  locale: LocaleCode;
  /**
   * 기기 종류는 서버가 정한다(계절 자동 또는 설정 고정). 공유 기기이므로
   * 사용자마다 다른 것을 보면 안 된다. 오프라인 모드에서는 아래 기본값을 쓴다.
   */
  deviceKind: DeviceKind;
  username: string;
  started: boolean;
  online: boolean;
  /**
   * 온도 범위는 서버가 init으로 알려준다. 아래 값은 오프라인 모드에서만 쓰는
   * 기본값이다. 기존 코드는 18/30을 서버와 클라이언트에 각각 하드코딩해
   * 한쪽만 바꾸면 조용히 어긋날 수 있었다.
   */
  min: number;
  max: number;
  temp: number;
  rankPeriod: RankPeriod;
  /** 서버가 알려준 접속자 수. 아직 모르면 null. (위 online은 모드 on/off다) */
  onlineCount: number | null;
};

const state: AppState = {
  locale: pickLocale(readValue("locale"), navigator.languages ?? [navigator.language]),
  deviceKind: "aircon",
  username: "",
  started: false,
  online: false,
  min: 18,
  max: 30,
  temp: 18,
  rankPeriod: "today",
  onlineCount: null,
};

const audio = new BrownNoise();
const theme = createTheme();

/** 현재 로케일의 문자열 테이블. 언어를 바꾸면 이 참조가 갈아끼워진다. */
let strings: Locale = locales[state.locale];

/** 현재 기기 종류의 이름 (에어컨 / 온풍기). */
const deviceName = (): string => strings.device[state.deviceKind];

const currentGain = (temp: number): number =>
  gainForTemperature(temp, state.min, state.max, state.deviceKind);

// ---------------------------------------------------------------- 렌더링

/** 화면에 떠 있어야 하는 온도 문자열. 표시와 복원이 같은 정의를 쓴다. */
function temperatureText(): string {
  return `${state.temp}℃`;
}

function renderTemperature(): void {
  const text = temperatureText();
  // 아래 감시자가 우리 쓰기에도 반응하므로, 이미 맞는 값이면 건드리지 않는다.
  if (els.temp.textContent !== text) els.temp.textContent = text;
}

/**
 * 개발자도구 Elements에서 온도 텍스트를 직접 고쳐도 즉시 되돌린다.
 *
 * MutationObserver가 텍스트 변경을 감지하고, 현재 상태와 다르면 다시 그린다.
 * 우리가 쓴 값은 이미 상태와 같으므로 다시 쓰지 않고, 따라서 무한 루프가 되지
 * 않는다.
 *
 * 이건 표시의 정합성을 지키는 장치이지 보안 장치가 아니다. 콘솔에서 스크립트
 * 상태를 직접 건드리는 것까지 막지는 못한다. 애초에 온도의 진실은 서버에
 * 있고, 온라인 모드에서는 클라이언트가 무엇을 표시하든 서버 값이 다음
 * tempChange에 그대로 실려 온다.
 */
function guardTemperatureDisplay(): void {
  const observer = new MutationObserver(() => {
    if (els.temp.textContent !== temperatureText()) renderTemperature();
  });
  observer.observe(els.temp, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

/**
 * 서버가 알려준 기기(에어컨/온풍기)를 화면에 반영한다.
 *
 * 이미지 경로도 서버가 준다. 온풍기 전용 에셋이 아직 없어서 지금은 에어컨
 * 이미지로 폴백되지만, public/에 파일을 떨어뜨리면 서버가 알아서 그 경로를
 * 내려보내고 클라이언트는 바꿀 것이 없다.
 */
function applyDevice(device: DeviceInfo): void {
  state.deviceKind = device.kind;
  document.documentElement.dataset.device = device.kind;

  els.body.src = device.assets.body;
  els.fan.src = device.assets.fan;
  els.air.src = device.assets.air;

  // 기기 이름이 제목과 안내 문구에 들어가므로 문자열을 다시 그린다.
  renderStrings();
}

const fadeTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

/**
 * 잠깐 보였다 사라지는 안내 문구.
 *
 * 기존에는 1초마다 도는 setInterval이 이미 붙어 있는 클래스를 영원히 다시
 * 붙였다. 탭이 살아 있는 한 계속 도는 무의미한 DOM 쓰기였고, 게다가 표시
 * 시간이 인터벌 위상에 따라 0~1000ms 사이에서 들쭉날쭉했다. 이벤트가 틱
 * 직전에 오면 문구가 깜빡하고 사라졌다.
 * 이제는 이벤트마다 타이머를 새로 잡아 표시 시간이 항상 일정하다.
 */
function transientText(element: HTMLElement, text: string): void {
  element.textContent = text;
  element.classList.remove("is-faded");
  clearTimeout(fadeTimers.get(element));
  fadeTimers.set(
    element,
    setTimeout(() => element.classList.add("is-faded"), NOTICE_DURATION_MS),
  );
}

/** 푸터의 접속자 수. 온라인일 때만 보여준다. */
function renderOnline(): void {
  const count = state.onlineCount;
  els.footerOnline.hidden = count === null || count <= 0;
  if (count !== null && count > 0) {
    els.footerOnline.textContent = strings.onlineCount(count);
  }
}

function setOnlineLabel(text: string, pressed: boolean): void {
  els.online.textContent = text;
  els.online.setAttribute("aria-pressed", String(pressed));
  els.online.classList.toggle("is-active", pressed);
}

function setSoundLabel(): void {
  const on = audio.playing;
  els.sound.setAttribute("aria-label", on ? strings.soundOn : strings.soundOff);
  els.sound.setAttribute("aria-pressed", String(on));
  els.sound.classList.toggle("is-muted", !on);
}

// ---------------------------------------------------------------- 연결

const connection = createConnection({
  onInit({ temp, min, max, device }: InitMessage) {
    state.min = min;
    state.max = max;
    state.temp = temp;
    applyDevice(device);
    renderTemperature();
    audio.setGain(currentGain(temp));
  },

  // 서버가 계절이 바뀐 것을 감지하면 접속 중에도 기기가 교체된다.
  onDeviceChange(device: DeviceInfo) {
    applyDevice(device);
    audio.setGain(currentGain(state.temp));
  },

  onTempChange({ temp, changed, username }: TempChangeMessage) {
    state.temp = temp;
    renderTemperature();
    transientText(els.who, strings.adjustedBy(username));
    if (!changed) {
      transientText(els.notice, temp >= state.max ? strings.atMax : strings.atMin);
    }
    audio.setGain(currentGain(temp));
  },

  onBlocked({ retryAfterMs }: BlockedMessage) {
    transientText(els.notice, strings.rateLimited(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  },

  onOnlineCount({ online }) {
    state.onlineCount = online;
    renderOnline();
  },

  onStatus(status: ConnectionStatus) {
    if (!state.online) return;
    if (status === "connected") {
      els.verifyDialog.close();
      setOnlineLabel(strings.onlineOn, true);
    } else if (status === "challenge-required") {
      // 점수가 애매해서 서버가 확인을 요구했다. 평소에는 오지 않는 경로다.
      void verifyThenReconnect();
    } else if (status === "blocked") {
      setOnlineLabel(strings.onlineOff, false);
      state.online = false;
      showVerifyDialog("caught");
    } else if (status === "disconnected") {
      transientText(els.notice, strings.connectionLost);
    } else if (status === "error") {
      transientText(els.notice, strings.connectionFailed);
    } else {
      transientText(els.notice, strings.serverError);
    }
  },

  onProtocolError(event, error) {
    // 서버가 형태에 맞지 않는 메시지를 보냈다. 화면을 깨뜨리는 대신 무시하고
    // 콘솔에만 남긴다(배포 중 버전이 잠깐 어긋나는 경우 등).
    console.warn(`서버 메시지 형식이 올바르지 않습니다 (${event}): ${error}`);
  },
});

// ---------------------------------------------------------------- 조작

function adjust(direction: Direction): void {
  incrementCount(direction === "up" ? "plus" : "minus");

  if (state.online) {
    // 온라인에서는 서버가 진실이다. 낙관적 갱신을 하지 않고 tempChange를 기다린다.
    connection.step(direction, state.username);
    return;
  }

  const next = direction === "up" ? state.temp + 1 : state.temp - 1;
  if (next < state.min || next > state.max) {
    transientText(els.notice, direction === "up" ? strings.atMax : strings.atMin);
    return;
  }
  state.temp = next;
  renderTemperature();
  audio.setGain(currentGain(next));
}

async function toggleSound(): Promise<void> {
  if (audio.playing) {
    audio.stop();
  } else {
    await audio.start(currentGain(state.temp));
  }
  setSoundLabel();
}

/**
 * 확인 화면을 띄우고 작업증명을 푼 뒤 다시 접속한다.
 *
 * 이 경로는 점수가 애매할 때만 탄다. 대부분의 사용자는 평생 보지 않는다.
 */
let verifying = false;

async function verifyThenReconnect(): Promise<void> {
  if (verifying) return;
  verifying = true;
  showVerifyDialog("scanning");

  try {
    const token = await runChallenge((attempts) => {
      els.verifyProgress.textContent = strings.verifyProgress(attempts);
    });
    if (token === null) {
      els.verifyProgress.textContent = strings.verifyFailed;
      els.verifyRetry.hidden = false;
      return;
    }
    connection.setChallengeToken(token);
    connection.connect();
  } finally {
    verifying = false;
  }
}

function toggleOnline(): void {
  state.online = !state.online;
  if (state.online) {
    setOnlineLabel(strings.connecting, true);
    connection.connect();
  } else {
    // 기존에는 라벨만 바꾸고 소켓은 계속 열어 뒀다. 실제로 끊는다.
    connection.disconnect();
    setOnlineLabel(strings.onlineOff, false);
  }
}

/**
 * 닉네임을 받은 뒤 컨트롤을 활성화하고 기기를 켠다.
 *
 * @param withSound 소리를 바로 켤지. 폼을 제출해서 들어왔을 때만 true다.
 *   저장된 이름으로 자동 시작할 때는 사용자 제스처가 없어서, 켜려고 하면
 *   자동재생 정책에 막히고 "소리를 켤 수 없습니다" 안내만 뜬다. 애초에
 *   페이지를 열자마자 소음이 나오는 것도 반갑지 않다.
 */
async function start(username: string, { withSound }: { withSound: boolean }): Promise<void> {
  if (state.started) return;
  state.started = true;
  setUsername(username);

  for (const button of [els.plus, els.minus, els.sound, els.online]) {
    button.disabled = false;
  }
  els.rename.hidden = false;

  els.fan.classList.add("is-spinning");
  els.air.classList.add("is-blowing");
  renderTemperature();

  // 사용자 제스처(폼 제출) 안에서 호출해야 자동재생 정책에 걸리지 않는다.
  if (withSound) await toggleSound();
}

// ------------------------------------------------------------------ 닉네임

/**
 * 이름을 정하고 저장한다.
 *
 * 저장해 두는 이유는 단순하다. 새로고침할 때마다 다시 치게 만들 이유가 없다.
 * localStorage라 이 브라우저 안에만 남고 서버로 가지 않는다 -- 서버는
 * 온도를 바꿀 때 이름을 함께 받을 뿐 누구인지 기억하지 않는다.
 */
function setUsername(username: string): void {
  state.username = username;
  writeValue("nickname", username);
}

/**
 * 저장된 이름을 읽는다.
 *
 * localStorage는 사용자가 직접 고칠 수 있으므로 읽어 온 값도 입력창에서 온
 * 것과 똑같이 검사한다. 규칙을 나중에 조이면 예전에 저장된 이름이 규칙에
 * 안 맞을 수도 있는데, 그때도 여기서 걸러진다.
 */
function savedNickname(): string | null {
  const raw = readValue("nickname");
  if (raw === null) return null;
  const cleaned = cleanNickname(raw);
  return cleaned === "" ? null : cleaned;
}

/**
 * 입력을 쓸 수 있는 이름으로 다듬는다. 서버의 normalizeNickname과 같은
 * 문자 규칙을 쓰지만(둘 다 shared/nickname-charset.ts), 길이 자르기는
 * 하지 않는다 -- 그건 input의 maxlength와 서버가 맡는다.
 */
function cleanNickname(raw: string): string {
  return stripDisallowed(raw.normalize("NFC")).replace(/\s+/g, " ").trim();
}

/**
 * 닉네임 모달을 연다.
 *
 * @param mode 처음 들어올 때(start)인지, 이름만 바꾸러 온 것(rename)인지.
 *   처음이면 취소할 수단이 없어야 한다 -- 취소하면 아무것도 못 하는 화면에
 *   갇히기 때문이다. 바꾸러 온 것이면 얼마든지 물러날 수 있어야 한다.
 */
function openNicknameDialog(mode: "start" | "rename"): void {
  nicknameMode = mode;
  els.nicknameInput.value = mode === "rename" ? state.username : (savedNickname() ?? "");
  els.nicknameSubmit.textContent = mode === "rename" ? strings.save : strings.start;
  els.nicknameCancel.hidden = mode !== "rename";
  hideNicknameError();
  if (!els.nicknameDialog.open) els.nicknameDialog.showModal();
  els.nicknameInput.focus();
  els.nicknameInput.select();
}

function hideNicknameError(): void {
  els.nicknameError.hidden = true;
  els.nicknameError.textContent = "";
}

// ---------------------------------------------------------------- 언어 / 테마

const THEME_LABEL_KEY: Record<Theme, PlainStringKey> = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
};

/** 마크업의 data-i18n 자리에 현재 로케일 문자열을 채운다. 몇 번 불러도 안전하다. */
function renderStrings(): void {
  document.documentElement.lang = state.locale;
  document.title = strings.appName(deviceName());

  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key !== undefined && key in strings) {
      element.textContent = strings[key as PlainStringKey];
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n-label]")) {
    const key = element.dataset.i18nLabel;
    if (key !== undefined && key in strings) {
      element.setAttribute("aria-label", strings[key as PlainStringKey]);
    }
  }

  els.nicknameInput.placeholder = strings.nicknamePlaceholder;
  // 위의 data-i18n 순회가 시작 버튼을 무조건 "시작"으로 돌려놓는다. 이름을
  // 바꾸는 중이라면 "저장"이어야 하므로 여기서 다시 맞춘다.
  if (nicknameMode === "rename") els.nicknameSubmit.textContent = strings.save;
  els.aboutLines.replaceChildren(
    ...strings.aboutLines(deviceName()).map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      return paragraph;
    }),
  );

  // 상태에 따라 달라지는 라벨은 data-i18n으로 처리할 수 없다.
  setOnlineLabel(
    state.online
      ? connection.connected
        ? strings.onlineOn
        : strings.connecting
      : strings.onlineOff,
    state.online,
  );
  setSoundLabel();
  renderTemperature();
  renderOnline();
  buildThemeOptions();
  // 열려 있는 다이얼로그도 새 언어로 다시 그린다.
  if (els.statsDialog.open) void loadStats();
  if (els.verifyDialog.open) {
    showVerifyDialog(els.verifyDialog.classList.contains("is-caught") ? "caught" : "scanning");
  }
}

function setLocale(code: string): void {
  if (!Object.hasOwn(locales, code) || code === state.locale) return;
  state.locale = code as LocaleCode;
  strings = locales[state.locale];
  writeValue("locale", code);
  renderStrings();
}

function buildLanguageOptions(): void {
  els.languageSelect.replaceChildren(
    ...localeOptions.map(([code, name]) => {
      const option = document.createElement("option");
      option.value = code;
      // 각 언어의 이름은 그 언어 자신의 표기로 둔다(현재 UI 언어와 무관하게 읽힌다).
      option.textContent = name;
      option.selected = code === state.locale;
      return option;
    }),
  );
}

/** 테마 이름은 UI 언어를 따라야 하므로 언어가 바뀔 때마다 다시 그린다. */
function buildThemeOptions(): void {
  els.themeSelect.replaceChildren(
    ...THEMES.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = strings[THEME_LABEL_KEY[value]];
      option.selected = value === theme.value;
      return option;
    }),
  );
}

// ---------------------------------------------------------------- 초기화

audio.addEventListener("failed", () => {
  transientText(els.notice, strings.audioFailed);
  setSoundLabel();
});

/** 지금 모달이 처음 들어온 것인지 이름만 바꾸는 것인지. */
let nicknameMode: "start" | "rename" = "start";

// 입력하는 동안 쓸 수 없는 문자를 조용히 지운다. "이 글자는 안 됩니다"를
// 띄우는 것보다 손이 덜 간다. 커서 위치는 지워진 글자 수만큼 당겨 준다 --
// 그러지 않으면 이모지를 하나 지울 때마다 커서가 맨 뒤로 튄다.
els.nicknameInput.addEventListener("input", () => {
  const before = els.nicknameInput.value;
  const after = stripDisallowed(before);
  if (after === before) return;
  const caret = els.nicknameInput.selectionStart ?? after.length;
  const removedBeforeCaret =
    before.slice(0, caret).length - stripDisallowed(before.slice(0, caret)).length;
  els.nicknameInput.value = after;
  const next = Math.max(0, caret - removedBeforeCaret);
  els.nicknameInput.setSelectionRange(next, next);
  hideNicknameError();
});

els.nicknameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = cleanNickname(els.nicknameInput.value);
  if (name === "") {
    // 전부 지워졌다는 것은 쓸 수 없는 문자만 넣었다는 뜻이다. 이때만 말한다.
    els.nicknameError.textContent = strings.nicknameInvalid;
    els.nicknameError.hidden = false;
    return;
  }
  els.nicknameDialog.close();
  if (nicknameMode === "rename") {
    setUsername(name);
    return;
  }
  void start(name, { withSound: true });
});

els.nicknameCancel.addEventListener("click", () => els.nicknameDialog.close());
els.rename.addEventListener("click", () => openNicknameDialog("rename"));

/*
 * 관문 두 개(최초 닉네임 입력, 확인 화면)는 Esc로 치울 수 없어야 한다.
 * 닉네임 모달을 닫아 봐야 아무 버튼도 누를 수 없는 화면에 갇힐 뿐이고,
 * 다시 여는 방법도 없다. 실제로 그랬다 -- Esc 한 번이면 앱이 죽었다.
 *
 * cancel에서 preventDefault 하는 것만으로는 부족하다. 크로미움은 dialog를
 * CloseWatcher로 처리하는데, **사용자 활성화가 아직 없으면 취소를 무시하고
 * 그냥 닫는다.** 페이지를 열자마자 Esc를 누르는 경우가 정확히 그 상황이다.
 * 그래서 닫힌 뒤에 다시 여는 것으로 한 겹 더 받친다. 브라우저가 어떻게
 * 처리하든 갇히지 않는다.
 */
els.nicknameDialog.addEventListener("cancel", (event) => {
  if (nicknameMode === "start") event.preventDefault();
});
els.nicknameDialog.addEventListener("close", () => {
  if (nicknameMode === "start" && !state.started) openNicknameDialog("start");
});

els.verifyDialog.addEventListener("cancel", (event) => event.preventDefault());
els.verifyDialog.addEventListener("close", () => {
  // 접속이 끝나면 onStatus가 정상적으로 닫는다. 그 전에 닫혔다면 사용자가
  // Esc를 누른 것이므로 되돌린다.
  if (state.online && !connection.connected) {
    showVerifyDialog(els.verifyDialog.classList.contains("is-caught") ? "caught" : "scanning");
  }
});

/**
 * 바깥을 누르면 닫힌다.
 *
 * <dialog>의 클릭 이벤트는 backdrop을 눌러도 dialog 자신을 target으로 준다.
 * 그런데 dialog에는 padding이 있어서 target만 보면 테두리 안쪽 여백을 눌러도
 * 닫혀 버린다. 그래서 좌표가 실제로 상자 밖인지 본다.
 *
 * 관문 두 개(닉네임 최초 입력, 확인 화면)는 제외한다. cancel을 막아 둔 것과
 * 같은 이유다.
 */
for (const dialog of [els.statsDialog, els.aboutDialog]) {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    if (outside) dialog.close();
  });
}

els.plus.addEventListener("click", () => adjust("up"));
els.minus.addEventListener("click", () => adjust("down"));
els.sound.addEventListener("click", () => void toggleSound());
els.online.addEventListener("click", toggleOnline);
els.verifyRetry.addEventListener("click", () => void verifyThenReconnect());
els.languageSelect.addEventListener("change", () => setLocale(els.languageSelect.value));
els.themeSelect.addEventListener("change", () => {
  const next = els.themeSelect.value;
  if ((THEMES as readonly string[]).includes(next)) theme.set(next as Theme);
});

/**
 * 통계는 서버가 밀어주지 않고 열 때 가져온다. 버튼을 누를 때마다 접속자
 * 전원에게 보내면 사람 수에 비례해 비용이 늘지만, 이렇게 하면 다이얼로그를
 * 여는 순간에만 요청 하나가 나간다.
 */
let statsRequest: AbortController | null = null;

async function loadStats(): Promise<void> {
  statsRequest?.abort();
  const controller = new AbortController();
  statsRequest = controller;
  try {
    const snapshot = await fetchStats(controller.signal);
    if (controller.signal.aborted) return;
    if (snapshot === null) {
      els.statsOnline.textContent = strings.statsError;
      return;
    }
    state.onlineCount = snapshot.online;
    renderOnline();
    renderStats(statsElements, snapshot, state.rankPeriod, strings);
  } catch (error) {
    if (!controller.signal.aborted) {
      console.warn("통계를 가져오지 못했습니다", error);
      els.statsOnline.textContent = strings.statsError;
    }
  }
}

for (const tab of rankTabs) {
  tab.addEventListener("click", () => {
    const period = tab.dataset.rankPeriod;
    if (period !== "today" && period !== "allTime") return;
    if (period === state.rankPeriod) return;
    state.rankPeriod = period;
    void loadStats();
  });
}

els.showStats.addEventListener("click", () => {
  els.plusCount.textContent = String(readCount("plus"));
  els.minusCount.textContent = String(readCount("minus"));
  els.statsDialog.showModal();
  void loadStats();
});
els.showAbout.addEventListener("click", () => els.aboutDialog.showModal());
for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", (event) => {
    (event.target as Element).closest("dialog")?.close();
  });
}

buildLanguageOptions();
renderStrings();
guardTemperatureDisplay();

// 지난번에 쓰던 이름이 있으면 묻지 않고 바로 시작한다. 새로고침할 때마다
// 같은 이름을 다시 치게 만들 이유가 없다. 소리는 켜지 않는다 -- 사용자
// 제스처가 없어서 자동재생 정책에 막히고, 페이지를 열자마자 소음이 나오는
// 것도 반갑지 않다.
const remembered = savedNickname();
if (remembered === null) {
  openNicknameDialog("start");
} else {
  void start(remembered, { withSound: false });
}
