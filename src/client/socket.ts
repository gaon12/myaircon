import { io } from "/vendor/socket.io/socket.io.esm.min.js";
import type { AutomationReport } from "../shared/automation.ts";
import { CHALLENGE_REQUIRED, CONNECTION_BLOCKED } from "../shared/challenge.ts";
import {
  type BlockedMessage,
  blockedMessageSchema,
  type ClientToServerEvents,
  type DeviceChangeMessage,
  type Direction,
  deviceChangeMessageSchema,
  type InitMessage,
  initMessageSchema,
  type ServerToClientEvents,
  type TempChangeMessage,
  tempChangeMessageSchema,
} from "../shared/protocol.ts";
import { type OnlineCountMessage, onlineCountMessageSchema } from "../shared/stats.ts";
import type { Validator } from "../shared/validate.ts";
import { detectAutomation } from "./automation.ts";
import { connectionOptions } from "./connection-options.ts";

export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "server-error"
  /** 점수가 애매해 사람인지 확인이 필요하다. */
  | "challenge-required"
  /** 차단됐거나 점수가 차단 구간이다. */
  | "blocked";

export type ConnectionHandlers = {
  onInit: (message: InitMessage) => void;
  onTempChange: (message: TempChangeMessage) => void;
  onBlocked: (message: BlockedMessage) => void;
  onDeviceChange: (message: DeviceChangeMessage) => void;
  onOnlineCount: (message: OnlineCountMessage) => void;
  onStatus: (status: ConnectionStatus, detail?: unknown) => void;
  /** 서버가 형태에 맞지 않는 메시지를 보냈을 때 */
  onProtocolError?: ((event: string, error: string) => void) | undefined;
};

export type Connection = {
  readonly connected: boolean;
  connect: () => void;
  disconnect: () => void;
  step: (direction: Direction, username: string) => void;
  /** 챌린지를 통과해 받은 토큰. 다음 접속부터 핸드셰이크에 실린다. */
  setChallengeToken: (token: string) => void;
};

/** 리스너는 한 번 등록하고 연결만 토글해 재접속 시에도 초기 동기화를 유지한다. */
export function createConnection(handlers: ConnectionHandlers): Connection {
  // 자동화 흔적은 페이지당 한 번 수집하는 위조 가능한 참고 신호다.
  // 토큰의 유효성과 최종 접속 허용은 서버가 판단한다.
  const automation: AutomationReport = { signals: detectAutomation() };
  const auth: { challengeToken?: string; automation: AutomationReport } = { automation };

  const socket = io({
    ...connectionOptions,
    auth,
  }) as ReturnType<typeof io> & {
    on: <E extends keyof ServerToClientEvents>(
      event: E,
      listener: (payload: unknown) => void,
    ) => void;
    emit: <E extends keyof ClientToServerEvents>(event: E, payload: unknown) => void;
  };

  /** 런타임 스키마를 통과한 메시지만 UI에 전달한다. 잘못된 메시지는 버린다. */
  function guard<T>(event: string, schema: Validator<T>, handle: (message: T) => void) {
    return (payload: unknown): void => {
      const result = schema.parse(payload, event);
      if (!result.ok) {
        handlers.onProtocolError?.(event, result.error);
        return;
      }
      handle(result.value);
    };
  }

  socket.on("connect", () => handlers.onStatus("connected"));
  socket.on("disconnect", (reason: unknown) => handlers.onStatus("disconnected", reason));
  socket.on("connect_error", (error: unknown) => {
    // 서버가 왜 거부했는지에 따라 화면이 달라야 한다. 챌린지가 필요한 것과
    // 그냥 연결이 안 되는 것은 사용자가 할 수 있는 일이 다르다.
    const message = error instanceof Error ? error.message : String(error);
    if (message === CHALLENGE_REQUIRED) handlers.onStatus("challenge-required", error);
    else if (message === CONNECTION_BLOCKED) handlers.onStatus("blocked", error);
    else handlers.onStatus("error", error);
  });
  socket.on("server-error", () => handlers.onStatus("server-error"));

  // 서버는 매 접속(재연결 포함)마다 init을 보낸다. 생성 시점에 등록해 두면
  // 첫 접속이든 재연결이든 항상 최신 상태를 받는다.
  socket.on("init", guard("init", initMessageSchema, handlers.onInit));
  socket.on("tempChange", guard("tempChange", tempChangeMessageSchema, handlers.onTempChange));
  socket.on("blocked", guard("blocked", blockedMessageSchema, handlers.onBlocked));
  socket.on(
    "deviceChange",
    guard("deviceChange", deviceChangeMessageSchema, handlers.onDeviceChange),
  );
  socket.on("onlineCount", guard("onlineCount", onlineCountMessageSchema, handlers.onOnlineCount));

  return {
    get connected() {
      return socket.connected;
    },
    connect() {
      socket.connect();
    },
    disconnect() {
      socket.disconnect();
    },
    step(direction, username) {
      socket.emit(direction === "up" ? "plus" : "minus", username);
    },
    setChallengeToken(token) {
      auth.challengeToken = token;
    },
  };
}
