import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import type { Server as SocketIOServer } from "socket.io";
import type {
  ClientToServerEvents,
  DeviceInfo,
  Direction,
  NicknamePayload,
  ServerToClientEvents,
} from "../shared/protocol.ts";
import { resolveClientIp } from "./client-ip.ts";
import type { AppConfig } from "./config.ts";
import { describeDevice } from "./device.ts";
import { normalizeNickname } from "./nickname.ts";
import type { StatsStore } from "./stats-store.ts";
import type { Thermostat } from "./thermostat.ts";

export type RealtimeLogger = {
  info: (details: unknown, message?: string) => void;
  warn: (details: unknown, message?: string) => void;
  error: (details: unknown, message?: string) => void;
};

export type RealtimeDeps = {
  thermostat: Thermostat;
  config: AppConfig;
  logger: RealtimeLogger;
  stats?: StatsStore | undefined;
  onChange?: ((temp: number) => void) | undefined;
};

export type RealtimeHandle = {
  readonly device: DeviceInfo;
  /** 지금 붙어 있는 클라이언트 수. */
  readonly online: number;
  stop: () => void;
};

export type AppSocketServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

/** socket.io 이벤트 핸들러를 등록한다. */
export function registerRealtime(
  io: AppSocketServer,
  { thermostat, config, logger, stats, onChange }: RealtimeDeps,
): RealtimeHandle {
  const limiter = new RateLimiterMemory({
    points: config.rateLimit.points,
    duration: config.rateLimit.durationSeconds,
    blockDuration: config.rateLimit.blockSeconds,
  });

  const readDevice = (): DeviceInfo =>
    describeDevice({
      mode: config.device.mode,
      winterMonths: config.device.winterMonths,
      timeZone: config.device.timeZone,
      publicDir: config.publicDir,
    });

  let device = readDevice();
  logger.info(
    {
      kind: device.kind,
      mode: config.device.mode,
      timeZone: config.device.timeZone ?? "(system default)",
      usingFallback: device.usingFallback,
    },
    "resolved device kind",
  );

  // 서버가 계절이 바뀌는 순간에도 계속 켜져 있을 수 있다. 주기적으로 다시 보고
  // 바뀌었으면 접속 중인 모두에게 알린다.
  const seasonTimer = setInterval(() => {
    const next = readDevice();
    if (next.kind === device.kind) return;
    device = next;
    logger.info({ kind: device.kind }, "season changed, swapping device");
    io.emit("deviceChange", device);
  }, config.device.recheckIntervalMs);
  seasonTimer.unref?.();

  // 접속자 수는 socket.io가 이미 세고 있으므로 계산 비용이 없다. 다만
  // 접속/해제마다 브로드캐스트하면 N명 있을 때 1명 들어올 때마다 N개를 보내게
  // 되어 트래픽이 몰릴 때 O(N^2)가 된다. 주기적으로, 값이 달라졌을 때만 보낸다.
  let lastOnline = -1;
  const onlineTimer = setInterval(() => {
    const online = io.engine.clientsCount;
    if (online === lastOnline) return;
    lastOnline = online;
    io.emit("onlineCount", { online });
  }, config.stats.onlineIntervalMs);
  onlineTimer.unref?.();

  io.on("connection", (socket) => {
    // 핸드셰이크는 연결당 한 번만 해석하면 된다.
    const clientIp = resolveClientIp(socket.handshake, {
      trustProxyHops: config.trustProxyHops,
    });

    // 접속 즉시 현재 상태를 보낸다. 온도 범위와 기기 정보까지 함께 내려보내서
    // 클라이언트가 18/30이나 이미지 경로를 하드코딩하지 않아도 되게 한다.
    socket.emit("init", {
      temp: thermostat.value,
      min: thermostat.min,
      max: thermostat.max,
      device,
    });

    socket.on("plus", (payload) => void handleStep("up", payload));
    socket.on("minus", (payload) => void handleStep("down", payload));

    socket.on("error", (err: unknown) => {
      logger.warn({ err, socketId: socket.id }, "socket error");
    });

    async function handleStep(direction: Direction, rawNickname: NicknamePayload): Promise<void> {
      // 1) 입력 정규화를 rate limit보다 먼저, try 바깥에서 한다.
      //    소켓으로 들어온 값은 타입이 없다. TypeScript가 NicknamePayload를
      //    unknown으로 두는 이유이고, normalizeNickname은 어떤 입력에도 예외를
      //    던지지 않는다. 그래서 아래 try/catch에 걸리는 것은 순수하게 rate
      //    limiter의 결과뿐이다.
      //    기존 코드는 `arg.substring(0, 9)`를 rate limit과 같은 try 안에
      //    두는 바람에, 숫자나 null을 보내면 TypeError가 catch에 삼켜져
      //    사용자에게 "너무 잦은 요청"이라는 엉뚱한 안내가 나갔다.
      const username = normalizeNickname(rawNickname, config.nickname);

      // 2) rate limit. 한도 초과는 RateLimiterRes(Error가 아님)로, 스토어
      //    장애는 진짜 Error로 reject된다. 둘을 구분해야 장애를 트래픽 탓으로
      //    돌리지 않는다.
      try {
        await limiter.consume(clientIp);
      } catch (err) {
        if (err instanceof RateLimiterRes) {
          socket.emit("blocked", {
            reason: "rate_limited",
            retryAfterMs: err.msBeforeNext,
          });
        } else {
          logger.error({ err, clientIp }, "rate limiter failed");
          socket.emit("server-error", { reason: "internal" });
        }
        return;
      }

      // 3) 상태 변경 및 브로드캐스트. 경계값에서 눌러 값이 그대로여도
      //    "누가 눌렀다"는 사실은 알려야 하므로 changed 플래그를 함께 보낸다.
      const { temp, changed } = thermostat.step(direction);
      const at = Date.now();
      io.emit("tempChange", { temp, changed, direction, username, at });

      if (changed) {
        onChange?.(temp);
        // 실제로 값이 바뀐 것만 센다. 경계값에서 연타해 순위를 올리는 것을 막는다.
        stats?.record({ username, direction, temp, at });
      }
    }
  });

  return {
    get device() {
      return device;
    },
    get online() {
      return io.engine.clientsCount;
    },
    stop() {
      clearInterval(seasonTimer);
      clearInterval(onlineTimer);
    },
  };
}
