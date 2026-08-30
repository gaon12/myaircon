import { io } from "/vendor/socket.io/socket.io.esm.min.js";

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
export function createConnection({ onInit, onTempChange, onBlocked, onStatus }) {
  const socket = io({
    // websocket 전용이면 이를 막는 네트워크에서 접속이 아예 불가능하다.
    transports: ["websocket", "polling"],
    // 토글을 누르기 전에는 연결하지 않는다.
    autoConnect: false,
  });

  socket.on("connect", () => onStatus("connected"));
  socket.on("disconnect", (reason) => onStatus("disconnected", reason));
  socket.on("connect_error", (error) => onStatus("error", error));
  socket.on("server-error", () => onStatus("server-error"));

  // 서버는 매 접속(재연결 포함)마다 init을 보낸다. 생성 시점에 등록해 두면
  // 첫 접속이든 재연결이든 항상 최신 상태를 받는다.
  socket.on("init", onInit);
  socket.on("tempChange", onTempChange);
  socket.on("blocked", onBlocked);

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
  };
}
