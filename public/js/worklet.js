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
   * 게인 스테이징(audio.js)이 이 값을 근거로 헤드룸을 잡는다.
   * 상수를 바꾸면 test/brown-noise.test.js가 실측치와 비교해 잡아낸다.
   */
  standardDeviation: 0.0862,
};

/**
 * 한 채널 분량을 채운다. 순수 함수라 Node에서 그대로 테스트할 수 있다.
 * @param {Float32Array|number[]} output 채울 버퍼
 * @param {number} lastOut 이전 블록의 마지막 표본(적분기 상태)
 * @param {() => number} random [0,1) 난수원
 * @returns {number} 다음 블록으로 이어질 상태
 */
export function renderBrownNoise(output, lastOut, random = Math.random) {
  let last = lastOut;
  for (let i = 0; i < output.length; i++) {
    const white = random() * 2 - 1;
    last = (last + BROWN_NOISE.inputScale * white) / BROWN_NOISE.leak;
    output[i] = last;
  }
  return last;
}

// 브라우저의 AudioWorkletGlobalScope에서는 언제나 진짜 AudioWorkletProcessor가
// 있다. 이 fallback은 Node에서 이 모듈을 import 해 DSP를 테스트하기 위한 것이다.
const ProcessorBase = globalThis.AudioWorkletProcessor ?? class {};

class BrownNoiseProcessor extends ProcessorBase {
  constructor() {
    super();
    // 채널마다 독립적인 적분기 상태를 갖는다.
    //
    // 기존 코드는 this.lastOut 하나를 채널 루프 "바깥"에 두고 모든 채널이
    // 공유하게 했다. 그래서 좌/우가 같은 랜덤워크를 번갈아 나눠 가진, 모노를
    // 지그재그로 썬 신호가 됐다(스테레오 디코릴레이션 0).
    this.lastOut = [];
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    for (let channel = 0; channel < output.length; channel++) {
      this.lastOut[channel] = renderBrownNoise(output[channel], this.lastOut[channel] ?? 0);
    }
    return true;
  }
}

globalThis.registerProcessor?.("brown-noise-processor", BrownNoiseProcessor);
