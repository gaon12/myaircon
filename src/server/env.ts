import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "..");
const DEFAULT_ENV_FILE = path.join(ROOT, ".env");

/**
 * 프로젝트 루트의 .env를 process.env로 읽어 들인다. 서버 진입점이 설정을
 * 만들기 전에 딱 한 번 부른다.
 *
 * node --env-file 플래그를 쓰지 않는 이유는 실행 지점이 하나가 아니어서다.
 * 개발은 scripts/dev.mjs가 `node --watch src/server/server.ts`를, 배포는 pm2가
 * dist/server/server.js를 직접 띄운다(deploy/remote-deploy.sh). 플래그 방식은
 * 실행 지점마다 똑같은 플래그를 붙여야 하고, 특히 pm2는 인터프리터 인자를
 * 프로세스를 처음 만들 때만 읽어서 reload로는 바뀌지 않는다. 진입점에서
 * 부르면 어느 경로로 뜨든 같게 동작한다.
 *
 * 이미 환경에 있는 값은 덮지 않는다(process.loadEnvFile의 동작). 그래야
 * `DEVICE_MODE=heater npm start`처럼 한 번만 다르게 띄우는 것이 파일을 이긴다.
 *
 * @returns 파일을 실제로 읽었으면 true. 없으면 false.
 */
export function loadEnv(file: string = DEFAULT_ENV_FILE): boolean {
  try {
    process.loadEnvFile(file);
    return true;
  } catch (error) {
    // .env는 커밋하지 않으므로 없는 것이 정상이다. 그 외의 오류(권한, 깨진
    // 내용)는 조용히 넘기면 잘못된 설정으로 뜨게 되므로 그대로 던진다.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
