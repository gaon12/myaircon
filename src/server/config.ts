import path from "node:path";
import { DEVICE_MODES, type DeviceMode } from "../shared/protocol.ts";
import { isValidTimeZone } from "./device.ts";

const ROOT = path.join(import.meta.dirname, "..", "..");

/**
 * 환경변수는 전부 문자열이거나 없다. 타입 선언만으로는 아무것도 보장되지
 * 않으므로 여기서 실제로 검사하고, 틀렸으면 부팅 시점에 즉시 던진다.
 * 잘못된 설정으로 뜬 뒤 나중에 이상하게 동작하는 것보다 낫다.
 */

function readInt(
  name: string,
  fallback: number,
  { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {},
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`env ${name} must be an integer between ${min} and ${max} (received: ${raw})`);
  }
  return parsed;
}

/** "1" / "true" / "yes" / "on"을 참으로 취급한다. */
function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

function readEnum<const T extends readonly string[]>(
  name: string,
  allowed: T,
  fallback: T[number],
): T[number] {
  const raw = readString(name, fallback);
  if (!allowed.includes(raw)) {
    throw new Error(`env ${name} must be one of ${allowed.join(" | ")} (received: ${raw})`);
  }
  return raw as T[number];
}

/** "11,12,1,2,3" 형태를 1~12 정수 배열로 읽는다. */
function readMonths(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const months = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n));
  if (months.length === 0 || months.some((n) => n < 1 || n > 12)) {
    throw new Error(`env ${name} must be a comma-separated list of months 1-12 (received: ${raw})`);
  }
  return months;
}

/**
 * 서비스가 자기 시각으로 삼을 시간대. 계절 판정과 통계의 "오늘" 경계에 쓴다.
 * 빈 문자열이면 null(= 서버 프로세스의 로컬 시간대).
 *
 * 예전 이름 SEASON_TIMEZONE도 계속 받는다. 하는 일이 계절 판정만이 아니게 돼서
 * 이름을 바꿨지만, 이미 설정해 둔 곳이 깨지면 안 된다.
 */
function readServiceTimeZone(): string | null {
  const name = process.env.SERVICE_TIMEZONE ? "SERVICE_TIMEZONE" : "SEASON_TIMEZONE";
  const raw = readString(name, "");
  if (raw === "") return null;
  if (!isValidTimeZone(raw)) {
    throw new Error(`env ${name} must be a valid IANA time zone (received: ${raw})`);
  }
  return raw;
}

const SERVICE_TIME_ZONE = readServiceTimeZone();

const TEMP_MIN = readInt("TEMP_MIN", 18, { min: -50, max: 100 });
const TEMP_MAX = readInt("TEMP_MAX", 30, { min: -50, max: 100 });
if (TEMP_MIN >= TEMP_MAX) {
  throw new Error(`TEMP_MIN (${TEMP_MIN}) must be less than TEMP_MAX (${TEMP_MAX})`);
}

export type AppConfig = {
  host: string;
  port: number;
  logLevel: string;
  /** 서비스가 자기 시각으로 삼을 시간대. null이면 서버 로컬. */
  timeZone: string | null;
  publicDir: string;
  stateFile: string;
  persistDebounceMs: number;
  persistenceEnabled: boolean;
  temperature: { min: number; max: number; initial: number };
  device: {
    mode: DeviceMode;
    winterMonths: number[];
    /** null이면 서버 프로세스의 로컬 시간대를 쓴다. */
    timeZone: string | null;
    recheckIntervalMs: number;
  };
  stats: {
    enabled: boolean;
    file: string;
    /** 접속자 수 브로드캐스트 주기. 값이 바뀌었을 때만 보낸다. */
    onlineIntervalMs: number;
    flushIntervalMs: number;
    maxNames: number;
    recentSize: number;
    retentionHours: number;
  };
  nickname: { maxLength: number; fallback: string };
  rateLimit: { points: number; durationSeconds: number; blockSeconds: number };
  trustProxyHops: number;
  /** 표시용 태그를 만들 비밀키. null이면 통계 DB에 저장된 값을 쓰거나 새로 만든다. */
  identitySecret: string | null;
  maxHttpBufferSize: number;
  security: { contentSecurityPolicy: string; hstsMaxAge: number };
  admin: {
    /** null이면 관리 API를 아예 등록하지 않는다. */
    token: string | null;
    banFile: string;
    /** kick 시 기본 차단 시간(분). */
    defaultBanMinutes: number;
  };
};

