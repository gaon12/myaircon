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
  onChange?: ((temp: number) => void) | undefined;
};

export type RealtimeHandle = {
  readonly device: DeviceInfo;
  stop: () => void;
};

export type AppSocketServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

/** socket.io 이벤트 핸들러를 등록한다. */
export function registerRealtime(
  io: AppSocketServer,
  { thermostat, config, logger, onChange }: RealtimeDeps,
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
      timeZone: config.device.timeZone ?? "(서버 로컬)",
      usingFallback: device.usingFallback,
    },
    "기기 종류를 결정했습니다",
  );

  // 서버가 계절이 바뀌는 순간에도 계속 켜져 있을 수 있다. 주기적으로 다시 보고
  // 바뀌었으면 접속 중인 모두에게 알린다.
  const seasonTimer = setInterval(() => {
    const next = readDevice();
    if (next.kind === device.kind) return;
    device = next;
    logger.info({ kind: device.kind }, "계절이 바뀌어 기기를 교체합니다");
    io.emit("deviceChange", device);
  }, config.device.recheckIntervalMs);
  seasonTimer.unref?.();

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
      logger.warn({ err, socketId: socket.id }, "소켓 오류");
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
          logger.error({ err, clientIp }, "rate limiter 동작 실패");
          socket.emit("server-error", { reason: "internal" });
        }
        return;
      }

      // 3) 상태 변경 및 브로드캐스트. 경계값에서 눌러 값이 그대로여도
      //    "누가 눌렀다"는 사실은 알려야 하므로 changed 플래그를 함께 보낸다.
      const { temp, changed } = thermostat.step(direction);
      io.emit("tempChange", {
        temp,
        changed,
        direction,
        username,
        at: Date.now(),
      });

      if (changed) onChange?.(temp);
    }
  });

  return {
    get device() {
      return device;
    },
    stop() {
      clearInterval(seasonTimer);
    },
  };
}
