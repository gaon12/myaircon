import { createRequire } from "node:module";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { Server as SocketIOServer } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/protocol.ts";
import { type AppConfig, config as defaultConfig } from "./config.ts";
import { type AppSocketServer, type RealtimeHandle, registerRealtime } from "./realtime.ts";
import { StateStore } from "./state-store.ts";
import { Thermostat } from "./thermostat.ts";

// socket.io 클라이언트 번들의 실제 위치. package.json은 exports 맵에 공개돼
// 있으므로 그 경로에서 dist/를 찾으면 npm/pnpm의 호이스팅 방식과 무관하게
// 안정적으로 해석된다.
const socketIoClientDist = path.join(
  path.dirname(createRequire(import.meta.url).resolve("socket.io-client/package.json")),
  "dist",
);

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
  config: AppConfig;
  realtime: RealtimeHandle;
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
    onChange: (temp) => store.schedule({ temp }),
  });

  // realtime이 기기 종류를 들고 있으므로 그 뒤에 등록한다.
  app.get("/healthz", async () => ({
    status: "ok",
    temp: thermostat.value,
    min: thermostat.min,
    max: thermostat.max,
    device: realtime.device.kind,
    uptimeSeconds: Math.floor(process.uptime()),
  }));

  return { app, io, thermostat, store, config, realtime };
}

/**
 * 열려 있는 소켓과 예약된 상태 저장을 정리한 뒤 HTTP 서버를 닫는다.
 *
 * io.close()는 내부적으로 Fastify가 소유한 http 서버까지 닫아버려 이후
 * app.close()가 ERR_SERVER_NOT_RUNNING을 만난다. 그래서 소켓과 engine.io
 * 타이머만 직접 정리하고 서버 종료는 Fastify에 맡긴다.
 */
export async function closeApp({ app, io, store, realtime }: AppContext): Promise<void> {
  realtime.stop();
  io.disconnectSockets(true);
  io.engine.close();
  await app.close();
  await store.flush();
}
