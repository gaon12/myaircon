import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GAIN, gainForTemperature, PEAK_HEADROOM_SIGMA } from "../src/client/audio.ts";
import { BROWN_NOISE, renderBrownNoise } from "../src/client/worklet.ts";

const BLOCK = 128;

/** 워크렛이 실제로 하는 것처럼 블록 단위로 이어 붙여 렌더링한다. */
function renderChannel(blocks: number, random: () => number = Math.random): Float64Array {
  const samples = new Float64Array(blocks * BLOCK);
  const buffer = new Float64Array(BLOCK);
  let last = 0;
  for (let b = 0; b < blocks; b++) {
    last = renderBrownNoise(buffer, last, random);
    samples.set(buffer, b * BLOCK);
  }
  return samples;
}

/** 근사 비교 (부동소수점 누적 오차 허용) */
const closeTo = (actual: number, expected: number, epsilon = 1e-9): void =>
  assert.ok(
    Math.abs(actual - expected) < epsilon,
    `${actual} !~= ${expected} (오차 ${Math.abs(actual - expected)})`,
  );

/** 큰 배열에 Math.max(...arr)를 쓰면 인자 개수 한계로 스택이 터진다. */
const peakOf = (xs: ArrayLike<number> & Iterable<number>, scale = 1): number => {
  let peak = 0;
  for (const x of xs) {
    const v = Math.abs(x * scale);
    if (v > peak) peak = v;
  }
  return peak;
};

const stddev = (xs: Float64Array): number => {
  const mean = xs.reduce((a: number, b: number) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a: number, b: number) => a + (b - mean) ** 2, 0) / xs.length);
};

const correlation = (xs: Float64Array, ys: Float64Array): number => {
  const mx = xs.reduce((a: number, b: number) => a + b, 0) / xs.length;
  const my = ys.reduce((a: number, b: number) => a + b, 0) / ys.length;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = (xs[i] ?? 0) - mx;
    const y = (ys[i] ?? 0) - my;
    num += x * y;
    dx += x ** 2;
    dy += y ** 2;
  }
  return num / Math.sqrt(dx * dy);
};

describe("브라운 노이즈 DSP", () => {
  it("문서화된 표준편차가 실측치와 맞는다", () => {
    // 게인 스테이징이 이 상수를 근거로 헤드룸을 잡으므로, 재귀식 상수를
    // 바꾸면서 이 값을 갱신하지 않으면 여기서 걸린다.
    const measured = stddev(renderChannel(4000).subarray(20_000));
    assert.ok(
      Math.abs(measured - BROWN_NOISE.standardDeviation) < 0.01,
      `실측 sigma ${measured.toFixed(4)} vs 문서값 ${BROWN_NOISE.standardDeviation}`,
    );
  });

  it("블록 경계에서 상태가 이어진다 (뚝뚝 끊기지 않는다)", () => {
    const buffer = new Float64Array(BLOCK);
    const last = renderBrownNoise(buffer, 0.05, () => 0.5);
    assert.equal(last, buffer[BLOCK - 1]);

    // 같은 상태에서 이어 받으면 첫 표본이 직전 마지막 표본에 가까워야 한다
    const next = new Float64Array(BLOCK);
    renderBrownNoise(next, last, () => 0.5);
    assert.ok(Math.abs((next[0] ?? 0) - last) < 0.01);
  });

  it("채널마다 독립적인 신호를 낸다 (기존에는 모노를 나눠 가졌다)", () => {
    // 워크렛은 채널별 상태를 따로 들고 renderBrownNoise를 각각 호출한다.
    const left = renderChannel(500);
    const right = renderChannel(500);
    const r = Math.abs(correlation(left, right));
    assert.ok(r < 0.2, `좌우 상관계수가 ${r.toFixed(3)}로 너무 높다`);
  });

  it("출력이 발산하지 않는다", () => {
    const samples = renderChannel(4000);
    const peak = peakOf(samples);
    assert.ok(peak < 1, `원신호 피크 ${peak.toFixed(3)}`);
    assert.ok(Number.isFinite(peak));
  });
});

