import { loadEnv } from "./env.ts";

// .env를 config보다 먼저 읽어야 한다. config.ts는 import되는 시점에
// process.env를 읽어 설정 객체를 만들고, app.ts도 그 config를 끌어온다.
// 정적 import는 이 파일의 본문보다 먼저 평가되는 데다 biome의 import 정렬이
// 순서를 지켜 주지도 않으므로, 두 모듈은 로드가 끝난 뒤 동적으로 가져온다.
loadEnv();

const { buildApp, closeApp } = await import("./app.ts");
const { config } = await import("./config.ts");

const context = await buildApp({ config });
const { app } = context;

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error({ err }, "failed to start server");
  await closeApp(context).catch(() => {});
  process.exit(1);
}

let shuttingDown = false;

/**
 * SIGTERM/SIGINT를 받으면 열린 소켓을 정리하고 마지막 온도를 저장한 뒤 종료한다.
 * 기존 코드에는 종료 처리가 전혀 없어서, 배포 때마다 진행 중인 연결이 끊기고
 * 공유 온도값이 그대로 사라졌다.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "received shutdown signal, cleaning up");

  // 정리가 어떤 이유로든 끝나지 않아도 배포가 멈추지 않도록 상한을 둔다.
  const forceExit = setTimeout(() => {
    app.log.error("cleanup did not finish within 10s, forcing exit");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await closeApp(context);
    app.log.info("shutdown complete");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}

process.on("unhandledRejection", (err) => {
  app.log.error({ err }, "unhandled promise rejection");
});
