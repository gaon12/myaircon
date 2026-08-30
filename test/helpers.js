import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { io as createClient } from "socket.io-client";
import { buildApp, closeApp } from "../src/app.js";
import { config as baseConfig } from "../src/config.js";

/** 중첩 객체까지 얕게 병합해 테스트용 설정을 만든다. */
function mergeConfig(base, overrides) {
  const merged = { ...base, ...overrides };
  for (const key of ["temperature", "rateLimit", "nickname", "security", "device"]) {
    merged[key] = { ...base[key], ...(overrides[key] ?? {}) };
  }
  return merged;
}

/**
 * 임의 포트에 서버를 띄운다. 상태 파일은 테스트마다 별도 임시 디렉터리를 쓴다.
 * 반환된 stop()은 서버 정리와 임시 디렉터리 삭제를 함께 처리한다.
 */
export async function startTestServer(overrides = {}) {
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
  const { port } = context.app.server.address();

  const sockets = [];

  return {
    ...context,
    url: `http://127.0.0.1:${port}`,
    stateDir: dir,

    /** 접속이 완료되고 init까지 받은 클라이언트를 돌려준다. */
    async connect() {
      const socket = createClient(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      const init = await once(socket, "init", 5000);
      return { socket, init };
    },

    async stop() {
      for (const socket of sockets) socket.close();
      await closeApp(context);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** 이벤트를 한 번 기다린다. 제한 시간 안에 안 오면 거부한다. */
export function once(emitter, event, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`"${event}" 이벤트를 ${timeoutMs}ms 안에 받지 못했습니다`));
    }, timeoutMs);
    function handler(payload) {
      clearTimeout(timer);
      resolve(payload);
    }
    emitter.once(event, handler);
  });
}

/**
 * 여러 이벤트 중 먼저 오는 것을 [이름, 값] 으로 돌려준다.
 * "blocked가 와야 하는데 tempChange가 왔다" 같은 경우를 타임아웃이 아니라
 * 명확한 실패로 드러내기 위한 것.
 */
export function race(emitter, events, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const handlers = new Map();
    const cleanup = () => {
      clearTimeout(timer);
      for (const [event, handler] of handlers) emitter.off(event, handler);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${events.join("/")} 중 아무것도 ${timeoutMs}ms 안에 오지 않았습니다`));
    }, timeoutMs);

    for (const event of events) {
      const handler = (payload) => {
        cleanup();
        resolve([event, payload]);
      };
      handlers.set(event, handler);
      emitter.once(event, handler);
    }
  });
}
