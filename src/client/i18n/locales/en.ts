import type { Locale } from "../locale.ts";

export default {
  code: "en",
  name: "English",
  device: { aircon: "aircon", heater: "heater" },
  // 문장 안에서는 소문자("share one aircon"), 제목에서는 첫 글자를 올린다.
  appName: (device: string) => `Online ${device.charAt(0).toUpperCase()}${device.slice(1)}`,

  nicknameLabel: "Nickname",
  nicknamePlaceholder: "nickname (optional)",
  start: "Start",

  onlineOn: "Online mode is on",
  onlineOff: "Online mode is off",
  connecting: "Connecting…",

  soundOn: "Mute",
  soundOff: "Unmute",
  warmer: "Increase temperature",
  cooler: "Decrease temperature",

  adjustedBy: (name) => `Adjusted by ${name}`,
  rateLimited: (seconds) => `Too many requests. Try again in ${seconds}s`,
  atMax: "Already at the highest temperature",
  atMin: "Already at the lowest temperature",
  audioFailed: "The browser could not start audio (requires https or localhost)",
  connectionLost: "Disconnected from the server. Reconnecting…",
  connectionFailed: "Could not reach the server",
  serverError: "The server ran into an error",

  stats: "Stats",
  about: "About",
  close: "Close",
  plusCount: "+ pressed",
  minusCount: "- pressed",

  language: "Language",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",

  online: "Online",
  onlineCount: (count: number) => `${count} online`,
  myStats: "Your presses",
  rankTitle: "Most adjustments",
  rankToday: "Today",
  rankAllTime: "All time",
  rankNote: "Counted by nickname",
  rankEmpty: "No adjustments yet",
  changesUnit: (count: number) => `${count}`,
  hourlyTitle: "Activity, last 24 hours",
  hourlySummary: (total: number) => `${total} adjustments in 24 hours`,
  hourlyDetail: (hour: number, changes: number, average: number) =>
    `${hour}:00 · ${changes} adjustments · avg ${average}℃`,
  recentTitle: "Recent changes",
  recentEmpty: "Nothing yet",
  timeJustNow: "just now",
  timeMinutes: (count: number) => `${count}m ago`,
  timeHours: (count: number) => `${count}h ago`,
  statsError: "Could not load statistics",
  aboutLines: (device) => [
    "A brown noise generator to focus and relax.",
    `Turn on online mode to share one ${device} with everyone (saves electricity).`,
    "Original: YouTube @codingapple",
  ],
} satisfies Locale;
