import type { Locale } from "../locale.ts";

export default {
  code: "ja",
  name: "日本語",
  device: { aircon: "エアコン", heater: "ヒーター" },
  appName: (device) => `オンライン${device}`,

  nicknameLabel: "ニックネーム",
  nicknamePlaceholder: "ニックネーム（任意）",
  start: "スタート",

  onlineOn: "オンラインモード オン",
  onlineOff: "オンラインモード オフ",
  connecting: "接続中…",

  soundOn: "ミュート",
  soundOff: "ミュート解除",
  warmer: "温度を上げる",
  cooler: "温度を下げる",

  adjustedBy: (name) => `調整した人: ${name}`,
  rateLimited: (seconds) => `リクエストが多すぎます。${seconds}秒後にもう一度お試しください`,
  atMax: "すでに最高温度です",
  atMin: "すでに最低温度です",
  audioFailed: "ブラウザがオーディオを開始できませんでした（https または localhost が必要です）",
  connectionLost: "サーバーとの接続が切れました。再接続中…",
  connectionFailed: "サーバーに接続できません",
  serverError: "サーバーでエラーが発生しました",

  stats: "統計",
  about: "情報",
  close: "閉じる",
  plusCount: "＋ を押した回数",
  minusCount: "－ を押した回数",

  language: "言語",
  theme: "テーマ",
  themeSystem: "システム",
  themeLight: "ライト",
  themeDark: "ダーク",

  aboutLines: (device) => [
    "集中とリラックスのためのブラウンノイズ・ジェネレーターです。",
    `オンラインモードをオンにすると、接続中の全員で${device}を1台共有します（節電）。`,
    "原作: YouTube @codingapple",
  ],
} satisfies Locale;
