import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { io as createClient, type Socket } from "socket.io-client";
import { type AppContext, buildApp, closeApp } from "../src/server/app.ts";
import { type AppConfig, config as baseConfig } from "../src/server/config.ts";
import type { InitMessage } from "../src/shared/protocol.ts";

/** 중첩 객체까지 부분적으로 덮어쓸 수 있게 한 설정 오버라이드. */
export type ConfigOverrides = Partial<Omit<AppConfig, NestedKey>> & {
  [K in NestedKey]?: Partial<AppConfig[K]>;
};

type NestedKey =
  | "temperature"
  | "rateLimit"
  | "nickname"
  | "security"
  | "device"
  | "stats"
  | "admin"
  | "guard"
  | "challenge";

function mergeConfig(base: AppConfig, overrides: ConfigOverrides): AppConfig {
  return {
    ...base,
    ...overrides,
    temperature: { ...base.temperature, ...overrides.temperature },
    rateLimit: { ...base.rateLimit, ...overrides.rateLimit },
    nickname: { ...base.nickname, ...overrides.nickname },
    security: { ...base.security, ...overrides.security },
    device: { ...base.device, ...overrides.device },
    // 테스트는 기본적으로 디스크를 쓰지 않는다.
    stats: { ...base.stats, file: ":memory:", ...overrides.stats },
    admin: { ...base.admin, banFile: ":memory:", ...overrides.admin },
    guard: { ...base.guard, ...overrides.guard },
    challenge: { ...base.challenge, ...overrides.challenge },
  };
}

export type ConnectedClient = {
  socket: Socket;
  init: InitMessage;
};

export type TestServer = AppContext & {
  url: string;
  stateDir: string;
  /** 접속이 완료되고 init까지 받은 클라이언트를 돌려준다. */
  connect: () => Promise<ConnectedClient>;
  stop: () => Promise<void>;
};

/**
 * 임의 포트에 서버를 띄운다. 상태 파일은 테스트마다 별도 임시 디렉터리를 쓴다.
 * 반환된 stop()은 서버 정리와 임시 디렉터리 삭제를 함께 처리한다.
 */
export async function startTestServer(overrides: ConfigOverrides = {}): Promise<TestServer> {
  const dir = await mkdtemp(path.join(tmpdir(), "myaircon-test-"));
  const config = mergeConfig(baseConfig, {
    ...overrides,
    host: "127.0.0.1",
    port: 0,
    stateFile: path.join(dir, "state.json"),
    persistDebounceMs: overrides.persistDebounceMs ?? 10,
  });

  const context = await buildApp({ config, logger: false });
  await context.app.listen({ host: "127.0.0.1", port: 0 });

  const address = context.app.server.address();
  if (address === null || typeof address === "string") {
    throw new Error("테스트 서버의 포트를 알 수 없습니다");
  }
  const { port } = address;

  const sockets: Socket[] = [];

  return {
    ...context,
    url: `http://127.0.0.1:${port}`,
    stateDir: dir,

    async connect() {
      const socket = createClient(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      const init = await once<InitMessage>(socket, "init", 5000);
      return { socket, init };
    },

    async stop() {
      for (const socket of sockets) socket.close();
      await closeApp(context);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** once/race가 붙을 수 있는 최소한의 이벤트 방출자. */
export type EventSourceLike = {
  once: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off: (event: string, listener: (...args: unknown[]) => void) => unknown;
};

/**
 * 이벤트를 한 번 기다린다. 제한 시간 안에 안 오면 거부한다.
 *
 * 소켓으로 오는 값은 런타임에 검증되지 않으므로 반환 타입은 호출하는 쪽이
 * 단언하는 셈이다. 테스트에서는 그 형태를 assert로 다시 확인한다.
 */
export function once<T>(emitter: EventSourceLike, event: string, timeoutMs = 1500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`"${event}" 이벤트를 ${timeoutMs}ms 안에 받지 못했습니다`));
    }, timeoutMs);
    function handler(payload: unknown): void {
      clearTimeout(timer);
      resolve(payload as T);
    }
    emitter.once(event, handler);
  });
}

/**
 * 여러 이벤트 중 먼저 오는 것을 [이름, 값] 으로 돌려준다.
 * "blocked가 와야 하는데 tempChange가 왔다" 같은 경우를 타임아웃이 아니라
 * 명확한 실패로 드러내기 위한 것.
 */
export function race<T = unknown>(
  emitter: EventSourceLike,
  events: readonly string[],
  timeoutMs = 1500,
): Promise<[string, T]> {
  return new Promise<[string, T]>((resolve, reject) => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const cleanup = (): void => {
      clearTimeout(timer);
      for (const [event, handler] of handlers) emitter.off(event, handler);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${events.join("/")} 중 아무것도 ${timeoutMs}ms 안에 오지 않았습니다`));
    }, timeoutMs);

    for (const event of events) {
      const handler = (payload: unknown): void => {
        cleanup();
        resolve([event, payload as T]);
      };
      handlers.set(event, handler);
      emitter.once(event, handler);
    }
  });
}
