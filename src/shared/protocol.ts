import {
  arrayOf,
  boolean,
  type Infer,
  integer,
  literal,
  object,
  string,
  type Validator,
} from "./validate.ts";

/**
 * 서버와 클라이언트가 주고받는 메시지의 형태.
 *
 * 스키마 하나에서 런타임 검증과 컴파일 타임 타입을 모두 얻는다. 한쪽만 고치고
 * 다른 쪽을 잊는 일이 구조적으로 불가능하다.
 */

export const DEVICE_KINDS = ["aircon", "heater"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const DEVICE_MODES = ["auto", ...DEVICE_KINDS] as const;
export type DeviceMode = (typeof DEVICE_MODES)[number];

export const DIRECTIONS = ["up", "down"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ASSET_SLOTS = ["body", "fan", "air"] as const;
export type AssetSlot = (typeof ASSET_SLOTS)[number];

/** 서버가 내려주는 이미지 경로. 반드시 우리 서버의 절대 경로여야 한다. */
const assetUrl = (): Validator<string> => ({
  parse(input, path = "") {
    const result = string({ minLength: 2, maxLength: 256 }).parse(input, path);
    if (!result.ok) return result;
    // 외부 URL이나 상대 경로가 섞여 들어오면 CSP에 막히거나 엉뚱한 것을 불러온다.
    //   //evil.example/x.png 는 프로토콜 상대 URL이라 외부 호스트를 가리킨다.
    //   /../x.png 는 정적 루트 밖으로 나가려는 시도다.
    const url = result.value;
    const looksLocal =
      url.startsWith("/") &&
      !url.startsWith("//") &&
      !url.includes("..") &&
      /^\/[\w.\-/]+\.(png|webp|avif|svg)$/.test(url);
    if (!looksLocal) {
      return { ok: false, error: `${path || "value"}: /로 시작하는 이미지 경로여야 합니다` };
    }
    return result;
  },
});

export const deviceInfoSchema = object({
  kind: literal(...DEVICE_KINDS),
  assets: object({ body: assetUrl(), fan: assetUrl(), air: assetUrl() }),
  usingFallback: boolean(),
});
export type DeviceInfo = Infer<typeof deviceInfoSchema>;

/** 서버 -> 클라이언트: 접속·재접속 시 현재 상태 전체 */
export const initMessageSchema = object({
  temp: integer(),
  min: integer(),
  max: integer(),
  device: deviceInfoSchema,
});
export type InitMessage = Infer<typeof initMessageSchema>;

/** 서버 -> 전체: 누군가 온도를 조절함 */
export const tempChangeMessageSchema = object({
  temp: integer(),
  changed: boolean(),
  direction: literal(...DIRECTIONS),
  username: string({ maxLength: 128 }),
  at: integer({ min: 0 }),
});
export type TempChangeMessage = Infer<typeof tempChangeMessageSchema>;

/** 서버 -> 클라이언트: rate limit에 걸림 */
export const blockedMessageSchema = object({
  reason: literal("rate_limited"),
  retryAfterMs: integer({ min: 0 }),
});
export type BlockedMessage = Infer<typeof blockedMessageSchema>;

/** 서버 -> 클라이언트: 처리 중 오류 */
export const serverErrorMessageSchema = object({
  reason: string({ maxLength: 128 }),
});
export type ServerErrorMessage = Infer<typeof serverErrorMessageSchema>;

/** 서버 -> 전체: 계절이 바뀌어 기기가 교체됨 */
export const deviceChangeMessageSchema = deviceInfoSchema;
export type DeviceChangeMessage = DeviceInfo;

/**
 * 클라이언트 -> 서버: 온도 조절 요청에 실린 닉네임.
 *
 * 여기만은 일부러 무엇이든 받는다. 검증해서 거절하는 대신 normalizeNickname이
 * 어떤 입력이든 안전한 문자열로 바꾼다. 기존 코드는 `arg.substring(0, 9)`가
 * 문자열이 아닌 값에 TypeError를 냈고, 그 예외가 rate limit용 catch에 삼켜져
 * 사용자에게 "너무 잦은 요청"이라는 거짓 안내로 둔갑했다.
 */
export type NicknamePayload = unknown;

/** 디스크에 저장하는 서버 상태 */
export const persistedStateSchema = object({
  temp: integer(),
});
export type PersistedState = Infer<typeof persistedStateSchema>;

/** 지원 언어 코드 목록의 형태 (i18n 모듈이 실제 값을 채운다) */
export const localeCodeListSchema = arrayOf(string({ minLength: 2 }));

/** socket.io 이벤트 이름과 페이로드 타입의 대응 */
export type ServerToClientEvents = {
  init: (message: InitMessage) => void;
  tempChange: (message: TempChangeMessage) => void;
  blocked: (message: BlockedMessage) => void;
  deviceChange: (message: DeviceChangeMessage) => void;
  "server-error": (message: ServerErrorMessage) => void;
};

export type ClientToServerEvents = {
  plus: (nickname: NicknamePayload) => void;
  minus: (nickname: NicknamePayload) => void;
};
