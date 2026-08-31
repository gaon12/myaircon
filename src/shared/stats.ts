import { DIRECTIONS } from "./protocol.ts";
import { arrayOf, type Infer, integer, literal, object, string } from "./validate.ts";

/** 순위를 집계하는 기간. */
export const RANK_PERIODS = ["today", "allTime"] as const;
export type RankPeriod = (typeof RANK_PERIODS)[number];

export const rankEntrySchema = object({
  username: string({ maxLength: 128 }),
  count: integer({ min: 0 }),
});
export type RankEntry = Infer<typeof rankEntrySchema>;

export const recentEntrySchema = object({
  at: integer({ min: 0 }),
  username: string({ maxLength: 128 }),
  direction: literal(...DIRECTIONS),
  temp: integer(),
});
export type RecentEntry = Infer<typeof recentEntrySchema>;

export const hourlyEntrySchema = object({
  /** epoch 기준 시(hour) 번호. 시각 = hour * 3600000 */
  hour: integer({ min: 0 }),
  changes: integer({ min: 0 }),
  averageTemp: integer(),
  minTemp: integer(),
  maxTemp: integer(),
});
export type HourlyEntry = Infer<typeof hourlyEntrySchema>;

/** GET /api/stats 응답. */
export const statsSnapshotSchema = object({
  online: integer({ min: 0 }),
  today: arrayOf(rankEntrySchema),
  allTime: arrayOf(rankEntrySchema),
  recent: arrayOf(recentEntrySchema),
  hourly: arrayOf(hourlyEntrySchema),
  /** 이 응답을 만든 시각. 클라이언트가 상대 시간을 계산할 때 쓴다. */
  at: integer({ min: 0 }),
});
export type StatsSnapshot = Infer<typeof statsSnapshotSchema>;

/** 서버 -> 전체: 접속자 수가 바뀌었을 때 */
export const onlineCountMessageSchema = object({
  online: integer({ min: 0 }),
});
export type OnlineCountMessage = Infer<typeof onlineCountMessageSchema>;

export const HOUR_MS = 3_600_000;
