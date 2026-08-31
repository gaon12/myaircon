import { createRequire } from "node:module";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import { Server as SocketIOServer } from "socket.io";
import { signalsFromUserAgent } from "../shared/automation.ts";
import { verifyRequestSchema } from "../shared/challenge.ts";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/protocol.ts";
import { registerAdmin } from "./admin.ts";
import { BanStore } from "./ban-store.ts";
import { ChallengeIssuer } from "./challenge.ts";
import { resolveClientIp } from "./client-ip.ts";
import { type AppConfig, config as defaultConfig } from "./config.ts";
import { renderErrorPage, wantsHtml } from "./error-page.ts";
import { Guard } from "./guard.ts";
import { createIdentityTagger, generateIdentitySecret } from "./identity.ts";
import { type AppSocketServer, type RealtimeHandle, registerRealtime } from "./realtime.ts";
import { StateStore } from "./state-store.ts";
import { StatsStore } from "./stats-store.ts";
import { Thermostat } from "./thermostat.ts";

// socket.io 클라이언트 번들의 실제 위치. package.json은 exports 맵에 공개돼
// 있으므로 그 경로에서 dist/를 찾으면 npm/pnpm의 호이스팅 방식과 무관하게
// 안정적으로 해석된다.
const socketIoClientDist = path.join(
  path.dirname(createRequire(import.meta.url).resolve("socket.io-client/package.json")),
  "dist",
);

/** Fastify 요청에서 rate limit 키로 쓸 주소. 소켓 쪽과 같은 규칙을 쓴다. */
function makeClientIpOf(config: AppConfig) {
  return (request: {
    ip: string;
    headers: Record<string, string | string[] | undefined>;
  }): string =>
    resolveClientIp(
      { address: request.ip, headers: request.headers },
      { trustProxyHops: config.trustProxyHops },
    );
}

/**
 * 던져진 것에서 HTTP 상태를 읽는다.
 *
 * Fastify는 FastifyError를 준다고 하지만, 라우트가 무엇을 던질지는 알 수 없다.
 * 문자열이든 null이든 여기까지 올 수 있으므로 아무 가정도 하지 않고, 쓸 만한
 * 4xx/5xx가 붙어 있을 때만 그것을 쓴다.
 */
function statusOf(error: unknown): number {
  const value: unknown =
    typeof error === "object" && error !== null && "statusCode" in error
      ? (error as { statusCode: unknown }).statusCode
      : undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599) {
    return value;
  }
  return 500;
}

/** 상태 코드마다 JSON 쪽에 쓸 짧은 이름. 화면 문구와 달리 번역하지 않는다. */
function errorCode(status: number): string {
  if (status === 404) return "not_found";
  if (status === 429) return "too_many_requests";
  if (status >= 500) return "internal_error";
  return "bad_request";
}

/**
 * 오류 하나를 요청이 원하는 형식으로 내보낸다.
 *
 * 브라우저면 화면 한 장, 그 외에는 JSON이다. 어느 쪽이든 상태 코드 말고는
 * 아무것도 밝히지 않는다 -- 어떤 라우트가 왜 터졌는지는 로그에 남긴다.
 */
async function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
): Promise<void> {
  reply.code(status);
  if (wantsHtml({ url: request.url, accept: request.headers.accept })) {
    reply.type("text/html; charset=utf-8");
    await reply.send(
      renderErrorPage({ status, acceptLanguage: request.headers["accept-language"] }),
    );
    return;
  }
  await reply.send({ error: errorCode(status), statusCode: status });
}

export type BuildAppOptions = {
  config?: AppConfig | undefined;
  /** false면 로그를 끈다(테스트용). */
  logger?: FastifyServerOptions["logger"] | undefined;
};

export type AppContext = {
  app: FastifyInstance;
  io: AppSocketServer;
  thermostat: Thermostat;
  store: StateStore;
  stats: StatsStore;
  config: AppConfig;
  realtime: RealtimeHandle;
  bans: BanStore;
  guard: Guard;
  challenge: ChallengeIssuer;
};

/**
 * Fastify 인스턴스와 socket.io 서버를 조립한다. listen은 하지 않는다.
 *
 * listen을 분리해 둬야 테스트에서 포트 0으로 임의 포트에 띄울 수 있고,
 * 기존 코드처럼 라우트 등록보다 먼저 listen이 호출되는 사고도 막을 수 있다.
 */
