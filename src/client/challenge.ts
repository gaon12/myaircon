import { type Challenge, challengeSchema, verifyResponseSchema } from "../shared/challenge.ts";

/**
 * 작업증명 챌린지 풀이 (브라우저).
 *
 * 이 화면은 점수가 애매한 접속에만 뜬다. 평소에는 아무도 보지 않는다.
 * 서버가 준 nonce에 대해 sha256(nonce + answer)의 앞 difficulty 비트가 0이
 * 되는 answer를 찾는다.
 *
 * crypto.subtle.digest는 호출마다 비동기라 반복 비용이 있다. 그래서 난이도를
 * 낮게(기본 14비트, 기댓값 약 16,000회) 잡았다. 진행 상황을 보고할 수 있도록
 * 일정 횟수마다 이벤트 루프에 양보한다 -- 그래야 화면이 멈추지 않는다.
 */

const REPORT_EVERY = 2000;

/** 확인 화면에 나오는 캐릭터 수. public/img/{scan,catch}_N.webp */
export const CHARACTER_COUNT = 3;

/**
 * 방문마다 캐릭터 하나를 고른다. 탐색 중에는 scan, 막혔을 때는 catch 포즈라
 * 같은 캐릭터로 이어져야 한 사람이 쫓아온 것처럼 읽힌다.
 */
export function pickCharacter(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * CHARACTER_COUNT);
}

const encoder = new TextEncoder();

function meetsDifficulty(hash: Uint8Array, difficulty: number): boolean {
  let remaining = difficulty;
  for (const byte of hash) {
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
      continue;
    }
    if (remaining <= 0) return true;
    return byte >> (8 - remaining) === 0;
  }
  return remaining <= 0;
}

export async function fetchChallenge(): Promise<Challenge | null> {
  const response = await fetch("/api/challenge");
  if (!response.ok) return null;
  const parsed = challengeSchema.parse(await response.json(), "challenge");
  return parsed.ok ? parsed.value : null;
}

export type SolveProgress = (attempts: number) => void;

/** 답을 찾는다. 중단되면 null. */
export async function solveChallenge(
  challenge: Challenge,
  onProgress?: SolveProgress,
  signal?: AbortSignal,
): Promise<string | null> {
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted === true) return null;

    const answer = String(attempt);
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(challenge.nonce + answer));
    if (meetsDifficulty(new Uint8Array(digest), challenge.difficulty)) return answer;

    if (attempt % REPORT_EVERY === 0) {
      onProgress?.(attempt);
      // 화면이 멈추지 않도록 잠깐 양보한다.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

/** 답을 제출하고 소켓에 낼 토큰을 받는다. */
export async function submitSolution(challenge: Challenge, answer: string): Promise<string | null> {
  const response = await fetch("/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...challenge, answer }),
  });
  if (!response.ok) return null;
  const parsed = verifyResponseSchema.parse(await response.json(), "verify");
  return parsed.ok ? parsed.value.token : null;
}

/** 챌린지를 받아 풀고 토큰까지 얻는 한 번의 흐름. */
export async function runChallenge(
  onProgress?: SolveProgress,
  signal?: AbortSignal,
): Promise<string | null> {
  const challenge = await fetchChallenge();
  if (challenge === null) return null;
  const answer = await solveChallenge(challenge, onProgress, signal);
  if (answer === null) return null;
  return submitSolution(challenge, answer);
}
