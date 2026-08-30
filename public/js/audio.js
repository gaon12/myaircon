import { BROWN_NOISE } from "./worklet.js";

const WORKLET_URL = "/js/worklet.js";
const PROCESSOR_NAME = "brown-noise-processor";
const LOWPASS_HZ = 4000;

/**
 * 게인 범위.
 *
 * 기존 설정은 클리핑을 냈다. 워크렛이 출력에 3.5를 곱한 뒤(sigma 0.302)
 * 게인 노드에서 다시 1.5까지 곱해(sigma 0.453) 진폭이 1.0을 넘는 표본이
 * 전체의 약 2.7%였다. 48kHz에서 초당 1000개가 넘는 표본이 잘려 나가면서,
 * "집중과 휴식을 위한" 브라운 노이즈가 가장 시원한 온도에서 디스토션을
 * 무료로 제공했다.
 *
 * 이제 워크렛은 원신호(sigma ~= 0.0862)를 그대로 내보내고 음량은 여기서만
 * 정한다. 가장 큰 게인에서도 sigma = 0.0862 * 1.8 ~= 0.155이므로 1.0까지
 * 6.4 sigma의 여유가 있다. 가우시안 근사로 그 정도 편차는 채널당 대략
 * 수 시간에 한 번 나오는 수준이라 사실상 클리핑이 발생하지 않는다.
 * 리미터를 덧대는 대신 게인 스테이징으로 해결해 노이즈의 음색을 건드리지 않는다.
 */
export const GAIN = {
  loudest: 1.8,
  quietest: 0.45,
};

/** 온도가 낮을수록 크게, 높을수록 작게. */
export function gainForTemperature(temp, min, max) {
  // 기존 공식 `temp * (-1/12) + 3`은 18~30 범위를 암묵적으로 가정했다.
  // 설정으로 범위를 바꾸면 게인이 음수가 되거나 폭주할 수 있었다.
  if (!Number.isFinite(temp) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return GAIN.quietest;
  }
  const ratio = Math.min(1, Math.max(0, (temp - min) / (max - min)));
  return GAIN.loudest + (GAIN.quietest - GAIN.loudest) * ratio;
}

// 음량 변화에 걸리는 시간 상수. 값을 즉시 대입하면 파형이 끊겨 "딱" 소리가
// 난다. 온라인 모드에서는 지구 어딘가의 모르는 사람이 버튼을 누를 때마다
// 그 소리가 헤드폰에서 났다.
const GAIN_RAMP_SECONDS = 0.08;
const FADE_MS = 260;

/**
 * 브라운 노이즈 재생을 담당한다.
 *
 * 기존 brown-run.js는 상태를 두 군데로 쪼개 들고 있었다. isPlaying은
 * brown-run.js가, isSoundOn은 index.html이 선언했는데 두 파일이 모두 양쪽을
 * 수정했다. 그래서 addModule()이 실패하는 환경(https도 localhost도 아닌 곳)에서
 * gainNode는 null인데 isSoundOn만 true가 되어, 온도가 바뀔 때마다
 * "Cannot read properties of null" TypeError가 났다.
 *
 * 이 클래스가 그래프와 상태를 단독으로 소유하고, playing은 노드가 실제로
 * 살아 있을 때만 true다.
 */
export class BrownNoise extends EventTarget {
  #context = null;
  #source = null;
  #filter = null;
  #gain = null;
  #moduleLoaded = false;
  #starting = false;

  /** 오디오 그래프가 실제로 소리를 내고 있는지. 이 값만이 진실이다. */
  get playing() {
    return this.#source !== null;
  }

  /**
   * 재생을 시작한다. 사용자 제스처 안에서 호출해야 한다(자동재생 정책).
   * @returns {Promise<boolean>} 실제로 시작됐는지
   */
  async start(gainValue) {
    if (this.playing || this.#starting) return this.playing;
    this.#starting = true;
    try {
      this.#context ??= new (window.AudioContext || window.webkitAudioContext)();

      if (!this.#moduleLoaded) {
        // addModule은 secure context(localhost 또는 https)에서만 성공한다.
        // 실패를 삼키지 않고 호출자에게 알린다.
        await this.#context.audioWorklet.addModule(WORKLET_URL);
        this.#moduleLoaded = true;
      }

      if (this.#context.state === "suspended") {
        // 사용자 제스처가 없으면 브라우저가 이 Promise를 오래 붙들 수 있다.
        // await 하면 #starting이 영원히 true로 남아 버튼이 먹통이 된다.
        void this.#context.resume().catch(() => {});
      }

      this.#source = new AudioWorkletNode(this.#context, PROCESSOR_NAME, {
        // 채널마다 독립적인 랜덤워크를 내보내려면 스테레오를 명시해야 한다.
        outputChannelCount: [2],
      });

      this.#filter = this.#context.createBiquadFilter();
      this.#filter.type = "lowpass";
      this.#filter.frequency.value = LOWPASS_HZ;

      this.#gain = this.#context.createGain();
      // 무음에서 시작해 올린다. 목표값을 바로 넣으면 시작할 때 툭 소리가 난다.
      this.#gain.gain.value = 0;
      this.setGain(gainValue);

      this.#source.connect(this.#filter).connect(this.#gain).connect(this.#context.destination);
      return true;
    } catch (error) {
      this.#disconnectAll([this.#source, this.#filter, this.#gain]);
      this.#source = null;
      this.#filter = null;
      this.#gain = null;
      this.dispatchEvent(new CustomEvent("failed", { detail: error }));
      return false;
    } finally {
      this.#starting = false;
    }
  }

  /** 페이드 아웃한 뒤 그래프의 모든 노드를 끊는다. */
  stop() {
    const context = this.#context;
    const nodes = [this.#source, this.#filter, this.#gain];
    const gain = this.#gain;
    if (context === null || gain === null) return;

    // playing이 곧바로 false가 되도록 참조를 먼저 놓는다.
    this.#source = null;
    this.#filter = null;
    this.#gain = null;

    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setTargetAtTime(0, context.currentTime, GAIN_RAMP_SECONDS);

    setTimeout(() => {
      // 기존 코드는 뮤트할 때 source와 gain만 끊고 filter는 내버려 뒀다.
      // 뮤트/언뮤트를 반복하면 BiquadFilterNode가 계속 쌓였다.
      this.#disconnectAll(nodes);
      // 페이드 도중에 다시 재생을 시작했다면 새 그래프를 죽이면 안 된다.
      if (!this.playing) context.suspend().catch(() => {});
    }, FADE_MS);
  }

  /**
   * 음량을 바꾼다. 그래프가 없으면 조용히 무시한다.
   * 예전에는 여기서 null 참조로 TypeError가 났다.
   */
  setGain(value) {
    if (this.#gain === null || this.#context === null) return;
    // 즉시 대입(gain.value = x)이 아니라 시간 상수를 두고 수렴시킨다.
    this.#gain.gain.setTargetAtTime(value, this.#context.currentTime, GAIN_RAMP_SECONDS);
  }

  #disconnectAll(nodes) {
    for (const node of nodes) {
      try {
        node?.disconnect();
      } catch {
        // 이미 끊긴 노드
      }
    }
  }
}

// 게인 스테이징이 워크렛의 실제 출력 크기를 근거로 삼는다는 것을 명시한다.
export const PEAK_HEADROOM_SIGMA = 1 / (GAIN.loudest * BROWN_NOISE.standardDeviation);
