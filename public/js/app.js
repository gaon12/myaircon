import { BrownNoise, gainForTemperature } from "./audio.js";
import { localeOptions, locales, pickLocale } from "./i18n/index.js";
import { createConnection } from "./socket.js";
import { incrementCount, readCount, readValue, writeValue } from "./storage.js";
import { createTheme, THEMES } from "./theme.js";

const NOTICE_DURATION_MS = 3000;

const els = {
  temp: document.querySelector("[data-temp]"),
  who: document.querySelector("[data-who]"),
  notice: document.querySelector("[data-notice]"),
  body: document.querySelector("[data-body]"),
  fan: document.querySelector("[data-fan]"),
  air: document.querySelector("[data-air]"),
  plus: document.querySelector("[data-plus]"),
  minus: document.querySelector("[data-minus]"),
  sound: document.querySelector("[data-sound]"),
  online: document.querySelector("[data-online]"),
  nicknameDialog: document.querySelector("[data-nickname-dialog]"),
  nicknameForm: document.querySelector("[data-nickname-form]"),
  nicknameInput: document.querySelector("[data-nickname-input]"),
  statsDialog: document.querySelector("[data-stats-dialog]"),
  plusCount: document.querySelector("[data-plus-count]"),
  minusCount: document.querySelector("[data-minus-count]"),
  aboutDialog: document.querySelector("[data-about-dialog]"),
  aboutLines: document.querySelector("[data-about-lines]"),
  languageSelect: document.querySelector("[data-language]"),
  themeSelect: document.querySelector("[data-theme-select]"),
};

const state = {
  locale: pickLocale(readValue("locale"), navigator.languages ?? [navigator.language]),
  // 기기 종류는 서버가 정한다(계절 자동 또는 설정 고정). 공유 기기이므로
  // 사용자마다 다른 것을 보면 안 된다. 오프라인 모드에서는 아래 기본값을 쓴다.
  deviceKind: "aircon",
  username: "",
  started: false,
  online: false,
  // 온도 범위는 서버가 init으로 알려준다. 아래 값은 오프라인 모드에서만 쓰는
  // 기본값이고, 온라인이 되면 서버 값으로 덮어쓴다. 기존 코드는 18/30을
  // 서버와 클라이언트에 각각 하드코딩해 두 곳이 조용히 어긋날 수 있었다.
  min: 18,
  max: 30,
  temp: 18,
};

const audio = new BrownNoise();
const theme = createTheme();

/** 현재 로케일의 문자열 테이블. 언어를 바꾸면 이 참조가 갈아끼워진다. */
let strings = locales[state.locale];

/** 현재 기기 종류의 이름 (에어컨 / 온풍기). */
const deviceName = () => strings.device[state.deviceKind];

// ---------------------------------------------------------------- 렌더링

function renderTemperature() {
  els.temp.textContent = `${state.temp}℃`;
}

/**
 * 잠깐 보였다 사라지는 안내 문구.
 *
 * 기존에는 1초마다 도는 setInterval이 이미 붙어 있는 클래스를 영원히 다시
 * 붙였다. 탭이 살아 있는 한 계속 도는 무의미한 DOM 쓰기였고, 게다가 표시
 * 시간이 인터벌 위상에 따라 0~1000ms 사이에서 들쭉날쭉했다. 이벤트가 틱
 * 직전에 오면 문구가 깜빡하고 사라졌다.
 * 이제는 이벤트마다 타이머를 새로 잡아 표시 시간이 항상 일정하다.
 */
const fadeTimers = new WeakMap();

function transientText(element, text) {
  element.textContent = text;
  element.classList.remove("is-faded");
  clearTimeout(fadeTimers.get(element));
  fadeTimers.set(
    element,
    setTimeout(() => element.classList.add("is-faded"), NOTICE_DURATION_MS),
  );
}

/**
 * 서버가 알려준 기기(에어컨/온풍기)를 화면에 반영한다.
 *
 * 이미지 경로도 서버가 준다. 온풍기 전용 에셋이 아직 없어서 지금은 에어컨
 * 이미지로 폴백되지만, public/에 파일을 떨어뜨리면 서버가 알아서 그 경로를
 * 내려보내고 클라이언트는 바꿀 것이 없다.
 */
function applyDevice(device) {
  if (!device) return;
  state.deviceKind = device.kind;
  document.documentElement.dataset.device = device.kind;

  els.body.src = device.assets.body;
  els.fan.src = device.assets.fan;
  els.air.src = device.assets.air;

  // 기기 이름이 제목과 안내 문구에 들어가므로 문자열을 다시 그린다.
  renderStrings();
}

function setOnlineLabel(text, pressed) {
  els.online.textContent = text;
  els.online.setAttribute("aria-pressed", String(pressed));
  els.online.classList.toggle("is-active", pressed);
}

function setSoundLabel() {
  const on = audio.playing;
  els.sound.setAttribute("aria-label", on ? strings.soundOn : strings.soundOff);
  els.sound.setAttribute("aria-pressed", String(on));
  els.sound.classList.toggle("is-muted", !on);
}

