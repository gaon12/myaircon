import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

/** 환경변수를 정수로 읽는다. 미설정이면 fallback, 범위를 벗어나면 즉시 실패. */
function readInt(
  name,
  fallback,
  { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {},
) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`환경변수 ${name}는 ${min}~${max} 범위의 정수여야 합니다 (받은 값: ${raw})`);
  }
  return parsed;
}

/** "1" / "true" / "yes" / "on"을 참으로 취급한다. */
function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function readString(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

const TEMP_MIN = readInt("TEMP_MIN", 18, { min: -50, max: 100 });
const TEMP_MAX = readInt("TEMP_MAX", 30, { min: -50, max: 100 });
if (TEMP_MIN >= TEMP_MAX) {
  throw new Error(`TEMP_MIN(${TEMP_MIN})은 TEMP_MAX(${TEMP_MAX})보다 작아야 합니다`);
}

export const config = {
  // 0.0.0.0이 기본이어야 컨테이너/PaaS에서 외부 접근이 된다. Fastify의 기본값은
  // 127.0.0.1이라 도커 안에서는 아무 데서도 잡히지 않는다.
  host: readString("HOST", "0.0.0.0"),
  port: readInt("PORT", 8080, { min: 0, max: 65535 }),

  logLevel: readString("LOG_LEVEL", "info"),

  publicDir: path.join(ROOT, "public"),
  stateFile: readString("STATE_FILE", path.join(ROOT, "data", "state.json")),
  persistDebounceMs: readInt("PERSIST_DEBOUNCE_MS", 2000, { min: 0, max: 60_000 }),

  temperature: {
    min: TEMP_MIN,
    max: TEMP_MAX,
    initial: readInt("TEMP_INITIAL", TEMP_MIN, { min: -50, max: 100 }),
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

  // socket.io 페이로드는 닉네임 문자열 하나뿐이라 1KB면 충분하다.
  // 기본값 1MB를 그대로 두면 메모리 낭비/남용 여지가 생긴다.
  maxHttpBufferSize: readInt("MAX_HTTP_BUFFER_SIZE", 1024, { min: 256, max: 1_048_576 }),

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
        // TODO(csp): public/index.html이 아직 인라인 <script>/<style>을 쓰고 있어
        // 'unsafe-inline'이 없으면 페이지가 통째로 죽는다. 마크업과 스크립트를
        // 외부 파일로 분리하는 커밋에서 이 두 줄의 'unsafe-inline'을 제거한다.
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "worker-src 'self'",
        "connect-src 'self'",
      ].join("; "),
    ),
    // HSTS는 https 뒤에서만 의미가 있고 잘못 켜면 로컬 개발을 망가뜨린다.
    // 0이면 헤더를 붙이지 않는다.
    hstsMaxAge: readInt("HSTS_MAX_AGE", 0, { min: 0, max: 63_072_000 }),
  },

  persistenceEnabled: readBool("PERSIST_STATE", true),
};
