/**
 * 아주 작은 런타임 검증 유틸리티.
 *
 * TypeScript의 타입은 컴파일 시점에 전부 지워진다. 그래서 소켓 페이로드,
 * 환경변수, 디스크에서 읽은 JSON, localStorage 값처럼 "바깥에서 들어온 것"은
 * 타입 선언만으로는 아무것도 보장되지 않는다. 실제로 확인해야 한다.
 *
 * zod 같은 라이브러리를 쓰지 않는 이유:
 *   - 클라이언트에 번들러가 없다. 브라우저 코드는 tsc가 뱉은 ESM을 그대로
 *     서빙하므로, 의존성을 하나 추가하면 그 패키지의 브라우저 빌드까지
 *     따로 서빙해야 한다(socket.io-client에 이미 그렇게 하고 있다).
 *   - 필요한 것이 문자열/정수/불리언/리터럴/객체/배열 정도뿐이다.
 *
 * 검증기 하나로 런타임 검사와 컴파일 타임 타입을 동시에 얻는다.
 * `Infer<typeof someSchema>`가 그 스키마가 보증하는 타입이다.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err = { readonly ok: false; readonly error: string };
export type Result<T> = Ok<T> | Err;

export type Validator<T> = {
  /** @param path 오류 메시지에 쓸 위치 (예: "init.device.kind") */
  readonly parse: (input: unknown, path?: string) => Result<T>;
};

/** 검증기가 보증하는 타입을 꺼낸다. */
export type Infer<V> = V extends Validator<infer T> ? T : never;

const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
const err = (path: string, message: string): Err => ({
  ok: false,
  error: `${path || "value"}: ${message}`,
});

const describe = (input: unknown): string => {
  if (input === null) return "null";
  if (Array.isArray(input)) return "array";
  return typeof input;
};

const validator = <T>(parse: (input: unknown, path: string) => Result<T>): Validator<T> => ({
  parse: (input, path = "") => parse(input, path),
});

// ---------------------------------------------------------------- 원시값

export function string(
  options: { minLength?: number; maxLength?: number } = {},
): Validator<string> {
  return validator((input, path) => {
    if (typeof input !== "string")
      return err(path, `문자열이어야 합니다 (받은 값: ${describe(input)})`);
    if (options.minLength !== undefined && input.length < options.minLength) {
      return err(path, `최소 ${options.minLength}자여야 합니다`);
    }
    if (options.maxLength !== undefined && input.length > options.maxLength) {
      return err(path, `최대 ${options.maxLength}자여야 합니다`);
    }
    return ok(input);
  });
}

export function integer(options: { min?: number; max?: number } = {}): Validator<number> {
  return validator((input, path) => {
    if (typeof input !== "number" || !Number.isInteger(input)) {
      return err(path, `정수여야 합니다 (받은 값: ${describe(input)})`);
    }
    if (options.min !== undefined && input < options.min) {
      return err(path, `${options.min} 이상이어야 합니다 (받은 값: ${input})`);
    }
    if (options.max !== undefined && input > options.max) {
      return err(path, `${options.max} 이하여야 합니다 (받은 값: ${input})`);
    }
    return ok(input);
  });
}

export function boolean(): Validator<boolean> {
  return validator((input, path) =>
    typeof input === "boolean"
      ? ok(input)
      : err(path, `불리언이어야 합니다 (받은 값: ${describe(input)})`),
  );
}

/** 허용된 값 목록 중 하나. `literal("up", "down")` -> Validator<"up" | "down"> */
export function literal<const T extends readonly (string | number | boolean)[]>(
  ...values: T
): Validator<T[number]> {
  return validator((input, path) =>
    values.includes(input as T[number])
      ? ok(input as T[number])
      : err(path, `${values.map((v) => JSON.stringify(v)).join(" | ")} 중 하나여야 합니다`),
  );
}

// ---------------------------------------------------------------- 조합

export function arrayOf<T>(item: Validator<T>): Validator<T[]> {
  return validator((input, path) => {
    if (!Array.isArray(input)) return err(path, `배열이어야 합니다 (받은 값: ${describe(input)})`);
    const out: T[] = [];
    for (const [index, element] of input.entries()) {
      const result = item.parse(element, `${path}[${index}]`);
      if (!result.ok) return result;
      out.push(result.value);
    }
    return ok(out);
  });
}

type Shape = Record<string, Validator<unknown>>;
type FromShape<S extends Shape> = { [K in keyof S]: Infer<S[K]> };

/** 선언한 키만 남긴다. 모르는 키는 조용히 버려서 프로토콜이 앞으로 나가도 깨지지 않는다. */
export function object<const S extends Shape>(shape: S): Validator<FromShape<S>> {
  const entries = Object.entries(shape);
  return validator((input, path) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return err(path, `객체여야 합니다 (받은 값: ${describe(input)})`);
    }
    const source = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, field] of entries) {
      const where = path ? `${path}.${key}` : key;
      // 프로퍼티를 읽는 것만으로 던지는 객체가 있을 수 있다(던지는 getter,
      // 적대적인 Proxy). 검증기는 어떤 입력에도 예외를 밖으로 내보내면 안 된다.
      let raw: unknown;
      try {
        raw = source[key];
      } catch {
        return err(where, "값을 읽을 수 없습니다");
      }
      const result = field.parse(raw, where);
      if (!result.ok) return result;
      out[key] = result.value;
    }
    return ok(out as FromShape<S>);
  });
}

export function union<const V extends readonly Validator<unknown>[]>(
  ...validators: V
): Validator<Infer<V[number]>> {
  return validator((input, path) => {
    const reasons: string[] = [];
    for (const candidate of validators) {
      const result = candidate.parse(input, path);
      if (result.ok) return ok(result.value as Infer<V[number]>);
      reasons.push(result.error);
    }
    return err(path, `어느 형태와도 맞지 않습니다 (${reasons.join(" / ")})`);
  });
}

// ---------------------------------------------------------------- 사용 지점

/** 검증에 실패하면 던진다. 부팅 시 설정처럼 "틀렸으면 뜨지 말아야" 하는 곳에 쓴다. */
export function parseOrThrow<T>(schema: Validator<T>, input: unknown, label: string): T {
  const result = schema.parse(input, label);
  if (!result.ok) throw new TypeError(result.error);
  return result.value;
}

/**
 * 검증에 실패하면 대체값을 쓴다. 신뢰할 수 없는 입력 때문에 화면이 죽으면
 * 안 되는 곳(클라이언트가 받는 메시지, localStorage 등)에 쓴다.
 */
export function parseOr<T>(
  schema: Validator<T>,
  input: unknown,
  fallback: T,
  onError?: (message: string) => void,
): T {
  const result = schema.parse(input);
  if (result.ok) return result.value;
  onError?.(result.error);
  return fallback;
}
