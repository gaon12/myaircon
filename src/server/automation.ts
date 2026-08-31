import {
  type AutomationSignal,
  automationReportSchema,
  signalsFromUserAgent,
} from "../shared/automation.ts";

/** 흔적이 잡혔을 때 무엇을 할지. */
export const AUTOMATION_ACTIONS = ["score", "challenge", "block"] as const;
export type AutomationAction = (typeof AUTOMATION_ACTIONS)[number];

export type AutomationPolicy = {
  /** 흔적이 하나라도 있으면 더할 의심 점수. 0이면 감지를 끈다. */
  points: number;
  /**
   * 흔적이 있을 때의 처리.
   *
   *   score     - 점수만 올린다. 다른 행동과 합쳐져야 챌린지/차단에 닿는다.
   *   challenge - 바로 확인을 요구한다.
   *   block     - 바로 거부한다.
   *
   * 기본이 score인 데는 이유가 있다. 여기 흔적 대부분은 클라이언트가
   * 보고하는 값이라 위조할 수 있고, 작업증명 챌린지는 진짜 브라우저를 쓰는
   * puppeteer를 막지 못한다(1초면 푼다). 즉 challenge/block으로 올려도 막는
   * 것은 "숨길 생각조차 없는 자동화"뿐이고, 대신 접근성 도구나 자체
   * 모니터링을 막을 위험은 실재한다. 그 교환을 받아들일지는 운영자가 정한다.
   */
  action: AutomationAction;
};

/**
 * 핸드셰이크에서 볼 수 있는 것을 모두 모은다.
 *
 * 두 출처가 있고 신뢰도가 다르다.
 *   - auth.automation : 클라이언트가 보고한 것. 위조 가능.
 *   - User-Agent      : 헤더. 역시 위조 가능하지만 클라이언트 JS와는 무관.
 * 어느 쪽도 증거가 아니라 정황이다.
 */
export function collectSignals(input: {
  auth: unknown;
  userAgent: string | undefined;
}): AutomationSignal[] {
  const found = new Set<AutomationSignal>(reportedSignals(input.auth));
  for (const signal of signalsFromUserAgent(input.userAgent)) found.add(signal);
  return [...found];
}

/** auth.automation 을 검증해서 꺼낸다. 형태가 틀리면 없는 것으로 친다. */
export function reportedSignals(auth: unknown): AutomationSignal[] {
  if (typeof auth !== "object" || auth === null) return [];
  let raw: unknown;
  try {
    raw = (auth as Record<string, unknown>).automation;
  } catch {
    return [];
  }
  const result = automationReportSchema.parse(raw, "auth.automation");
  return result.ok ? result.value.signals : [];
}

/**
 * 흔적과 정책에서 실제 처리를 정한다.
 *
 * 흔적이 없거나 점수가 0이면 아무 일도 없다 -- 정책을 "block"으로 두었더라도
 * 점수 0은 기능 자체를 끈 것으로 본다. 두 가지 스위치를 각각 확인하게 하는
 * 것보다 하나로 끄는 편이 운영 중에 덜 헷갈린다.
 */
export function decide(
  signals: readonly AutomationSignal[],
  policy: AutomationPolicy,
): { readonly points: number; readonly action: AutomationAction | "none" } {
  if (signals.length === 0 || policy.points <= 0) return { points: 0, action: "none" };
  return { points: policy.points, action: policy.action };
}
