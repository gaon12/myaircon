import type { ManagerOptions, SocketOptions } from "socket.io-client";

/** 같은 출처에서 전송 방식만 전환한다. 서버의 인증·차단 거부는 재시도하지 않는다. */
export const connectionOptions = {
  transports: ["websocket", "polling"],
  tryAllTransports: true,
  autoConnect: false,
} satisfies Partial<ManagerOptions & SocketOptions>;
