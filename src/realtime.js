import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { resolveClientIp } from "./client-ip.js";
import { normalizeNickname } from "./nickname.js";

/**
 * socket.io 이벤트 핸들러를 등록한다.
 *
 * @param {import("socket.io").Server} io
 * @param {{
 *   thermostat: import("./thermostat.js").Thermostat,
 *   config: typeof import("./config.js").config,
 *   logger: { info: Function, warn: Function, error: Function },
 *   onChange?: (temp: number) => void,
 * }} deps
 */
export function registerRealtime(io, { thermostat, config, logger, onChange }) {
  const limiter = new RateLimiterMemory({
    points: config.rateLimit.points,
    duration: config.rateLimit.durationSeconds,
    blockDuration: config.rateLimit.blockSeconds,
  });

  io.on("connection", (socket) => {
    // 핸드셰이크는 연결당 한 번만 해석하면 된다.
    const clientIp = resolveClientIp(socket.handshake, {
      trustProxyHops: config.trustProxyHops,
    });

    // 접속 즉시 현재 상태를 보낸다. 온도 범위까지 함께 내려보내서 클라이언트가
    // 18/30을 하드코딩하지 않아도 되게 한다. 기존에는 같은 클램프 로직이
    // 서버와 클라이언트에 각각 적혀 있어 한쪽만 바꾸면 조용히 어긋났다.
    socket.emit("init", {
      temp: thermostat.value,
      min: thermostat.min,
      max: thermostat.max,
    });

    socket.on("plus", (payload) => void handleStep("up", payload));
    socket.on("minus", (payload) => void handleStep("down", payload));

    socket.on("error", (err) => {
      logger.warn({ err, socketId: socket.id }, "소켓 오류");
    });

    async function handleStep(direction, rawNickname) {
      // 1) 입력 정규화를 rate limit보다 먼저, try 바깥에서 한다.
      //    normalizeNickname은 어떤 입력에도 예외를 던지지 않으므로, 아래
      //    try/catch에 걸리는 것은 순수하게 rate limiter의 결과뿐이다.
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
          // 언제 다시 시도할 수 있는지 알려줘야 클라이언트가 "잠시 후 다시"
          // 대신 남은 시간을 보여줄 수 있다.
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
}