describe("게인 스테이징", () => {
  it("온도가 높을수록 조용해진다", () => {
    const gains = [18, 21, 24, 27, 30].map((t) => gainForTemperature(t, 18, 30));
    for (let i = 1; i < gains.length; i++) {
      assert.ok((gains[i] ?? 0) < (gains[i - 1] ?? 0), `${gains[i]} < ${gains[i - 1]}`);
    }
    closeTo(gainForTemperature(18, 18, 30), GAIN.loudest);
    closeTo(gainForTemperature(30, 18, 30), GAIN.quietest);
  });

  it("온풍기는 방향이 반대다 (높게 맞출수록 세게 돈다)", () => {
    const heater = [18, 21, 24, 27, 30].map((t) => gainForTemperature(t, 18, 30, "heater"));
    for (let i = 1; i < heater.length; i++) {
      assert.ok((heater[i] ?? 0) > (heater[i - 1] ?? 0), `${heater[i]} > ${heater[i - 1]}`);
    }
    closeTo(gainForTemperature(18, 18, 30, "heater"), GAIN.quietest);
    closeTo(gainForTemperature(30, 18, 30, "heater"), GAIN.loudest);
  });

  it("같은 온도에서 에어컨과 온풍기의 게인이 서로 뒤집힌 값이다", () => {
    for (const temp of [18, 20, 24, 28, 30]) {
      const cool = gainForTemperature(temp, 18, 30, "aircon");
      const heat = gainForTemperature(temp, 18, 30, "heater");
      closeTo(cool + heat, GAIN.loudest + GAIN.quietest, 1e-9);
    }
  });

  it("기기 종류를 생략하면 에어컨으로 본다", () => {
    closeTo(gainForTemperature(18, 18, 30), gainForTemperature(18, 18, 30, "aircon"));
  });

  it("온풍기도 클리핑 헤드룸은 동일하다", () => {
    // 두 기기가 같은 GAIN 범위를 쓰므로 최댓값이 같아야 한다.
    const maxHeater = Math.max(...[18, 24, 30].map((t) => gainForTemperature(t, 18, 30, "heater")));
    assert.equal(maxHeater, GAIN.loudest);
  });

  it("설정으로 온도 범위를 바꿔도 게인 범위는 그대로다", () => {
    // 기존 공식 `temp * (-1/12) + 3`은 18~30을 암묵적으로 가정해서,
    // 범위를 바꾸면 게인이 음수가 되거나 폭주했다.
    closeTo(gainForTemperature(0, 0, 100), GAIN.loudest);
    closeTo(gainForTemperature(100, 0, 100), GAIN.quietest);
    closeTo(gainForTemperature(-40, -40, -20), GAIN.loudest);
  });

  it("범위를 벗어난 값과 이상한 입력을 클램프한다", () => {
    closeTo(gainForTemperature(-100, 18, 30), GAIN.loudest);
    closeTo(gainForTemperature(999, 18, 30), GAIN.quietest);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null, "x"]) {
      // 런타임에는 무엇이든 들어올 수 있다는 것을 확인하는 테스트이므로
      // 일부러 타입을 벗겨서 넘긴다.
      const g = gainForTemperature(bad as unknown as number, 18, 30);
      assert.ok(Number.isFinite(g) && g > 0, `${String(bad)} -> ${g}`);
    }
    closeTo(gainForTemperature(20, 30, 30), GAIN.quietest);
    closeTo(gainForTemperature(20, 30, 10), GAIN.quietest);
  });

  it("게인이 항상 양수이고 과하지 않다", () => {
    assert.ok(GAIN.quietest > 0);
    assert.ok(GAIN.loudest > GAIN.quietest);
    assert.ok(GAIN.loudest < 3, "너무 크면 헤드룸이 남지 않는다");
  });

  it("가장 큰 게인에서도 클리핑 여유가 6 sigma 이상이다", () => {
    // 기존 구성(워크렛 x3.5 + 게인 1.5)은 여유가 2.2 sigma뿐이라 48kHz에서
    // 초당 1000개가 넘는 표본이 잘렸다.
    assert.ok(PEAK_HEADROOM_SIGMA > 6, `헤드룸이 ${PEAK_HEADROOM_SIGMA.toFixed(2)} sigma뿐이다`);

    const OLD_WORKLET_SCALE = 3.5;
    const OLD_MAX_GAIN = 1.5;
    const oldHeadroom = 1 / (OLD_WORKLET_SCALE * OLD_MAX_GAIN * BROWN_NOISE.standardDeviation);
    assert.ok(oldHeadroom < 3, "기존 구성이 실제로 위험했음을 확인");
  });

  it("실제로 렌더링해도 최대 게인에서 클리핑이 없다", () => {
    const samples = renderChannel(8000);
    let clipped = 0;
    let peak = 0;
    for (const sample of samples) {
      const amplified = Math.abs(sample * GAIN.loudest);
      if (amplified > 1) clipped++;
      if (amplified > peak) peak = amplified;
    }
    assert.equal(clipped, 0, `${clipped}개 표본이 잘렸다 (피크 ${peak.toFixed(3)})`);
    assert.ok(peak < 0.95, `피크 ${peak.toFixed(3)}`);
  });

  it("기존 구성이었다면 같은 신호에서 클리핑이 났다는 것을 보여준다", () => {
    const samples = renderChannel(8000);
    const oldClipped = samples.filter((s) => Math.abs(s * 3.5 * 1.5) > 1).length;
    const ratio = oldClipped / samples.length;
    assert.ok(ratio > 0.01, `기존 구성 클리핑 비율 ${(ratio * 100).toFixed(2)}%`);
  });
});
