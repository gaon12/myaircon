import { buildApp, closeApp } from "./app.ts";
import { config } from "./config.ts";

const context = await buildApp({ config });
const { app } = context;

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error({ err }, "서버를 시작하지 못했습니다");
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
  app.log.info({ signal }, "종료 신호를 받아 정리를 시작합니다");

  // 정리가 어떤 이유로든 끝나지 않아도 배포가 멈추지 않도록 상한을 둔다.
  const forceExit = setTimeout(() => {
    app.log.error("정리가 10초 안에 끝나지 않아 강제 종료합니다");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await closeApp(context);
    app.log.info("정상 종료");
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, "종료 중 오류");
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}

process.on("unhandledRejection", (err) => {
  app.log.error({ err }, "처리되지 않은 Promise 거부");
});
