import type { Locale } from "../locale.ts";

export default {
  code: "zh-Hant",
  name: "繁體中文",
  device: { aircon: "冷氣", heater: "暖風機" },
  appName: (device) => `線上${device}`,

  nicknameLabel: "暱稱",
  nicknamePlaceholder: "暱稱（選填）",
  start: "開始",

  onlineOn: "線上模式已開啟",
  onlineOff: "線上模式已關閉",
  connecting: "連線中…",

  soundOn: "靜音",
  soundOff: "取消靜音",
  warmer: "調高溫度",
  cooler: "調低溫度",

  adjustedBy: (name) => `調整者：${name}`,
  rateLimited: (seconds) => `請求過於頻繁，請在 ${seconds} 秒後重試`,
  atMax: "已是最高溫度",
  atMin: "已是最低溫度",
  audioFailed: "瀏覽器無法啟動音訊（需要 https 或 localhost）",
  connectionLost: "與伺服器的連線已中斷，正在重新連線…",
  connectionFailed: "無法連線到伺服器",
  serverError: "伺服器發生錯誤",

  stats: "統計",
  about: "關於",
  close: "關閉",
  plusCount: "＋ 按下次數",
  minusCount: "－ 按下次數",

  language: "語言",
  theme: "主題",
  themeSystem: "跟隨系統",
  themeLight: "淺色",
  themeDark: "深色",

  aboutLines: (device) => [
    "用於專注與放鬆的棕色噪音產生器。",
    `開啟線上模式後，所有在線的人共用一台${device}（節省電力）。`,
    "原作：YouTube @codingapple",
  ],
} satisfies Locale;
