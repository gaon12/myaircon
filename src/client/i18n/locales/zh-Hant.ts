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

  online: "線上人數",
  onlineCount: (count: number) => `${count} 人在線`,
  myStats: "我的紀錄",
  rankTitle: "調整最多的人",
  rankToday: "今天",
  rankAllTime: "總榜",
  rankNote: "以暱稱統計",
  rankEmpty: "還沒有調整紀錄",
  changesUnit: (count: number) => `${count} 次`,
  hourlyTitle: "最近 24 小時活動",
  hourlySummary: (total: number) => `24 小時內共調整 ${total} 次`,
  hourlyDetail: (hour: number, changes: number, average: number) =>
    `${hour} 時 · ${changes} 次 · 平均 ${average}℃`,
  recentTitle: "最近紀錄",
  recentEmpty: "尚無紀錄",
  timeJustNow: "剛剛",
  timeMinutes: (count: number) => `${count} 分鐘前`,
  timeHours: (count: number) => `${count} 小時前`,
  statsError: "無法載入統計資料",
  aboutLines: (device) => [
    "用於專注與放鬆的棕色噪音產生器。",
    `開啟線上模式後，所有在線的人共用一台${device}（節省電力）。`,
    "原作：YouTube @codingapple",
  ],
} satisfies Locale;
