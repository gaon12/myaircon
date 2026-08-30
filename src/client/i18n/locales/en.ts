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

  aboutLines: (device) => [
    "A brown noise generator to focus and relax.",
    `Turn on online mode to share one ${device} with everyone (saves electricity).`,
    "Original: YouTube @codingapple",
  ],
} satisfies Locale;