export const config: AppConfig = {
  // 0.0.0.0이 기본이어야 컨테이너/PaaS에서 외부 접근이 된다. Fastify의 기본값은
  // 127.0.0.1이라 도커 안에서는 아무 데서도 잡히지 않는다.
  host: readString("HOST", "0.0.0.0"),
  port: readInt("PORT", 8080, { min: 0, max: 65535 }),

  logLevel: readString("LOG_LEVEL", "info"),
  timeZone: SERVICE_TIME_ZONE,

  publicDir: path.join(ROOT, "public"),
  stateFile: readString("STATE_FILE", path.join(ROOT, "data", "state.json")),
  persistDebounceMs: readInt("PERSIST_DEBOUNCE_MS", 2000, { min: 0, max: 60_000 }),
  persistenceEnabled: readBool("PERSIST_STATE", true),

  temperature: {
    min: TEMP_MIN,
    max: TEMP_MAX,
    initial: readInt("TEMP_INITIAL", TEMP_MIN, { min: -50, max: 100 }),
  },

  // 여름엔 에어컨, 겨울엔 온풍기. auto면 서버 시간의 현재 월로 판단하고,
  // aircon/heater로 고정할 수도 있다. 공유 기기이므로 서버가 정해서 모두에게
  // 같은 값을 내려준다.
  device: {
    mode: readEnum("DEVICE_MODE", DEVICE_MODES, "auto"),
    winterMonths: readMonths("WINTER_MONTHS", [11, 12, 1, 2, 3]),
    timeZone: SERVICE_TIME_ZONE,
    // 계절이 바뀌는 순간에도 서버가 켜져 있을 수 있으므로 주기적으로 다시 본다.
    recheckIntervalMs: readInt("DEVICE_RECHECK_INTERVAL_MS", 3_600_000, {
      min: 1000,
      max: 86_400_000,
    }),
  },

  // 통계는 전부 메모리에서 집계하고 SQLite에는 주기적으로 백업만 한다.
  // 끄면 순위/기록/그래프가 비어 보이고, 접속자 수만 계속 동작한다.
  stats: {
    enabled: readBool("STATS_ENABLED", true),
    file: readString("STATS_FILE", path.join(ROOT, "data", "stats.db")),
    onlineIntervalMs: readInt("STATS_ONLINE_INTERVAL_MS", 5000, { min: 1000, max: 60_000 }),
    flushIntervalMs: readInt("STATS_FLUSH_INTERVAL_MS", 5000, { min: 500, max: 300_000 }),
    // 닉네임에 인증이 없어 무한히 늘 수 있다. 넘으면 상위만 남긴다.
    maxNames: readInt("STATS_MAX_NAMES", 2000, { min: 100, max: 100_000 }),
    recentSize: readInt("STATS_RECENT_SIZE", 500, { min: 10, max: 10_000 }),
    retentionHours: readInt("STATS_RETENTION_HOURS", 48, { min: 24, max: 8760 }),
  },

  nickname: {
    maxLength: readInt("NICKNAME_MAX_LENGTH", 9, { min: 1, max: 64 }),
    fallback: readString("NICKNAME_FALLBACK", "익명"),
  },

  rateLimit: {
    points: readInt("RATE_LIMIT_POINTS", 10, { min: 1, max: 10_000 }),
    durationSeconds: readInt("RATE_LIMIT_DURATION_SECONDS", 2, { min: 1, max: 3600 }),
    blockSeconds: readInt("RATE_LIMIT_BLOCK_SECONDS", 5, { min: 0, max: 3600 }),
  },

  // 신뢰하는 리버스 프록시 홉 수. 0이면 X-Forwarded-For를 아예 무시하고 TCP
  // 소켓의 원격 주소만 쓴다(기본값). 프록시를 1단 거친다면 1, nginx+CDN처럼
  // 2단이면 2로 설정한다. 이 값을 넘기지 않으면 클라이언트가 헤더를 위조해
  // rate limit을 무력화할 수 있으므로 기본을 0으로 두는 것이 중요하다.
  trustProxyHops: readInt("TRUST_PROXY_HOPS", 0, { min: 0, max: 10 }),

  // 접속자를 화면에서 구분하는 태그(가온#7c2)를 만들 때 쓴다. 비워두면 서버가
  // 한 번 만들어 통계 DB에 저장하고 이후 재사용한다. 인스턴스를 여러 개
  // 띄운다면 같은 값을 명시해야 태그가 서로 일치한다.
  identitySecret: (() => {
    const raw = readString("IDENTITY_SECRET", "");
    if (raw === "") return null;
    if (raw.length < 16) throw new Error("env IDENTITY_SECRET must be at least 16 characters");
    return raw;
  })(),

  // socket.io 페이로드는 닉네임 문자열 하나뿐이라 1KB면 충분하다.
  // 기본값 1MB를 그대로 두면 메모리 낭비/남용 여지가 생긴다.
  maxHttpBufferSize: readInt("MAX_HTTP_BUFFER_SIZE", 1024, { min: 256, max: 1_048_576 }),

  // 관리 API와 관리 페이지. 토큰이 없으면 라우트 자체가 등록되지 않는다.
  admin: {
    token: (() => {
      const raw = readString("ADMIN_TOKEN", "");
      if (raw === "") return null;
      if (raw.length < 16) {
        throw new Error("env ADMIN_TOKEN must be at least 16 characters");
      }
      return raw;
    })(),
    banFile: readString("BAN_FILE", path.join(ROOT, "data", "bans.db")),
    defaultBanMinutes: readInt("BAN_DEFAULT_MINUTES", 10, { min: 0, max: 60 * 24 * 365 }),
  },

  security: {
    // 프로덕션에서 문제가 생기면 환경변수로 완화할 수 있게 열어둔다.
    contentSecurityPolicy: readString(
      "CONTENT_SECURITY_POLICY",
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "img-src 'self' data:",
        // 인라인 <script>/<style>이 없고 CDN도 쓰지 않으므로 'unsafe-inline'과
        // 외부 출처를 모두 뺄 수 있다.
        "script-src 'self'",
        "style-src 'self'",
        "worker-src 'self'",
        "connect-src 'self'",
      ].join("; "),
    ),
    // HSTS는 https 뒤에서만 의미가 있고 잘못 켜면 로컬 개발을 망가뜨린다.
    // 0이면 헤더를 붙이지 않는다.
    hstsMaxAge: readInt("HSTS_MAX_AGE", 0, { min: 0, max: 63_072_000 }),
  },
};