// ---------------------------------------------------------------- 연결

const connection = createConnection({
  onInit({ temp, min, max, device }) {
    state.min = min;
    state.max = max;
    state.temp = temp;
    applyDevice(device);
    renderTemperature();
    audio.setGain(gainForTemperature(temp, state.min, state.max, state.deviceKind));
  },

  // 서버가 계절이 바뀐 것을 감지하면 접속 중에도 기기가 교체된다.
  onDeviceChange(device) {
    applyDevice(device);
    audio.setGain(gainForTemperature(state.temp, state.min, state.max, state.deviceKind));
  },

  onTempChange({ temp, changed, username }) {
    state.temp = temp;
    renderTemperature();
    transientText(els.who, strings.adjustedBy(username));
    if (!changed) {
      transientText(els.notice, temp >= state.max ? strings.atMax : strings.atMin);
    }
    audio.setGain(gainForTemperature(temp, state.min, state.max, state.deviceKind));
  },

  onBlocked({ retryAfterMs }) {
    const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 0) / 1000));
    transientText(els.notice, strings.rateLimited(seconds));
  },

  onStatus(status) {
    if (!state.online) return;
    if (status === "connected") setOnlineLabel(strings.onlineOn, true);
    else if (status === "disconnected") transientText(els.notice, strings.connectionLost);
    else if (status === "error") transientText(els.notice, strings.connectionFailed);
    else if (status === "server-error") transientText(els.notice, strings.serverError);
  },
});

// ---------------------------------------------------------------- 조작

function adjust(direction) {
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
  audio.setGain(gainForTemperature(next, state.min, state.max, state.deviceKind));
}

async function toggleSound() {
  if (audio.playing) {
    audio.stop();
  } else {
    await audio.start(gainForTemperature(state.temp, state.min, state.max, state.deviceKind));
  }
  setSoundLabel();
}

function toggleOnline() {
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

/** 닉네임을 받은 뒤 컨트롤을 활성화하고 에어컨을 켠다. */
async function start(username) {
  if (state.started) return;
  state.started = true;
  state.username = username;

  for (const button of [els.plus, els.minus, els.sound, els.online]) {
    button.disabled = false;
  }

  els.fan.classList.add("is-spinning");
  els.air.classList.add("is-blowing");
  renderTemperature();

  // 사용자 제스처(폼 제출) 안에서 호출해야 자동재생 정책에 걸리지 않는다.
  await toggleSound();
}

document.querySelector("[data-show-stats]").addEventListener("click", () => {
  els.plusCount.textContent = String(readCount("plus"));
  els.minusCount.textContent = String(readCount("minus"));
  els.statsDialog.showModal();
});
document.querySelector("[data-show-about]").addEventListener("click", () => {
  els.aboutDialog.showModal();
});
for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", (event) => event.target.closest("dialog").close());
}

// ---------------------------------------------------------------- 언어

/** 마크업의 data-i18n 자리에 현재 로케일 문자열을 채운다. 몇 번 불러도 안전하다. */
function renderStrings() {
  document.documentElement.lang = state.locale;
  document.title = strings.appName(deviceName());

  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = strings[element.dataset.i18n];
  }
  for (const element of document.querySelectorAll("[data-i18n-label]")) {
    element.setAttribute("aria-label", strings[element.dataset.i18nLabel]);
  }

  els.nicknameInput.placeholder = strings.nicknamePlaceholder;
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
  buildThemeOptions();
}

function setLocale(code) {
  if (!Object.hasOwn(locales, code) || code === state.locale) return;
  state.locale = code;
  strings = locales[code];
  writeValue("locale", code);
  renderStrings();
}

function buildLanguageOptions() {
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

// ---------------------------------------------------------------- 테마

const THEME_LABEL_KEY = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
};

/** 테마 이름은 UI 언어를 따라야 하므로 언어가 바뀔 때마다 다시 그린다. */
function buildThemeOptions() {
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

els.nicknameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  els.nicknameDialog.close();
  void start(els.nicknameInput.value);
});

els.plus.addEventListener("click", () => adjust("up"));
els.minus.addEventListener("click", () => adjust("down"));
els.sound.addEventListener("click", () => void toggleSound());
els.online.addEventListener("click", toggleOnline);
els.languageSelect.addEventListener("change", (event) => setLocale(event.target.value));
els.themeSelect.addEventListener("change", (event) => theme.set(event.target.value));

document.querySelector("[data-show-stats]").addEventListener("click", () => {
  els.plusCount.textContent = String(readCount("plus"));
  els.minusCount.textContent = String(readCount("minus"));
  els.statsDialog.showModal();
});
document.querySelector("[data-show-about]").addEventListener("click", () => {
  els.aboutDialog.showModal();
});
for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", (event) => event.target.closest("dialog").close());
}

buildLanguageOptions();
renderStrings();
els.nicknameDialog.showModal();
