import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const project = path.resolve(import.meta.dirname, "..");

it("dev는 초기 빌드와 클라이언트·공유 소스 감시를 제공한다", { timeout: 30_000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "myaircon-dev-test-"));
  let stop = async (): Promise<void> => {};
  t.after(async () => {
    await stop();
    assert.equal(path.dirname(root), tmpdir());
    await rm(root, { recursive: true, force: true });
  });
  for (const dir of ["scripts", "src/client", "src/shared", "src/server"]) {
    await mkdir(path.join(root, dir), { recursive: true });
  }
  await copyFile(path.join(project, "scripts/dev.mjs"), path.join(root, "scripts/dev.mjs"));
  await symlink(path.join(project, "node_modules"), path.join(root, "node_modules"), "junction");
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await writeFile(
    path.join(root, "tsconfig.client.json"),
    JSON.stringify({
      compilerOptions: {
        target: "es2023",
        module: "nodenext",
        rootDir: "src",
        outDir: "public/js",
        rewriteRelativeImportExtensions: true,
        types: [],
      },
      include: ["src/client/**/*.ts", "src/shared/**/*.ts"],
    }),
  );
  const client = path.join(root, "src/client/main.ts");
  const shared = path.join(root, "src/shared/value.ts");
  await writeFile(shared, 'export const value = "first";');
  await writeFile(client, 'export { value } from "../shared/value.ts";');
  await writeFile(
    path.join(root, "src/server/server.ts"),
    'import {value} from "../shared/value.ts"; console.info("SERVER:" + value + ":" + process.env.HOST); setInterval(() => {}, 1000);',
  );
  await writeFile(client, 'export const invalid: number = "wrong type";');
  await assert.rejects(
    promisify(execFile)(process.execPath, [path.join(root, "scripts/dev.mjs")], {
      cwd: root,
      timeout: 5000,
      windowsHide: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error && "stdout" in error);
      assert.match(String(error.stdout), /error TS/);
      assert.doesNotMatch(String(error.stdout), /SERVER:/);
      return true;
    },
  );
  await writeFile(client, 'export { value } from "../shared/value.ts";');
  const child = spawn(process.execPath, [path.join(root, "scripts/dev.mjs")], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  stop = async () => {
    if (child.exitCode !== null) return;
    const exited = once(child, "exit");
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      await once(killer, "exit");
    } else {
      child.kill("SIGTERM");
    }
    await exited;
  };

  async function until(check: () => Promise<boolean> | boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await check()) return;
      assert.equal(child.exitCode, null, output);
      await delay(100);
    }
    assert.fail(`개발 감시 시간 초과:\n${output}`);
  }
  const emittedClient = path.join(root, "public/js/client/main.js");
  await until(() => output.includes("SERVER:first:127.0.0.1") && output.includes("Watching"));
  assert.match(await readFile(emittedClient, "utf8"), /\.\.\/shared\/value\.js/);
  await writeFile(
    client,
    'export { value } from "../shared/value.ts"; export const edited = true;',
  );
  await until(async () => (await readFile(emittedClient, "utf8")).includes("edited"));
  await writeFile(shared, 'export const value = "second";');
  await until(async () =>
    (await readFile(path.join(root, "public/js/shared/value.js"), "utf8")).includes("second"),
  );
  await until(() => output.includes("SERVER:second:127.0.0.1"));

  const valid = await readFile(emittedClient, "utf8");
  await writeFile(client, 'export const invalid: number = "wrong type";');
  await until(() => output.includes("error TS"));
  assert.equal(await readFile(emittedClient, "utf8"), valid, "타입 오류 산출물은 서빙하지 않는다");
});
