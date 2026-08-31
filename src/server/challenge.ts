import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 사람인지 확인하는 작업증명(PoW) 챌린지.
 *
 * 왜 모두에게 걸지 않나
 *   페이지 전체를 PoW로 막는 방식(Anubis 등)은 "렌더링이 비싼 페이지를 대량
 *   크롤링에서 지키는" 도구다. 이 앱의 페이지는 정적 HTML 몇 KB라 지킬 것이
 *   없고, 남용 경로는 WebSocket이다. 게다가 순위를 노리는 쪽은 CPU 몇백 ms를
 *   기꺼이 쓰므로 정작 막고 싶은 대상은 못 막고 선량한 방문자만 지연을 문다.
 *
 * 그래서 점수가 애매할 때만 띄운다
 *   하드 차단 대신 챌린지를 쓰는 이유는 오탐 때문이다. 사무실이나 학교처럼
 *   한 주소를 여럿이 쓰면 정상 사용자도 한도에 걸린다. 그때 사람이면 통과하고
 *   스크립트면 못 넘게 하는 것이 목적이다.
 *
 * 방식
 *   서버가 nonce와 난이도를 준다. 클라이언트는 sha256(nonce + answer)의 앞
 *   difficulty 비트가 0인 answer를 찾는다. 검증은 해시 한 번이라 서버는 거의
 *   공짜다. 통과하면 짧게 유효한 서명 토큰을 주고, 소켓 핸드셰이크에서 그걸 낸다.
 *   외부 서비스도, 쿠키도, 개인정보도 쓰지 않는다.
 */

export type Challenge = {
  nonce: string;
  /** 앞에서부터 0이어야 하는 비트 수. */
  difficulty: number;
  /** 이 시각까지 유효 (epoch ms). */
  expiresAt: number;
  /** 서버가 발급했음을 증명하는 서명. 상태를 저장하지 않기 위한 것. */
  signature: string;
};

export type ChallengeOptions = {
  secret: string;
  difficulty: number;
  /** 챌린지 유효 시간(초). */
  ttlSeconds: number;
  /** 통과 후 받은 토큰의 유효 시간(초). */
  tokenTtlSeconds: number;
};

const sign = (secret: string, payload: string): string =>
  createHmac("sha256", secret).update(payload).digest("hex");

/** 길이가 달라도 시간이 새지 않게 비교한다. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** 해시 앞부분이 difficulty 비트만큼 0인지. */
export function meetsDifficulty(hash: Buffer, difficulty: number): boolean {
  let remaining = difficulty;
  for (const byte of hash) {
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
      continue;
    }
    if (remaining <= 0) return true;
    // 남은 비트만 확인한다.
    return byte >> (8 - remaining) === 0;
  }
  return remaining <= 0;
}

export class ChallengeIssuer {
  readonly #options: ChallengeOptions;

  constructor(options: ChallengeOptions) {
    this.#options = options;
  }

  get difficulty(): number {
    return this.#options.difficulty;
  }

  /**
   * 새 챌린지를 만든다.
   *
   * 서버는 발급한 챌린지를 저장하지 않는다. nonce/난이도/만료를 서명해 두면
   * 나중에 그 서명만 확인해도 우리가 낸 것인지 알 수 있다. 저장소가 없으니
   * 메모리도 안 쓰고 인스턴스가 여러 개여도(같은 비밀키면) 그대로 동작한다.
   */
  issue(now = Date.now()): Challenge {
    const nonce = randomBytes(16).toString("hex");
    const expiresAt = now + this.#options.ttlSeconds * 1000;
    const difficulty = this.#options.difficulty;
    return {
      nonce,
      difficulty,
      expiresAt,
      signature: sign(this.#options.secret, `${nonce}.${difficulty}.${expiresAt}`),
    };
  }

  /**
   * 답을 검증한다. 통과하면 소켓 핸드셰이크에 낼 토큰을 돌려준다.
   * @returns 토큰, 실패 시 null
   */
  verify(
    input: {
      nonce: string;
      difficulty: number;
      expiresAt: number;
      signature: string;
      answer: string;
    },
    now = Date.now(),
  ): string | null {
    const { nonce, difficulty, expiresAt, signature, answer } = input;

    // 1) 우리가 낸 챌린지인가
    const expected = sign(this.#options.secret, `${nonce}.${difficulty}.${expiresAt}`);
    if (!safeEqual(signature, expected)) return null;

    // 2) 아직 유효한가
    if (expiresAt <= now) return null;

    // 3) 난이도를 우리가 정한 것보다 낮춰 오지 않았는가
    if (difficulty < this.#options.difficulty) return null;

    // 4) 답이 실제로 맞는가 (해시 한 번)
    const hash = createHash("sha256").update(`${nonce}${answer}`).digest();
    if (!meetsDifficulty(hash, difficulty)) return null;

    return this.#issueToken(now);
  }

  #issueToken(now: number): string {
    const expiresAt = now + this.#options.tokenTtlSeconds * 1000;
    return `${expiresAt}.${sign(this.#options.secret, `token.${expiresAt}`)}`;
  }

  /** 핸드셰이크에서 받은 토큰이 유효한가. */
  isTokenValid(token: unknown, now = Date.now()): boolean {
    if (typeof token !== "string") return false;
    const separator = token.indexOf(".");
    if (separator <= 0) return false;

    const expiresAt = Number(token.slice(0, separator));
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

    return safeEqual(token.slice(separator + 1), sign(this.#options.secret, `token.${expiresAt}`));
  }
}
