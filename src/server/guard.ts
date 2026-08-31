import { RateLimiterMemory } from "rate-limiter-flexible";

/**
 * 요청 하나에 대한 판정.
 *   allow     - 그냥 통과
 *   challenge - 사람인지 확인시키고 통과 (오탐 여지가 있을 때)
 *   block     - 거부
 */
export const VERDICTS = ["allow", "challenge", "block"] as const;
export type Verdict = (typeof VERDICTS)[number];

export type GuardOptions = {
  /** IP당 동시 소켓 수 상한. */
  maxConcurrentSockets: number;
  /** IP당 분당 핸드셰이크 허용 횟수. */
  handshakesPerMinute: number;
  /** IP당 분당 HTTP 요청 허용 횟수. */
  httpPerMinute: number;
  /** 관리 토큰을 이만큼 틀리면 잠근다. */
  adminFailureLimit: number;
  /** 관리 잠금 시간(초). */
  adminLockSeconds: number;
  /** 이 점수 이상이면 챌린지. */
  challengeScore: number;
  /** 이 점수 이상이면 차단. */
  blockScore: number;
};

export type ScoreBreakdown = {
  /** 동시 연결 수에서 온 점수. */
  concurrent: number;
  /** 재접속 빈도에서 온 점수. */
  handshakes: number;
  /** rate limit에 걸린 이력 등 누적 의심에서 온 점수. */
  suspicion: number;
  total: number;
  verdict: Verdict;
};

/** 점수 구성 비중. 셋을 더해 100이 되도록 잡았다. */
const WEIGHT = { concurrent: 40, handshakes: 30, suspicion: 30 };

/** 의심 점수의 상한(= WEIGHT.suspicion에 대응). */
const SUSPICION_CAP = 30;
/** 의심 점수가 사라지는 데 걸리는 시간(초). */
const SUSPICION_TTL = 600;

/**
 * IP별 행동을 세고, 그걸 근거로 판정한다.
 *
 * 이 점수는 Cloudflare 같은 것이 아니다. 저쪽은 전 세계 트래픽과 TLS 지문,
 * 학습된 모델을 본다. 여기서 볼 수 있는 것은 이 서버가 관찰한 것뿐이다.
 * 무성의한 자동화를 걸러내는 휴리스틱이라고 보는 편이 정확하다.
 *
 * 그래서 애매하면 차단하지 않고 챌린지를 띄운다. 사무실이나 학교처럼 여러
 * 사람이 한 주소를 공유하는 경우 하드 차단은 애먼 사람을 막는다. 챌린지는
 * 사람이면 통과하고 스크립트면 못 넘는다.
 */
export class Guard {
  readonly #options: GuardOptions;
  readonly #handshakes: RateLimiterMemory;
  readonly #http: RateLimiterMemory;
  readonly #adminFailures: RateLimiterMemory;
  readonly #suspicion: RateLimiterMemory;
  readonly #concurrent = new Map<string, number>();

  constructor(options: GuardOptions) {
    this.#options = options;
    this.#handshakes = new RateLimiterMemory({
      points: options.handshakesPerMinute,
      duration: 60,
    });
    this.#http = new RateLimiterMemory({ points: options.httpPerMinute, duration: 60 });
    this.#adminFailures = new RateLimiterMemory({
      points: options.adminFailureLimit,
      duration: options.adminLockSeconds,
      blockDuration: options.adminLockSeconds,
    });
    this.#suspicion = new RateLimiterMemory({ points: SUSPICION_CAP, duration: SUSPICION_TTL });
  }

  // -------------------------------------------------------------- 카운터

  /** HTTP 요청 하나. 한도를 넘으면 false. */
  async allowHttpRequest(ip: string): Promise<boolean> {
    try {
      await this.#http.consume(ip);
      return true;
    } catch {
      this.noteSuspicious(ip, 5);
      return false;
    }
  }

  /** 핸드셰이크 하나. 한도를 넘으면 false. */
  async allowHandshake(ip: string): Promise<boolean> {
    try {
      await this.#handshakes.consume(ip);
      return true;
    } catch {
      this.noteSuspicious(ip, 10);
      return false;
    }
  }

  /** 관리 토큰 실패. 잠금 상태가 되면 true. */
  async noteAdminFailure(ip: string): Promise<boolean> {
    try {
      await this.#adminFailures.consume(ip);
      return false;
    } catch {
      return true;
    }
  }

  /** 관리 요청이 지금 잠겨 있는지. */
  async isAdminLocked(ip: string): Promise<boolean> {
    const state = await this.#adminFailures.get(ip);
    return state !== null && state.consumedPoints >= this.#options.adminFailureLimit;
  }

  /** 관리 인증에 성공하면 실패 카운터를 지운다. */
  async clearAdminFailures(ip: string): Promise<void> {
    await this.#adminFailures.delete(ip);
  }

  /** 소켓이 열렸다. 상한을 넘으면 false(= 받지 말 것). */
  openSocket(ip: string): boolean {
    const next = (this.#concurrent.get(ip) ?? 0) + 1;
    if (next > this.#options.maxConcurrentSockets) {
      this.noteSuspicious(ip, 10);
      return false;
    }
    this.#concurrent.set(ip, next);
    return true;
  }

  closeSocket(ip: string): void {
    const next = (this.#concurrent.get(ip) ?? 1) - 1;
    if (next <= 0) this.#concurrent.delete(ip);
    else this.#concurrent.set(ip, next);
  }

  concurrentSockets(ip: string): number {
    return this.#concurrent.get(ip) ?? 0;
  }

  /** 의심스러운 행동을 기록한다. 시간이 지나면 저절로 사라진다. */
  noteSuspicious(ip: string, points: number): void {
    // consume은 한도를 넘으면 reject 하지만 여기서는 상한까지만 쌓이면 되므로
    // 실패를 무시한다.
    void this.#suspicion.consume(ip, points).catch(() => {});
  }

  // -------------------------------------------------------------- 점수

  async score(ip: string): Promise<ScoreBreakdown> {
    const { maxConcurrentSockets, handshakesPerMinute } = this.#options;

    const concurrentRatio = this.concurrentSockets(ip) / Math.max(1, maxConcurrentSockets);
    const handshakeState = await this.#handshakes.get(ip);
    const handshakeRatio = (handshakeState?.consumedPoints ?? 0) / Math.max(1, handshakesPerMinute);
    const suspicionState = await this.#suspicion.get(ip);
    const suspicionPoints = suspicionState?.consumedPoints ?? 0;

    const concurrent = Math.min(WEIGHT.concurrent, concurrentRatio * WEIGHT.concurrent);
    const handshakes = Math.min(WEIGHT.handshakes, handshakeRatio * WEIGHT.handshakes);
    const suspicion = Math.min(
      WEIGHT.suspicion,
      (suspicionPoints / SUSPICION_CAP) * WEIGHT.suspicion,
    );

    const total = Math.round(concurrent + handshakes + suspicion);
    return {
      concurrent: Math.round(concurrent),
      handshakes: Math.round(handshakes),
      suspicion: Math.round(suspicion),
      total,
      verdict: this.verdictFor(total),
    };
  }

  verdictFor(total: number): Verdict {
    if (total >= this.#options.blockScore) return "block";
    if (total >= this.#options.challengeScore) return "challenge";
    return "allow";
  }

  /** 테스트에서 상태를 비운다. */
  reset(): void {
    this.#concurrent.clear();
  }
}
