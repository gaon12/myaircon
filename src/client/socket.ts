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

/**
 * 서버와의 실시간 연결을 감싼다.
 *
 * 기존 index.html의 토글 로직에는 세 가지 문제가 있었다.
 *
 *  1. "Online mode is off"로 바꿔도 소켓을 끊지 않았다. 스위치를 벽에
 *     테이프로 붙여놓고 껐다고 하는 것과 같았다.
 *  2. 끌 때 socket.off('connect')와 socket.off('init')까지 해제해 버리고,
 *     다시 켤 때는 'blocked'와 'tempChange'만 재등록했다. 그래서 한 번
 *     껐다 켜면 init 핸들러가 영구히 사라지고, 이후 네트워크가 끊겼다
 *     재연결돼도 온도 동기화가 되지 않아 화면에 유령 온도가 남았다.
 *  3. init 리스너를 connect 콜백 "안"에서 등록했다. 서버는 접속 즉시
 *     init을 보내므로 이건 패킷 순서에 기대는 경합이었다.
 *
 * 여기서는 리스너를 생성 시점에 딱 한 번만 등록하고, 켜고 끄는 것은
 * connect()/disconnect()로만 처리한다. off()를 쓰지 않으므로 재연결 후에도
 * 핸들러가 그대로 살아 있다.
 */
export function createConnection(handlers: ConnectionHandlers): Connection {
  // 챌린지를 통과했으면 그 토큰을 핸드셰이크에 실어 보낸다.
  //
  // 자동화 흔적도 함께 보낸다. 서버가 직접 볼 수 없는 것들이라 클라이언트가
  // 알려줄 수밖에 없고, 그래서 위조도 된다. 숨기는 쪽이 이기는 검사라는 뜻인데,
  // 그럼에도 넣는 이유는 아무 설정 없이 켠 puppeteer/selenium은 실제로 걸리기
  // 때문이다. 서버는 이걸 증거가 아니라 점수로 다룬다.
  //
  // 접속할 때마다 다시 재지 않는다. 페이지가 살아 있는 동안 결과가 바뀔 일이
  // 없고, 재연결 폭주 시 window 프로퍼티를 매번 훑을 이유도 없다.
  const automation: AutomationReport = { signals: detectAutomation() };
  const auth: { challengeToken?: string; automation: AutomationReport } = { automation };

  const socket = io({
    // websocket 전용이면 이를 막는 네트워크에서 접속이 아예 불가능하다.
    transports: ["websocket", "polling"],
    // 토글을 누르기 전에는 연결하지 않는다.
    autoConnect: false,
    auth,
  }) as ReturnType<typeof io> & {
    on: <E extends keyof ServerToClientEvents>(
      event: E,
      listener: (payload: unknown) => void,
    ) => void;
    emit: <E extends keyof ClientToServerEvents>(event: E, payload: unknown) => void;
  };

  /**
   * 서버가 보낸 메시지를 그대로 믿지 않는다.
   *
   * 타입 선언은 컴파일 시점에 지워지므로 런타임에는 아무것도 보장하지 않는다.
   * 배포 중 서버와 클라이언트의 버전이 잠깐 어긋나거나, 중간 장비가 페이로드를
   * 건드리거나, 프로토콜을 바꾸다 한쪽만 고치면 형태가 달라진다. 검증하지
   * 않으면 그때 화면이 조용히 깨진다(NaN℃, undefined 표시 등).
   */
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
