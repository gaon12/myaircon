const WORKLET_URL = "/js/worklet.js";
const PROCESSOR_NAME = "brown-noise-processor";

/**
 * 브라운 노이즈 재생을 담당한다.
 *
 * 기존 brown-run.js는 상태를 두 군데로 쪼개 들고 있었다. isPlaying은
 * brown-run.js가, isSoundOn은 index.html이 선언했는데 두 파일이 모두
 * 양쪽을 수정했다(<script> 태그끼리 전역 렉시컬 스코프를 공유하는 구조).
 * 그래서 이런 일이 벌어졌다.
 *
 *   1. turnOn()이 버튼을 프로그램적으로 click 한다.
 *   2. 핸들러가 `await audioContext.audioWorklet.addModule(...)`에서 실패한다.
 *      (localhost도 https도 아닌 환경 — README가 직접 경고하던 그 상황)
 *      try/catch가 없어 조용한 unhandled rejection이 되고 gainNode는 null.
 *   3. 그런데 turnOn()은 그 직후 동기적으로 isSoundOn = true를 박는다.
 *   4. 이후 온도가 바뀔 때마다 realTimeGain()이 호출되고
 *      `gainNode.gain.value`에서 TypeError가 난다.
 *
 * 이 클래스는 상태를 한 곳에서만 들고, 오디오 그래프가 실제로 살아 있을
 * 때만 playing이 true가 되도록 보장한다.
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
      if (this.#context === null) {
        this.#context = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (!this.#moduleLoaded) {
        // addModule은 secure context(localhost 또는 https)에서만 성공한다.
        // 실패를 삼키지 않고 호출자에게 알린다.
        await this.#context.audioWorklet.addModule(WORKLET_URL);
        this.#moduleLoaded = true;
      }
      if (this.#context.state === "suspended") {
        await this.#context.resume();
      }

      this.#source = new AudioWorkletNode(this.#context, PROCESSOR_NAME);
      this.#gain = this.#context.createGain();
      this.#gain.gain.value = gainValue;

      this.#filter = this.#context.createBiquadFilter();
      this.#filter.type = "lowpass";
      this.#filter.frequency.value = 4000;

      this.#source.connect(this.#filter).connect(this.#gain).connect(this.#context.destination);
      return true;
    } catch (error) {
      this.#teardown();
      this.dispatchEvent(new CustomEvent("failed", { detail: error }));
      return false;
    } finally {
      this.#starting = false;
    }
  }

  /** 재생을 멈추고 그래프의 모든 노드를 끊는다. */
  stop() {
    this.#teardown();
    // 정지 중에는 오디오 스레드를 놀린다.
    this.#context?.suspend().catch(() => {});
  }

  /**
   * 볼륨을 바꾼다. 그래프가 없으면 조용히 무시한다.
   * 예전에는 여기서 null 참조로 TypeError가 났다.
   */
  setGain(value) {
    if (this.#gain === null) return;
    this.#gain.gain.value = value;
  }

  #teardown() {
    // 기존 코드는 뮤트할 때 source와 gain만 끊고 filter는 내버려 뒀다.
    // 뮤트/언뮤트를 반복하면 BiquadFilterNode가 계속 쌓였다.
    for (const node of [this.#source, this.#filter, this.#gain]) {
      node?.disconnect();
    }
    this.#source = null;
    this.#filter = null;
    this.#gain = null;
  }
}
