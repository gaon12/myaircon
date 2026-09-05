import type {
  BlockedMessage,
  DeviceInfo,
  DeviceKind,
  Direction,
  InitMessage,
  TempChangeMessage,
} from "../shared/protocol.ts";
import { BrownNoise, gainForTemperature } from "./audio.ts";
import { requireElement } from "./dom.ts";
import { type Locale, type LocaleCode, localeOptions, locales, pickLocale } from "./i18n/index.ts";
import type { PlainStringKey } from "./i18n/locale.ts";
import { createNicknameDialog } from "./nickname-dialog.ts";
import { type ConnectionStatus, createConnection } from "./socket.ts";
import { createStatsDialog } from "./stats-dialog.ts";
import { incrementCount, readValue, writeValue } from "./storage.ts";
import { createTheme, THEMES, type Theme } from "./theme.ts";
import { createVerifyDialog } from "./verify-dialog.ts";

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
  aboutDialog: requireElement("[data-about-dialog]", HTMLDialogElement),
  aboutLines: requireElement("[data-about-lines]", HTMLDivElement),
  languageSelect: requireElement("[data-language]", HTMLSelectElement),
  themeSelect: requireElement("[data-theme-select]", HTMLSelectElement),
  showAbout: requireElement("[data-show-about]", HTMLButtonElement),
  footerOnline: requireElement("[data-footer-online]", HTMLSpanElement),
};

type AppState = {
  locale: LocaleCode;
  /** 온라인 기기 종류는 서버가 정한다. 초기값은 오프라인 전용이다. */
  deviceKind: DeviceKind;
  username: string;
  started: boolean;
  online: boolean;
  /** 온라인 범위와 온도는 init으로 받은 서버 값을 사용한다. */
  min: number;
  max: number;
  temp: number;
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

/** 표시만 복원한다. 보안 경계와 실제 온도 변경 권한은 서버에 있다. */
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

/** 검증된 서버 메시지의 기기와 에셋 경로를 화면에 반영한다. */
function applyDevice(device: DeviceInfo): void {
  state.deviceKind = device.kind;
  document.documentElement.dataset.device = device.kind;

  els.body.src = device.assets.body;
  els.fan.src = device.assets.fan;
  els.air.src = device.assets.air;

  // 온풍기 본체에는 고정 루버가 그려져 있다. 에어컨용 보조 팬으로 덮지 않는다.
  const heaterBody = device.kind === "heater" && device.assets.body === "/heater0.png";
  document.documentElement.classList.toggle("has-heater-body", heaterBody);
  els.fan.hidden = heaterBody && device.assets.fan === "/aircon-fan2.png";

  // 기기 이름이 제목과 안내 문구에 들어가므로 문자열을 다시 그린다.
  renderStrings();
}

const fadeTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

/** 새 안내가 오면 이전 타이머를 취소해 표시 시간을 보장한다. */
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

const nickname = createNicknameDialog({
  getStrings: () => strings,
  getUsername: () => state.username,
  hasStarted: () => state.started,
  onRename: setUsername,
  onStart: (name) => {
    void start(name, { withSound: true });
  },
});
const statsDialog = createStatsDialog(
  () => strings,
  (online) => {
    state.onlineCount = online;
    renderOnline();
  },
);
const verification = createVerifyDialog({
  getStrings: () => strings,
  isOnline: () => state.online,
  isConnected: () => connection.connected,
  onVerified: (token) => {
    connection.setChallengeToken(token);
    connection.connect();
  },
});

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
      verification.close();
      setOnlineLabel(strings.onlineOn, true);
    } else if (status === "challenge-required") {
      // 점수가 애매해서 서버가 확인을 요구했다. 평소에는 오지 않는 경로다.
      void verification.verify();
    } else if (status === "blocked") {
      setOnlineLabel(strings.onlineOff, false);
      state.online = false;
      verification.showBlocked();
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

  const next = direction === "up" ? state.temp + 1 : state.temp - 1;

  // 경계에서 불필요한 요청을 줄인다. 서버의 범위 검증과 속도 제한은 별도로 유지한다.
  if (next < state.min || next > state.max) {
    transientText(els.notice, direction === "up" ? strings.atMax : strings.atMin);
    return;
  }

  if (state.online) {
    // 온라인에서는 서버가 진실이다. 낙관적 갱신을 하지 않고 tempChange를 기다린다.
    connection.step(direction, state.username);
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

function toggleOnline(): void {
  state.online = !state.online;
  if (state.online) {
    setOnlineLabel(strings.connecting, true);
    connection.connect();
  } else {
    connection.disconnect();
    setOnlineLabel(strings.onlineOff, false);
  }
}

/** 저장된 이름으로 자동 시작할 때는 사용자 제스처가 없으므로 소리를 켜지 않는다. */
async function start(username: string, { withSound }: { withSound: boolean }): Promise<void> {
  if (state.started) return;
  state.started = true;
  setUsername(username);

  for (const button of [els.plus, els.minus, els.sound, els.online]) {
    button.disabled = false;
  }
  nickname.activate();

  els.fan.classList.add("is-spinning");
  els.air.classList.add("is-blowing");
  renderTemperature();

  // 사용자 제스처(폼 제출) 안에서 호출해야 자동재생 정책에 걸리지 않는다.
  if (withSound) await toggleSound();
}

// ------------------------------------------------------------------ 닉네임

/** 다음 방문에 사용할 이름을 브라우저 저장소에 보관한다. */
function setUsername(username: string): void {
  state.username = username;
  writeValue("nickname", username);
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

  nickname.renderStrings();
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
  statsDialog.renderStrings();
  verification.renderStrings();
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

/** 안내·통계만 배경 클릭으로 닫는다. dialog 내부 여백은 좌표로 구별한다. */
for (const dialog of document.querySelectorAll<HTMLDialogElement>(
  "[data-stats-dialog], [data-about-dialog]",
)) {
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
els.languageSelect.addEventListener("change", () => setLocale(els.languageSelect.value));
els.themeSelect.addEventListener("change", () => {
  const next = els.themeSelect.value;
  if ((THEMES as readonly string[]).includes(next)) theme.set(next as Theme);
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

// 저장된 이름도 입력과 같은 문자 규칙으로 검증한 뒤 사용한다.
const remembered = nickname.remembered();
if (remembered === null) {
  nickname.open("start");
} else {
  void start(remembered, { withSound: false });
}
