import type { Direction, PersistedState } from "../shared/protocol.ts";

/**
 * 모두가 공유하는 온도값 하나를 들고 있는 순수 상태 객체.
 *
 * 기존 코드는 server.js 안에 `var temp = 18`이 떠 있고 min/max 클램프가
 * 소켓 핸들러 두 곳에 복사돼 있었다. 여기로 모아서 클램프 로직을 한 곳에만
 * 두고, I/O 없이 단위 테스트할 수 있게 한다. 영속화는 StateStore의 몫이다.
 */
export type TemperatureRange = {
  min: number;
  max: number;
  initial?: number | undefined;
};

export type StepResult = {
  temp: number;
  /** 실제로 값이 바뀌었는지. 경계값에서 눌렀을 때를 구분하기 위한 것. */
  changed: boolean;
};

export class Thermostat {
  readonly #min: number;
  readonly #max: number;
  #value: number;

  constructor({ min, max, initial }: TemperatureRange) {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new TypeError("min/max는 정수여야 합니다");
    }
    if (min >= max) {
      throw new RangeError(`min(${min})은 max(${max})보다 작아야 합니다`);
    }
    this.#min = min;
    this.#max = max;
    this.#value = Thermostat.#clamp(initial ?? min, min, max);
  }

  static #clamp(value: unknown, min: number, max: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  get min(): number {
    return this.#min;
  }

  get max(): number {
    return this.#max;
  }

  get value(): number {
    return this.#value;
  }

  /** 온도를 한 칸 올리거나 내린다. */
  step(direction: Direction): StepResult {
    // 타입은 컴파일 시점에 지워지므로 런타임에도 확인한다.
    if (direction !== "up" && direction !== "down") {
      throw new TypeError(
        `direction은 "up" 또는 "down"이어야 합니다 (받은 값: ${String(direction)})`,
      );
    }
    const before = this.#value;
    const next = direction === "up" ? before + 1 : before - 1;
    this.#value = Thermostat.#clamp(next, this.#min, this.#max);
    return { temp: this.#value, changed: this.#value !== before };
  }

  /** 저장된 상태를 복원할 때 사용한다. 범위를 벗어난 값은 클램프된다. */
  restore(value: unknown): number {
    this.#value = Thermostat.#clamp(value, this.#min, this.#max);
    return this.#value;
  }

  toJSON(): PersistedState {
    return { temp: this.#value };
  }
}
