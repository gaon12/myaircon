import type { Locale } from "../locale.ts";

export default {
  code: "zh-Hans",
  name: "简体中文",
  device: { aircon: "空调", heater: "暖风机" },
  appName: (device) => `在线${device}`,

  nicknameLabel: "昵称",
  nicknamePlaceholder: "昵称（可选）",
  start: "开始",

  onlineOn: "在线模式已开启",
  onlineOff: "在线模式已关闭",
  connecting: "连接中…",

  soundOn: "静音",
  soundOff: "取消静音",
  warmer: "调高温度",
  cooler: "调低温度",

  adjustedBy: (name) => `调节者：${name}`,
  rateLimited: (seconds) => `请求过于频繁，请在 ${seconds} 秒后重试`,
  atMax: "已是最高温度",
  atMin: "已是最低温度",
  audioFailed: "浏览器无法启动音频（需要 https 或 localhost）",
  connectionLost: "与服务器的连接已断开，正在重新连接…",
  connectionFailed: "无法连接到服务器",
  serverError: "服务器发生错误",

  stats: "统计",
  about: "关于",
  close: "关闭",
  plusCount: "＋ 按下次数",
  minusCount: "－ 按下次数",

  language: "语言",
  theme: "主题",
  themeSystem: "跟随系统",
  themeLight: "浅色",
  themeDark: "深色",

  online: "在线人数",
  onlineCount: (count: number) => `${count} 人在线`,
  myStats: "我的记录",
  rankTitle: "调节最多的人",
  rankToday: "今天",
  rankAllTime: "总榜",
  rankNote: "按昵称统计",
  rankEmpty: "还没有调节记录",
  changesUnit: (count: number) => `${count} 次`,
  hourlyTitle: "最近 24 小时活动",
  hourlySummary: (total: number) => `24 小时内共调节 ${total} 次`,
  hourlyDetail: (hour: number, changes: number, average: number) =>
    `${hour} 时 · ${changes} 次 · 平均 ${average}℃`,
  recentTitle: "最近记录",
  recentEmpty: "暂无记录",
  timeJustNow: "刚刚",
  timeMinutes: (count: number) => `${count} 分钟前`,
  timeHours: (count: number) => `${count} 小时前`,
  statsError: "无法加载统计数据",
  aboutLines: (device) => [
    "用于专注和放松的棕色噪声生成器。",
    `开启在线模式后，所有在线的人共用一台${device}（节省电力）。`,
    "原作：YouTube @codingapple",
  ],
} satisfies Locale;
