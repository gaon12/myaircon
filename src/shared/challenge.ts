import { type Infer, integer, object, string } from "./validate.ts";

/** 서버가 내주는 챌린지. 클라이언트는 이걸 그대로 답과 함께 돌려보낸다. */
export const challengeSchema = object({
  nonce: string({ minLength: 8, maxLength: 128 }),
  difficulty: integer({ min: 1, max: 32 }),
  expiresAt: integer({ min: 0 }),
  signature: string({ minLength: 16, maxLength: 128 }),
});
export type Challenge = Infer<typeof challengeSchema>;

/** POST /api/verify 요청. */
export const verifyRequestSchema = object({
  nonce: string({ minLength: 8, maxLength: 128 }),
  difficulty: integer({ min: 1, max: 32 }),
  expiresAt: integer({ min: 0 }),
  signature: string({ minLength: 16, maxLength: 128 }),
  answer: string({ minLength: 1, maxLength: 64 }),
});
export type VerifyRequest = Infer<typeof verifyRequestSchema>;

export const verifyResponseSchema = object({
  token: string({ minLength: 8, maxLength: 256 }),
});
export type VerifyResponse = Infer<typeof verifyResponseSchema>;

/** 소켓 연결이 챌린지 때문에 거부됐을 때의 사유 문자열. */
export const CHALLENGE_REQUIRED = "challenge_required";
/** 점수가 차단 구간이거나 밴일 때. */
export const CONNECTION_BLOCKED = "blocked";
