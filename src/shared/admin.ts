import { arrayOf, type Infer, integer, object, string, union } from "./validate.ts";

/** 지금 붙어 있는 연결 하나. */
export const sessionInfoSchema = object({
  socketId: string({ maxLength: 64 }),
  /** 관리자에게만 보인다. */
  ip: string({ maxLength: 64 }),
  /** 화면에서 사람을 가리키는 짧은 표시. */
  tag: string({ maxLength: 16 }),
  /** 마지막으로 쓴 닉네임. 아직 아무것도 누르지 않았으면 빈 문자열. */
  nickname: string({ maxLength: 128 }),
  connectedAt: integer({ min: 0 }),
});
export type SessionInfo = Infer<typeof sessionInfoSchema>;

export const banRecordSchema = object({
  ip: string({ maxLength: 64 }),
  tag: string({ maxLength: 16 }),
  until: integer({ min: 0 }),
  reason: string({ maxLength: 256 }),
  createdAt: integer({ min: 0 }),
});
export type BanRecordView = Infer<typeof banRecordSchema>;

export const adminOverviewSchema = object({
  sessions: arrayOf(sessionInfoSchema),
  bans: arrayOf(banRecordSchema),
  online: integer({ min: 0 }),
  at: integer({ min: 0 }),
});
export type AdminOverview = Infer<typeof adminOverviewSchema>;

/** POST /api/admin/kick 요청 본문. ip 또는 tag 중 하나로 지정한다. */
export const kickRequestSchema = object({
  target: union(
    object({ ip: string({ minLength: 1, maxLength: 64 }) }),
    object({ tag: string({ minLength: 1, maxLength: 16 }) }),
  ),
  /** 차단 시간(분). 0이면 끊기만 하고 차단하지 않는다. */
  minutes: integer({ min: 0, max: 60 * 24 * 365 }),
  reason: string({ maxLength: 256 }),
});
export type KickRequest = Infer<typeof kickRequestSchema>;

export const kickResultSchema = object({
  /** 실제로 끊은 연결 수. */
  disconnected: integer({ min: 0 }),
  /** 차단이 걸렸으면 만료 시각, 아니면 0. */
  bannedUntil: integer({ min: 0 }),
});
export type KickResult = Infer<typeof kickResultSchema>;

export const unbanRequestSchema = object({
  ip: string({ minLength: 1, maxLength: 64 }),
});
export type UnbanRequest = Infer<typeof unbanRequestSchema>;
