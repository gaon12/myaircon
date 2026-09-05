import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const tsc = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
const children = new Set();
let stopping = false;

function launch(args, env = process.env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    // POSIX에서는 watcher가 만든 자식도 같은 그룹으로 종료한다.
    detached: process.platform !== "win32",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function completed(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function stopTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    // Node/tsc watch의 하위 프로세스까지 정리한다. 셸 문자열을 실행하지 않는다.
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        shell: false,
        windowsHide: true,
      });
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}

async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  await Promise.all([...children].map(stopTree));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown(0));
}

try {
  // 초기 빌드가 성공하기 전에는 서버를 열지 않는다.
  const code = await completed(launch([tsc, "-p", "tsconfig.client.json", "--noEmitOnError"]));
  if (!stopping && code !== 0) {
    await shutdown(code);
  } else if (!stopping) {
    const compiler = launch([
      tsc,
      "-p",
      "tsconfig.client.json",
      "--watch",
      "--noEmitOnError",
      "--preserveWatchOutput",
    ]);
    const server = launch(["--watch", "src/server/server.ts"], {
      ...process.env,
      HOST: process.env.HOST ?? "127.0.0.1",
    });
    console.info("클라이언트 빌드 감시와 서버 감시를 시작했습니다. 화면은 새로고침해 주세요.");
    const exited = await Promise.race([completed(compiler), completed(server)]);
    // 감시자 하나가 끝나면 다른 감시자도 종료한다.
    await shutdown(stopping ? 0 : exited || 1);
  }
} catch (error) {
  console.error("개발 서버를 시작하거나 종료하지 못했습니다.", error);
  await shutdown(1);
}
