/**
 * 브라운 노이즈 생성기 (AudioWorkletGlobalScope에서 실행된다).
 *
 * 흰 잡음을 누설 적분기(leaky integrator)에 통과시켜 저역이 강조된
 * 브라운 노이즈를 만든다.
 *
 *   y[n] = (y[n-1] + inputScale * w[n]) / leak,   w ~ Uniform(-1, 1)
 */

export const BROWN_NOISE = {
  inputScale: 0.03,
  leak: 1.02,

  /**
   * 위 재귀식의 정상상태 표준편차.
   *   a = 1/leak, b = inputScale/leak
   *   sigma^2 = b^2 * var(w) / (1 - a^2),  var(w) = 1/3
   * 게인 스테이징(audio.ts)이 이 값을 근거로 헤드룸을 잡는다.
   * 상수를 바꾸면 test/brown-noise.test.ts가 실측치와 비교해 잡아낸다.
   */
  standardDeviation: 0.0862,
} as const;

/** Float32Array와 일반 배열 양쪽에 쓸 수 있게 최소한만 요구한다. */
export type SampleBuffer = {
  readonly length: number;
  [index: number]: number;
};

/**
 * 한 채널 분량을 채운다. 순수 함수라 Node에서 그대로 테스트할 수 있다.
 * @param output 채울 버퍼
 * @param lastOut 이전 블록의 마지막 표본(적분기 상태)
 * @param random [0,1) 난수원
 * @returns 다음 블록으로 이어질 상태
 */
export function renderBrownNoise(
  output: SampleBuffer,
  lastOut: number,
  random: () => number = Math.random,
): number {
  let last = lastOut;
  for (let i = 0; i < output.length; i++) {
    const white = random() * 2 - 1;
    last = (last + BROWN_NOISE.inputScale * white) / BROWN_NOISE.leak;
    output[i] = last;
  }
  return last;
}

/**
 * AudioWorkletGlobalScope의 전역들. lib.dom에는 없다(별도 전역 스코프라서).
 * 브라우저에서는 언제나 실제 구현이 들어 있고, Node에서 이 모듈을 import 해
 * DSP만 테스트할 때는 undefined다.
 */
type AudioWorkletGlobals = {
  AudioWorkletProcessor?: new () => object;
  registerProcessor?: (name: string, processor: new () => object) => void;
};

const workletScope = globalThis as unknown as AudioWorkletGlobals;

// 브라우저의 AudioWorkletGlobalScope에서는 언제나 진짜 AudioWorkletProcessor가
// 있다. 이 fallback은 Node에서 이 모듈을 import 해 DSP를 테스트하기 위한 것이다.
const ProcessorBase = workletScope.AudioWorkletProcessor ?? (class {} as new () => object);

class BrownNoiseProcessor extends ProcessorBase {
  /**
   * 채널마다 독립적인 적분기 상태를 갖는다.
   *
   * 기존 코드는 this.lastOut 하나를 채널 루프 "바깥"에 두고 모든 채널이
   * 공유하게 했다. 그래서 좌/우가 같은 랜덤워크를 번갈아 나눠 가진, 모노를
   * 지그재그로 썬 신호가 됐다(스테레오 디코릴레이션 0).
   */
  readonly lastOut: number[] = [];

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    if (output === undefined) return true;
    for (let channel = 0; channel < output.length; channel++) {
      const buffer = output[channel];
      if (buffer === undefined) continue;
      this.lastOut[channel] = renderBrownNoise(buffer, this.lastOut[channel] ?? 0);
    }
    return true;
  }
}

workletScope.registerProcessor?.("brown-noise-processor", BrownNoiseProcessor);