export async function buildApp({
  config = defaultConfig,
  logger,
}: BuildAppOptions = {}): Promise<AppContext> {
  const app = Fastify({
    logger: logger ?? { level: config.logLevel },
    // 프록시 뒤에 있을 때만 req.ip가 X-Forwarded-For를 신뢰하게 한다.
    // socket.io 쪽 키 계산(client-ip.ts)과 같은 설정을 공유한다.
    //
    // Fastify의 타입은 홉 수를 숫자로 받는 형태를 노출하지 않는다. 술어
    // 함수로 같은 동작을 표현하면 캐스팅 없이 타입이 맞는다. hop은 가장
    // 가까운 프록시부터 0으로 세므로 앞의 N개를 신뢰하면 홉 수 N과 같고,
    // 0이면 아무것도 신뢰하지 않는다.
    trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
  });

  const thermostat = new Thermostat(config.temperature);

  const store = new StateStore({
    file: config.stateFile,
    debounceMs: config.persistDebounceMs,
    logger: app.log,
    enabled: config.persistenceEnabled,
  });

  const stats = new StatsStore({
    file: config.stats.file,
    enabled: config.stats.enabled,
    timeZone: config.timeZone,
    maxNames: config.stats.maxNames,
    recentSize: config.stats.recentSize,
    retentionHours: config.stats.retentionHours,
    flushIntervalMs: config.stats.flushIntervalMs,
    logger: app.log,
  });

  const guard = new Guard(config.guard);
  const clientIpOf = makeClientIpOf(config);

  const bans = new BanStore({
    file: config.admin.banFile,
    // 관리 API가 꺼져 있으면 차단을 걸 수단도 없으므로 저장소를 열지 않는다.
    enabled: config.admin.token !== null,
    logger: app.log,
  });

  // 표시용 태그의 비밀키. 재시작해도 같은 사람이 같은 태그를 받아야 하므로
  // 한 번 만들어 저장해 두고 다음 부팅부터 재사용한다.
  const identitySecret = resolveIdentitySecret(config, stats, app.log);
  const tagger = createIdentityTagger(identitySecret);

  // 챌린지 서명에도 같은 비밀키를 쓴다. 둘 다 "이 서버가 발급했음"만 증명하면
  // 되고, 별도 키를 하나 더 관리할 이유가 없다.
  const challenge = new ChallengeIssuer({
    secret: identitySecret,
    difficulty: config.challenge.difficulty,
    ttlSeconds: config.challenge.ttlSeconds,
    tokenTtlSeconds: config.challenge.tokenTtlSeconds,
  });

  const saved = await store.load();
  if (saved !== null) {
    const restored = thermostat.restore(saved.temp);
    app.log.info({ temp: restored }, "restored persisted temperature");
  }

  // CDN을 걷어냈으므로 외부 출처를 전혀 허용하지 않는 CSP를 걸 수 있다.
  // 인라인 <script>/<style>도 파일로 분리했기 때문에 'unsafe-inline'이 필요 없다.
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Content-Security-Policy", config.security.contentSecurityPolicy);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    reply.header(
      "Permissions-Policy",
      "geolocation=(), camera=(), microphone=(), interest-cohort=()",
    );
    if (config.security.hstsMaxAge > 0) {
      reply.header(
        "Strict-Transport-Security",
        `max-age=${config.security.hstsMaxAge}; includeSubDomains`,
      );
    }
  });

  // HTTP 요청 rate limit. 앞단 프록시가 양을 막아주더라도, 프록시가 없거나
  // 설정이 빠졌을 때 서버가 알몸이 되지 않도록 한 겹 둔다.
  // 정적 파일까지 포함해 IP당 분당 한도를 건다.
  if (config.guard.enabled) {
    app.addHook("onRequest", async (request, reply) => {
      const ip = clientIpOf(request);

      // User-Agent가 스스로 도구라고 밝히면 점수만 올려 둔다. 여기서 막지는
      // 않는다 -- UA만 보고 HTTP를 거절하면 가동 감시나 링크 미리보기가
      // 조용히 죽고, 원인을 찾기가 유난히 어렵다. 소켓을 열 때쯤이면 점수가
      // 이미 쌓여 있으므로 그때 판정에 반영된다.
      if (config.guard.automationPoints > 0) {
        const signals = signalsFromUserAgent(request.headers["user-agent"]);
        if (signals.length > 0) guard.noteSuspicious(ip, config.guard.automationPoints);
      }

      if (await guard.allowHttpRequest(ip)) return;
      reply.header("Retry-After", "60");
      // 브라우저로 들어온 사람에게는 JSON 대신 화면을 보여준다.
      await sendError(request, reply, 429);
    });
  }

  await app.register(fastifyStatic, {
    root: config.publicDir,
    index: false,
  });

  // socket.io 클라이언트를 CDN이 아니라 우리 서버에서 직접 내려준다.
  // 서버가 쓰는 socket.io와 같은 의존성 트리에서 나오므로 버전이 어긋날 수
  // 없고, CSP에서 외부 출처를 전부 막을 수 있게 된다.
  await app.register(fastifyStatic, {
    root: socketIoClientDist,
    prefix: "/vendor/socket.io/",
    index: false,
    // 두 번째 등록부터는 reply.sendFile 데코레이터를 다시 붙이지 않는다.
    decorateReply: false,
    // 번들은 버전마다 내용이 고정이라 길게 캐시해도 안전하다.
    maxAge: "1h",
  });

  app.get("/", (_req, reply) => reply.sendFile("index.html"));

  const io: AppSocketServer = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(
    app.server,
    {
      // websocket 전용이면 사내 프록시나 일부 모바일 네트워크에서 아예 접속이
      // 안 된다. polling을 폴백으로 남겨 두고 가능하면 websocket으로 업그레이드한다.
      transports: ["websocket", "polling"],
      // 페이로드는 닉네임 문자열 하나뿐이다. 기본값 1MB는 과하다.
      maxHttpBufferSize: config.maxHttpBufferSize,
      // Fastify 5 뒤에서는 socket.io의 클라이언트 번들 서빙이 동작하지 않는다.
      // 번들은 /vendor/socket.io/ 로 직접 정적 서빙한다.
      serveClient: false,
    },
  );

  const realtime = registerRealtime(io, {
    thermostat,
    config,
    logger: app.log,
    stats,
    tagger,
    bans,
    guard,
    challenge,
    onChange: (temp) => store.schedule({ temp }),
  });

  // 점수가 애매한 클라이언트에게 내줄 챌린지. 페이지 자체는 막지 않는다.
  app.get("/api/challenge", async () => challenge.issue());

  app.post("/api/verify", async (request, reply) => {
    const parsed = verifyRequestSchema.parse(request.body, "body");
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });

    const token = challenge.verify(parsed.value);
    if (token === null) {
      guard.noteSuspicious(clientIpOf(request), 5);
      return reply.code(400).send({ error: "invalid_solution" });
    }
    return { token };
  });

  registerAdmin(app, { config, realtime, bans, tagger, guard });

  // realtime이 기기 종류를 들고 있으므로 그 뒤에 등록한다.
  app.get("/healthz", async () => ({
    status: "ok",
    temp: thermostat.value,
    min: thermostat.min,
    max: thermostat.max,
    device: realtime.device.kind,
    uptimeSeconds: Math.floor(process.uptime()),
  }));

  // 통계는 밀지 않고 가져가게 한다. 버튼을 누를 때마다 전원에게 보내면
  // 접속자 수에 비례해 비용이 늘지만, 다이얼로그를 열 때만 가져가면 O(1)이다.
  app.get("/api/stats", async (_req, reply) => {
    // 집계가 전부 메모리에 있어 매번 만들어도 싸다. 그래도 연타 대비로
    // 짧게 캐시할 수 있도록 클라이언트에 캐시 힌트를 준다.
    reply.header("Cache-Control", "no-store");
    return stats.snapshot(realtime.online);
  });

  // 오류 응답. 라우트를 전부 등록한 뒤에 붙인다.
  app.setNotFoundHandler(async (request, reply) => sendError(request, reply, 404));

  app.setErrorHandler(async (error, request, reply) => {
    const status = statusOf(error);

    // 5xx만 error로 남긴다. 4xx는 대개 잘못 만든 요청이고, 그것까지 같은
    // 수준으로 찍으면 진짜 고장이 파묻힌다.
    if (status >= 500) request.log.error({ err: error, url: request.url }, "request failed");
    else request.log.info({ err: error, url: request.url, status }, "request rejected");

    return sendError(request, reply, status);
  });

  return { app, io, thermostat, store, stats, config, realtime, bans, guard, challenge };
}

