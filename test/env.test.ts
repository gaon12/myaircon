import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { loadEnv } from "../src/server/env.ts";

const project = path.resolve(import.meta.dirname, "..");

/** 테스트가 서로의 process.env를 넘겨받지 않도록 쓴 키를 되돌린다. */
const touched = new Set<string>();
const remember = (...names: string[]): void => {
  for (const name of names) touched.add(name);
};

afterEach(() => {
  for (const name of touched) delete process.env[name];
  touched.clear();
});

async function tempRoot(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "myaircon-env-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), tmpdir());
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

describe("loadEnv", () => {
  it("파일의 값을 process.env로 읽는다", async (t) => {
    const root = await tempRoot(t);
    const file = path.join(root, ".env");
    await writeFile(file, "MYAIRCON_TEST_MODE=heater\nMYAIRCON_TEST_MONTHS=8,9,10\n");
    remember("MYAIRCON_TEST_MODE", "MYAIRCON_TEST_MONTHS");

    assert.equal(loadEnv(file), true);
    assert.equal(process.env.MYAIRCON_TEST_MODE, "heater");
    assert.equal(process.env.MYAIRCON_TEST_MONTHS, "8,9,10");
  });

  it("이미 환경에 있는 값은 덮지 않는다", async (t) => {
    // `DEVICE_MODE=heater npm start`처럼 한 번만 다르게 띄우는 쪽이 이겨야 한다.
    const root = await tempRoot(t);
    const file = path.join(root, ".env");
    await writeFile(file, "MYAIRCON_TEST_MODE=fromfile\n");
    remember("MYAIRCON_TEST_MODE");
    process.env.MYAIRCON_TEST_MODE = "fromshell";

    loadEnv(file);
    assert.equal(process.env.MYAIRCON_TEST_MODE, "fromshell");
  });

  it("파일이 없으면 던지지 않고 false를 준다", async (t) => {
    // .env는 커밋하지 않으므로 없는 것이 정상이다. 여기서 터지면 서버가 못 뜬다.
    const root = await tempRoot(t);
    assert.equal(loadEnv(path.join(root, ".env")), false);
  });

  it("기본 경로는 프로젝트 루트의 .env다", async (t) => {
    // env.ts는 src/server와 dist/server 양쪽에서 도므로 루트가 늘 ../..이다.
    // 실제 .env를 건드리지 않으려고 같은 깊이의 임시 트리에 복사해서 부른다.
    const root = await tempRoot(t);
    await mkdir(path.join(root, "src", "server"), { recursive: true });
    await copyFile(path.join(project, "src/server/env.ts"), path.join(root, "src/server/env.ts"));
    await writeFile(path.join(root, ".env"), "MYAIRCON_TEST_ROOT=1\n");
    remember("MYAIRCON_TEST_ROOT");

    // 윈도우에서는 절대경로를 그대로 넘길 수 없어 file:// URL로 바꾼다.
    const copied = await import(pathToFileURL(path.join(root, "src/server/env.ts")).href);
    assert.equal(copied.loadEnv(), true);
    assert.equal(process.env.MYAIRCON_TEST_ROOT, "1");
  });
});

it("서버 진입점은 설정을 만들기 전에 .env를 읽는다", async () => {
  // config.ts는 import되는 순간 process.env를 읽는다. app.ts도 그 config를
  // 끌어오므로, 둘 다 loadEnv() 뒤에 동적으로 가져와야 한다. biome의 import
  // 정렬이 정적 import를 위로 올려 버리면 조용히 깨지는 자리라 소스로 잠근다.
  const source = await readFile(path.join(project, "src/server/server.ts"), "utf8");
  const load = source.indexOf("loadEnv()");
  assert.ok(load > 0, "server.ts가 loadEnv()를 부르지 않는다");
  for (const module of ["./app.ts", "./config.ts"]) {
    const dynamic = source.indexOf(`await import("${module}")`);
    assert.ok(dynamic > load, `${module}를 loadEnv() 뒤에 동적으로 가져와야 한다`);
    assert.ok(
      !new RegExp(`^import .*from "${module.replace(".", ".")}";$`, "m").test(source),
      `${module}를 정적으로 import하면 .env보다 먼저 평가된다`,
    );
  }
});
