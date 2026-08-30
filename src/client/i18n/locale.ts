import type { DeviceKind } from "../../shared/protocol.ts";

/**
 * 모든 로케일이 만족해야 하는 계약.
 *
 * 언어를 추가하다 키를 하나 빠뜨리면 예전에는 화면에 undefined가 떴다.
 * 이제는 `satisfies Locale` 덕분에 컴파일이 실패한다.
 * (테스트도 여전히 같은 것을 확인한다 -- 컴파일을 건너뛰고 Node로 바로
 *  실행하는 경로가 있기 때문이다)
 */
export type Locale = {
  /** BCP-47 코드. 파일 이름 및 locales 맵의 키와 같아야 한다. */
  readonly code: string;
  /** 언어 선택 목록에 표시할 이름. 그 언어 자신의 표기로 쓴다. */
  readonly name: string;

  readonly device: Readonly<Record<DeviceKind, string>>;
  readonly appName: (device: string) => string;

  readonly nicknameLabel: string;
  readonly nicknamePlaceholder: string;
  readonly start: string;

  readonly onlineOn: string;
  readonly onlineOff: string;
  readonly connecting: string;

  readonly soundOn: string;
  readonly soundOff: string;
  readonly warmer: string;
  readonly cooler: string;

  readonly adjustedBy: (name: string) => string;
  readonly rateLimited: (seconds: number) => string;
  readonly atMax: string;
  readonly atMin: string;
  readonly audioFailed: string;
  readonly connectionLost: string;
  readonly connectionFailed: string;
  readonly serverError: string;

  readonly stats: string;
  readonly about: string;
  readonly close: string;
  readonly plusCount: string;
  readonly minusCount: string;

  readonly language: string;
  readonly theme: string;
  readonly themeSystem: string;
  readonly themeLight: string;
  readonly themeDark: string;

  readonly aboutLines: (device: string) => readonly string[];
};

/** 마크업의 data-i18n으로 채울 수 있는(= 인자가 없는 문자열) 키만. */
export type PlainStringKey = {
  [K in keyof Locale]: Locale[K] extends string ? K : never;
}[keyof Locale];