/**
 * 표시 태그용 비밀키를 정한다.
 *   1. 환경변수 IDENTITY_SECRET
 *   2. 통계 DB에 저장된 값
 *   3. 새로 만들어 저장 (다음 부팅부터 2번 경로)
 * 통계를 꺼두면 저장할 곳이 없어 매 부팅 새 키가 되고, 그러면 태그도 바뀐다.
 */
function resolveIdentitySecret(
  config: AppConfig,
  stats: StatsStore,
  logger: FastifyInstance["log"],
): string {
  if (config.identitySecret !== null) return config.identitySecret;

  const stored = stats.getMeta("identitySecret");
  if (stored !== null) return stored;

  const generated = generateIdentitySecret();
  stats.setMeta("identitySecret", generated);
  if (stats.getMeta("identitySecret") === null) {
    logger.warn("identity secret could not be persisted; display tags will change on restart");
  }
  return generated;
}

/**
 * 열려 있는 소켓과 예약된 상태 저장을 정리한 뒤 HTTP 서버를 닫는다.
 *
 * io.close()는 내부적으로 Fastify가 소유한 http 서버까지 닫아버려 이후
 * app.close()가 ERR_SERVER_NOT_RUNNING을 만난다. 그래서 소켓과 engine.io
 * 타이머만 직접 정리하고 서버 종료는 Fastify에 맡긴다.
 */
export async function closeApp({
  app,
  io,
  store,
  stats,
  realtime,
  bans,
}: AppContext): Promise<void> {
  realtime.stop();
  io.disconnectSockets(true);
  io.engine.close();
  await app.close();
  await store.flush();
  stats.close();
  bans.close();
}
